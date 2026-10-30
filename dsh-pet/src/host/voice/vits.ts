/**
 * 本地 VITS 语音：sherpa-onnx 在独立线程/进程里离线推理，产出 WAV。
 *
 * 架构：模型与 sherpa-onnx 运行时都放在**插件自己的安装目录**下的 `voice/`（即
 * `<插件包根>/voice/`，由仓库根 patch.mjs 部署）。推理不占宿主主线程——VITS 一句几百 ms 的
 * CPU 推理会卡住 DSH 的事件循环；把文本发出去、拿 float32 样本回来，在宿主侧封装成 WAV 落盘。
 *
 * 两种传输（见 {@link createBackend}），取决于宿主跑在什么运行时里：
 * - **Node（DSH 宿主 / CLI）**：worker_threads 线程，样本以 Float32Array 直达。
 * - **Electron（单进程桌宠应用）**：必须换成**独立 Node 子进程**。Electron ≥20 启用了 V8
 *   memory cage，禁止 `napi_create_external_arraybuffer`（Electron 官方博客 v8-memory-cage
 *   与 node-api 文档 napi_no_external_buffers_allowed 都写明了），而 sherpa-onnx 的原生插件
 *   正是用外部缓冲返回采样，于是 `tts.generate()` 直接抛
 *   "External buffers are not allowed" —— 与我们的代码无关，Electron 进程内无解（连
 *   ELECTRON_RUN_AS_NODE 模式也是同一个二进制，同样被拒，已实测）。子进程里跑真 Node 即绕开。
 *
 * 失败语义与 edge.ts 一致：一切失败收敛成 {@link VoiceSynthError}；运行时/模型未部署时给
 * 出可操作的提示（先跑 patch.mjs），绝不把插件启动卡死——首次合成时才加载，加载失败只让
 * 这一次合成失败。
 * 不负责缓存与排队：那是 speak.ts 的事；本模块只保证「文本 → 一个 WAV 文件」。
 * @module dsh-pet/src/host/voice/vits
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { PACKAGE_ROOT } from '../paths.ts';
import { VoiceSynthError, type SynthInput } from './edge.ts';
import { localVoiceDef } from './voices.ts';
import { encodeWav } from './vits-wav.ts';

/** 单次本地合成超时（ms）：首句含模型加载（秒级），长句推理也应在半分钟内完成。 */
const SYNTH_TIMEOUT_MS = 60_000;
/** worker 推理线程数：宿主与 DSH 同进程共争 CPU，1 线程足够（碎碎念都是短句）。 */
const NUM_THREADS = 1;
/** voice 根目录的环境变量覆盖；不设时用插件安装目录下的 `voice/`。 */
export const VOICE_DIR_ENV = 'DSH_PET_VOICE_DIR';

/** worker 侧的一次合成请求。 */
interface WorkerRequest {
  readonly kind: 'synth';
  readonly id: number;
  readonly text: string;
  readonly sid: number;
  readonly speed: number;
}

/**
 * 合成应答（成功带样本，失败带一句人话）。
 * 样本形态随传输而异：worker 线程直传 Float32Array，子进程只能传 base64 字符串。
 */
interface WorkerResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly samples?: Float32Array | string;
  readonly sampleRate?: number;
  readonly message?: string;
}

/**
 * 解析 voice 根目录：**跟着插件自己的安装位置走**，不依赖用户目录、也不依赖数据根。
 *
 * 为什么是 `<插件包根>/voice`：模型和运行时属于「这个插件随身的运行件」，不是用户数据。
 * 插件装在哪、以什么形态跑（源码装 / 独立模式 / 绿色包），目录就跟到哪儿——不需要任何人
 * 记住一个额外的绝对路径，也不存在「装在 A、模型却在 B」的错位。
 *
 * 需要挪位置时只有一条途径：`DSH_PET_VOICE_DIR` 整体接管（便携安装、把模型放共享盘等）。
 *
 * @param packageRoot - 插件包根；缺省取 {@link PACKAGE_ROOT}（真实运行时唯一的包根来源）。
 * @returns voice 根目录绝对路径。
 */
export function resolveVoiceDir(packageRoot: string = PACKAGE_ROOT): string {
  const override = process.env[VOICE_DIR_ENV];
  return override && override.trim() ? override : join(packageRoot, 'voice');
}

/** 运行时是否已部署（`voice/runtime/node_modules/sherpa-onnx-node` 存在）。 */
function runtimeInstalled(voiceDir: string): boolean {
  return existsSync(join(voiceDir, 'runtime', 'node_modules', 'sherpa-onnx-node', 'package.json'));
}

/** 模型目录里挑主模型 onnx：目录存在且恰有 `.onnx` 文件才算就绪。 */
function findModelOnnx(modelDir: string): string | undefined {
  try {
    return readdirSync(modelDir).find((name) => name.endsWith('.onnx'));
  } catch {
    return undefined;
  }
}

/**
 * 合成脚本主体：与传输方式无关，worker 外壳与子进程外壳共用同一份。
 *
 * 为什么不用独立文件：宿主产物是单文件 bundle（tsdown），再拆一个入口会让构建与 files 白名单
 * 各多一处约定；内联让脚本与宿主代码同生共死。脚本运行在 CommonJS 环境，用 createRequire 从
 * voice/runtime 解析 sherpa-onnx-node，兼容新式类 API（OfflineTts + GenerationConfig）与旧式
 * 工厂（createTts），npm 依赖升版不会立刻把这里打断。
 *
 * 注意：本段整体位于模板字符串内，注释里不可出现反引号——会截断模板，rolldown 报的语法错
 * 离真正原因很远（实测踩过一次）。
 */
const SYNTH_BODY = `
let tts = null;
let generationConfigCtor = null;
const req = createRequire(path.join(CONFIG.runtimeDir, 'noop.js'));
function init() {
  if (tts) return;
  const sherpa = req('sherpa-onnx-node');
  const dir = CONFIG.modelDir;
  const onnx = fs.readdirSync(dir).find((name) => name.endsWith('.onnx'));
  if (!onnx) throw new Error('model .onnx not found in ' + dir);
  const vits = {
    model: path.join(dir, onnx),
    lexicon: path.join(dir, 'lexicon.txt'),
    tokens: path.join(dir, 'tokens.txt'),
  };
  if (!fs.existsSync(vits.lexicon)) vits.lexicon = '';
  if (!fs.existsSync(vits.tokens)) vits.tokens = '';
  if (fs.existsSync(path.join(dir, 'dict'))) vits.dictDir = path.join(dir, 'dict');
  const config = {
    model: { vits, debug: false, numThreads: CONFIG.numThreads || 1, provider: 'cpu' },
    maxNumSentences: 1,
  };
  // 模型目录自带的文本归一化规则（数字/日期/电话读法），有几个挂几个——官方示例同款用法
  const fsts = fs.readdirSync(dir).filter((name) => name.endsWith('.fst'));
  if (fsts.length) config.ruleFsts = fsts.map((name) => path.join(dir, name)).join(',');
  tts = sherpa.OfflineTts ? new sherpa.OfflineTts(config) : sherpa.createTts(config);
  generationConfigCtor = sherpa.GenerationConfig || null;
}
/** 处理一条合成请求：成功带样本，失败带一句人话。 */
function onSynth(msg) {
  try {
    init();
    let out;
    if (generationConfigCtor) {
      out = tts.generate({ text: msg.text, generationConfig: new generationConfigCtor({ sid: msg.sid, speed: msg.speed }) });
    } else {
      out = tts.generate(msg.text, msg.sid, msg.speed);
    }
    const samples = out && (out.samples || (out.audio && out.audio.samples));
    const sampleRate = out && (out.sampleRate != null ? out.sampleRate : out.audio && out.audio.sampleRate);
    if (!(samples instanceof Float32Array) || !sampleRate) throw new Error('unexpected tts result shape');
    return { id: msg.id, ok: true, samples, sampleRate };
  } catch (error) {
    return { id: msg.id, ok: false, message: String((error && error.message) || error) };
  }
}
`;

/** worker 线程外壳（Node 宿主）：样本直传，发出去前拷一份自有缓冲。 */
const WORKER_SOURCE = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const CONFIG = workerData;
${SYNTH_BODY}
parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'exit') { process.exit(0); return; }
  if (msg.kind !== 'synth') return;
  const res = onSynth(msg);
  // 原生返回的 Float32Array 底层是外部内存，克隆不一定被允许：先拷进 JS 自有缓冲再传
  if (res.ok) res.samples = new Float32Array(res.samples);
  parentPort.postMessage(res);
});
`;

/** 子进程外壳（Electron 宿主）：stdin/stdout 走 NDJSON，样本只能以 base64 过线。 */
const CHILD_SOURCE = `
'use strict';
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const CONFIG = JSON.parse(process.argv[2] || '{}');
${SYNTH_BODY}
function reply(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.kind === 'exit') process.exit(0);
    if (msg.kind !== 'synth') continue;
    const res = onSynth(msg);
    if (res.ok) res.samples = Buffer.from(res.samples.buffer, res.samples.byteOffset, res.samples.byteLength).toString('base64');
    reply(res);
  }
});
`;

/** 已就绪的后端：worker 与请求表都挂在上面，disposer 负责收尸。 */
interface VitsBackend {
  synthesize(request: {
    text: string;
    sid: number;
    speed: number;
  }): Promise<{ samples: Float32Array; sampleRate: number }>;
  dispose(): void;
}

/** 当前唯一的 worker 后端；懒加载——本地音色一次都没用到就永远不起线程。 */
let backend: VitsBackend | null = null;

/** Electron 里跑合成用的 Node 可执行文件覆盖项（PATH 里没有 node 时指过去）。 */
export const NODE_BIN_ENV = 'DSH_PET_NODE_BIN';

/** 子进程脚本落在 voice 根下的文件名（内容由 CHILD_SOURCE 生成，内容一致就不重写）。 */
const CHILD_SCRIPT_NAME = 'vits-child.cjs';

/**
 * 解析跑合成的 Node 可执行文件。
 *
 * Node 宿主用自己（`process.execPath` 就是 node）；Electron 宿主**不能**用自己——那是
 * electron.exe，V8 memory cage 会拒掉 sherpa 的外部缓冲（连 ELECTRON_RUN_AS_NODE 也一样）。
 * 此时依次试 `$DSH_PET_NODE_BIN` → PATH 里的 `node`；都拿不到就让子进程起不来，
 * 由 {@link spawnChild} 翻译成可操作的报错。
 * @returns Node 可执行文件路径或命令名。
 */
export function resolveNodeBin(): string {
  const override = process.env[NODE_BIN_ENV];
  if (override && override.trim()) return override.trim();
  if (!process.versions.electron) return process.execPath;
  return 'node';
}

/** 子进程回传的 base64 样本 → Float32Array（同机同字节序，无需换序）。 */
function decodeSamples(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  const samples = new Float32Array(bytes.byteLength >> 2);
  Buffer.from(samples.buffer).set(bytes.subarray(0, samples.byteLength));
  return samples;
}

/** 两种外壳的应答都收口成 Float32Array：worker 直传，子进程走 base64。 */
function toSamples(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (typeof value === 'string' && value.length > 0) return decodeSamples(value);
  return null;
}

/** 把子进程脚本写到 voice 根下；内容一致就不动盘。 */
function ensureChildScript(voiceDir: string, content: string): string {
  const target = join(voiceDir, CHILD_SCRIPT_NAME);
  try {
    if (existsSync(target) && readFileSync(target, 'utf8') === content) return target;
  } catch {
    /* 读失败就当没有，下面重写 */
  }
  writeFileSync(target, content, 'utf8');
  return target;
}

/**
 * 起常驻 Node 子进程（仅 Electron 宿主用）：一行请求、一行应答，模型只加载一次。
 * @param voiceDir - voice 根（脚本落在这里）。
 * @param config - 子进程运行参数（runtimeDir / modelDir / numThreads）。
 * @param onReply - 收到一条应答。
 * @param onFail - 进程级失败（起不来、崩溃、退出）。
 * @returns 发送与收尸两个动作。
 */
function spawnChild(
  voiceDir: string,
  config: { runtimeDir: string; modelDir: string; numThreads: number },
  onReply: (raw: WorkerResponse) => void,
  onFail: (error: Error) => void,
): { post: (request: WorkerRequest) => void; dispose: () => void } {
  const nodeBin = resolveNodeBin();
  const script = ensureChildScript(voiceDir, CHILD_SOURCE);
  const child = spawn(nodeBin, [script, JSON.stringify(config)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-600);
  });
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let at = buffer.indexOf('\n');
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim()) {
        try {
          onReply(JSON.parse(line) as WorkerResponse);
        } catch {
          /* 半行/脏行：跳过这一行，别把整个后端判死 */
        }
      }
      at = buffer.indexOf('\n');
    }
  });
  child.on('error', (error: NodeJS.ErrnoException) => {
    onFail(
      error.code === 'ENOENT'
        ? new VoiceSynthError(
            `local voice needs a real Node.js when hosted by Electron (V8 memory cage blocks sherpa-onnx); set ${NODE_BIN_ENV} or put node on PATH`,
          )
        : error,
    );
  });
  child.on('exit', (code) => {
    const tail = stderrTail.trim();
    onFail(new Error(`vits child exited (code ${String(code)})${tail ? ': ' + tail : ''}`));
  });
  return {
    post: (request) => child.stdin?.write(`${JSON.stringify(request)}\n`),
    dispose: () => child.kill(),
  };
}

/**
 * 起后端（首次本地合成时调用一次）。
 *
 * 传输按运行时选：Node 用 worker_threads 线程；Electron 用独立 Node 子进程（原因见模块头，
 * 不是性能取舍而是硬限制）。两种传输共用同一套请求表与超时。
 * @param options - voice 根目录、线程数与测试注入点。
 * @returns 后端实例。
 * @throws {VoiceSynthError} 运行时或模型未部署时（给出 patch.mjs 提示）。
 */
function createBackend(options: { voiceDir: string; numThreads?: number }): VitsBackend {
  const voiceDir = options.voiceDir;
  const def = localVoiceDef('vits-theresa');
  const modelDir = def ? join(voiceDir, def.modelDir) : '';
  if (!runtimeInstalled(voiceDir) || !modelDir || !findModelOnnx(modelDir)) {
    throw new VoiceSynthError(
      `local voice not provisioned (missing sherpa-onnx runtime or model under ${voiceDir}); run "node patch.mjs" first`,
    );
  }
  const config = {
    runtimeDir: join(voiceDir, 'runtime'),
    modelDir,
    numThreads: options.numThreads ?? NUM_THREADS,
  };
  const pending = new Map<
    number,
    { resolve: (value: { samples: Float32Array; sampleRate: number }) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;
  let closed = false;
  /** 把一次失败广播给所有在等请求：传输死了就不再有下一次。 */
  const failAll = (error: Error): void => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  const onReply = (raw: WorkerResponse): void => {
    const entry = pending.get(raw.id);
    if (!entry) return;
    pending.delete(raw.id);
    const samples = toSamples(raw.samples);
    if (raw.ok && samples && raw.sampleRate) entry.resolve({ samples, sampleRate: raw.sampleRate });
    else entry.reject(new Error(raw.message || 'vits backend failed'));
  };
  let post: (request: WorkerRequest) => void;
  let shutdown: () => void;
  if (process.versions.electron) {
    const child = spawnChild(voiceDir, config, onReply, failAll);
    post = child.post;
    shutdown = child.dispose;
  } else {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: config });
    worker.unref();
    worker.on('message', onReply);
    worker.on('error', (error) => failAll(error instanceof Error ? error : new Error(String(error))));
    worker.on('exit', () => failAll(new Error('vits worker exited unexpectedly')));
    post = (request) => worker.postMessage(request);
    shutdown = () => void worker.terminate();
  }
  return {
    synthesize({ text, sid, speed }) {
      if (closed) return Promise.reject(new Error('vits backend disposed'));
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`vits synthesis timed out after ${SYNTH_TIMEOUT_MS}ms`));
        }, SYNTH_TIMEOUT_MS);
        timer.unref?.();
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        const request: WorkerRequest = { kind: 'synth', id, text, sid, speed };
        post(request);
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      failAll(new Error('vits backend disposed'));
      shutdown();
    },
  };
}

/**
 * 取当前后端；没有就按给定目录现起一个。
 * @param options - voice 根目录（生产环境由 resolveVoiceDir 给出）。
 * @returns 后端实例。
 */
function ensureBackend(options: { voiceDir: string }): VitsBackend {
  if (!backend) backend = createBackend(options);
  return backend;
}

/**
 * 销毁 worker；插件卸载时由宿主生命周期调用，测试间隔离也用它。
 * 迟到的调用是安全的——没有 worker 时什么也不做。
 */
export function disposeVits(): void {
  backend?.dispose();
  backend = null;
}

/**
 * 把一段文本用本地 VITS 合成到目标 WAV。
 *
 * 与 edge.ts 同一套落盘纪律：先写 `<target>.part` 再改名，中途失败不留半截文件被缓存命中。
 * 语速映射：edge 的 `+N%` 百分比换算成 VITS 的 speed（+10% → 1.1）。
 *
 * @param input - 文本、音色（必须是本地音色 id）、语速与目标路径。
 * @param voiceDir - 运行时与模型所在目录，由调用方按 {@link resolveVoiceDir} 算好。
 * @throws {VoiceSynthError} 运行时/模型未部署、推理失败或超时时。
 */
export async function synthesizeVits({ text, voice, rate, target }: SynthInput, voiceDir: string): Promise<void> {
  const def = localVoiceDef(voice);
  if (!def) throw new VoiceSynthError('not a local voice: ' + voice);
  const staging = `${target}.part`;
  try {
    const result = await ensureBackend({ voiceDir }).synthesize({
      text,
      sid: def.sid,
      speed: (100 + (Number.parseFloat(rate.slice(1, -1)) || 0)) / 100,
    });
    await writeFileAtomic(staging, encodeWav(result.samples, result.sampleRate), target);
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
}

/** 先写临时文件再改名；失败时清掉残件。 */
async function writeFileAtomic(staging: string, bytes: Uint8Array, target: string): Promise<void> {
  try {
    await writeFile(staging, bytes);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }
}
