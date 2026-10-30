/**
 * 本地 VITS 真实合成冒烟（一次性脚本，不进测试套件）。**不需要 DSH、不需要装插件。**
 *
 * 两种跑法：
 *   默认        直连 vits.ts：起 worker → 加载 sherpa-onnx + 模型 → 推理 → WAV 落盘。
 *               只验「模型 + 运行时 + 音色」这一层，最快听到声音。
 *   --service   走插件的语音服务（createVoiceService）：校验 → 音色路由 → 本地合成 → 缓存落盘。
 *               多验一层「speak 真的把 vits-theresa 路由到本地后端并返回 audio/wav」，第二次跑
 *               会打印 cache=hit，可据此确认缓存也通。
 *
 * 常用参数：
 *   --play              合成完用系统播放器打开
 *   --text "要说的话"    换一句
 *
 * 用法：node --experimental-strip-types scripts/smoke-vits.mjs [--service] [--play] [--text "..."]
 * 目录口径与插件一致：`DSH_PET_VOICE_DIR` → 否则插件安装目录下的 `voice/`（见 patch.mjs）。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { disposeVits, resolveVoiceDir, synthesizeVits } from '../src/host/voice/vits.ts';

const argv = process.argv.slice(2);
const play = argv.includes('--play');
const viaService = argv.includes('--service');
const textAt = argv.indexOf('--text');
const text = textAt >= 0 && argv[textAt + 1] ? argv[textAt + 1] : '主人，德丽莎本地语音已经上线了哦，测试一下。';

// 本脚本从 src/ 直接跑（不是 lib/ 产物），paths.ts 的 PACKAGE_ROOT 在源码形态下会算成 src/，
// 所以这里显式取「脚本所在目录的上一级」当插件包根——源码跑与打包后跑都对。
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const voiceDir = resolveVoiceDir(packageRoot);
// 合成缓存属于用户数据，仍在 DSH 数据根（与语音目录解耦：模型跟安装目录、缓存跟数据根）
const userRoot = join(resolveDshHome(), 'dsh-pet');

/** 打印一段 WAV 的可核对信息。 */
function describe(file) {
  const { size } = statSync(file);
  const bytes = readFileSync(file);
  const head = bytes.subarray(0, 4).toString('ascii');
  if (head !== 'RIFF') throw new Error(`不是合法 WAV（头是 ${head}）`);
  const sampleRate = bytes.readUInt32LE(24);
  const seconds = (size - 44) / 2 / sampleRate;
  return `${(size / 1024).toFixed(1)} KiB · ${sampleRate} Hz · ${seconds.toFixed(2)}s 音频`;
}

/** 播放器打开（打不开也不算失败，文件路径已打印）。 */
function open(file) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', file]]
      : process.platform === 'darwin'
        ? ['open', [file]]
        : ['xdg-open', [file]];
  spawnSync(cmd, args, { stdio: 'ignore' });
}

const started = Date.now();
try {
  /** @type {string} */
  let file;
  if (viaService) {
    const { createVoiceService } = await import('../src/host/voice/speak.ts');
    const service = createVoiceService({
      userRoot,
      // 日志里带 cache=hit / cache=miss 与 ms，是最直接的证据
      log: {
        info: (line) => console.log(`  ${line}`),
        warn: (line) => console.error(`  ${line}`),
      },
    });
    const result = await service.speak({ text, voice: 'vits-theresa', rate: '+0%' });
    if (!result.ok) throw new Error(`speak 失败：${result.reason}（${result.message}）`);
    file = result.file;
    console.log(`语音服务返回：${file}`);
    console.log(
      `  contentType=${result.contentType}${result.contentType === 'audio/wav' ? '（本地音色走 wav，符合预期）' : '（应为 audio/wav，检查音色路由）'}`,
    );
  } else {
    mkdirSync(voiceDir, { recursive: true });
    file = join(voiceDir, 'smoke.wav');
    await synthesizeVits({ text, voice: 'vits-theresa', rate: '+0%', target: file }, voiceDir);
    console.log(`合成成功：${file}`);
  }
  console.log(`  ${describe(file)} · 耗时 ${Date.now() - started}ms（首句含加载模型）`);
  if (play) {
    open(file);
    console.log('已调用系统播放器；没声音就手动双击上面那个文件。');
  } else {
    console.log('试听：双击上面的文件播放，或加 --play 自动打开。');
  }
} finally {
  disposeVits();
}
