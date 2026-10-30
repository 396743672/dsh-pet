#!/usr/bin/env node
/**
 * dsh-pet 本地语音（VITS）一键部署 / 恢复脚本（幂等）。
 *
 * 作用：把本地神经网络语音的运行环境部署到**插件自己的安装目录**下的 `voice/`，
 * 插件升级后重跑一遍即可恢复，重复执行不会重复下载或破坏既有内容。
 *
 *   node patch.mjs                     # 部署 / 修复（缺什么补什么，齐了就跳过）
 *   node patch.mjs --check             # 只检查状态，不做任何改动（全部就绪退出码 0，否则 1）
 *   node patch.mjs --set-voice         # 部署之外，把用户配置切成德丽莎音并打开语音总开关
 *   node patch.mjs --target <插件目录>  # 插件装在别处（如 dsh plugin add 装进 profile）时指过去
 *
 * 目录口径与插件 src/host/voice/vits.ts 的 resolveVoiceDir() 完全一致——**跟着软件自己的位置走**：
 *   <插件包根>/voice/
 *     runtime/                     # npm 前缀：sherpa-onnx-node + 平台二进制包装在这里
 *     vits-zh-hf-theresa/          # 模型目录（tarball 解压，含 .onnx / lexicon.txt / tokens.txt / dict）
 *
 * 插件包根 = 本脚本旁边的 `dsh-pet/`（`--target` 可指定）。全程不出现用户目录，也不需要
 * 知道 DSH 数据根在哪；只有 `--set-voice` 改配置时才去 `<$DSH_HOME>/dsh-pet/main-config.jsonc`。
 * 确实要把模型放别处（共享盘等）就设 DSH_PET_VOICE_DIR 直指 voice 根，插件读的也是它。
 * 下载走 curl，需要代理时先设置 HTTPS_PROXY / HTTP_PROXY 环境变量再运行本脚本。
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 本地音色与模型的唯一事实来源，必须与 src/host/voice/voices.ts 的 LOCAL_VOICE_DEFS 一致。 */
const MODEL_DIR_NAME = "vits-zh-hf-theresa";
/** 模型 tarball（sherpa-onnx 官方 tts-models Release）。 */
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_DIR_NAME}.tar.bz2`;
/** 锁定的运行时版本：sherpa-onnx Node 绑定 API 在 2.x 有过形状变化，pin 死保证可复现。 */
const SHIPA_VERSION = "2.0.1";
/** 国内默认走镜像源；用 DSH_PET_NPM_REGISTRY 覆盖。 */
const NPM_REGISTRY =
  process.env.DSH_PET_NPM_REGISTRY ?? "https://registry.npmmirror.com";

/** 原始参数（`--target` 要取值，不能只靠 Set 判存在）。 */
const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs);
const checkOnly = flags.has("--check");
const setVoice = flags.has("--set-voice");

/** 脚本自身所在目录（正常情况下就是仓库根，插件包是它旁边的 `dsh-pet/`）。 */
const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * 插件包根：**软件自己装在哪，就用哪儿**。
 *
 * `--target` 显式指定优先，否则取脚本旁边的 `dsh-pet/`。会校验目录里确实有 dsh-pet 的
 * package.json——否则一个参数写错就往错误的目录里刨进 100 多 MB 的 runtime 与模型。
 */
function resolvePluginDir() {
  const at = rawArgs.indexOf("--target");
  const explicit = at >= 0 ? rawArgs[at + 1] : undefined;
  const dir = explicit
    ? resolve(explicit.replace(/^~(?=$|[\\/])/, homedir()))
    : join(scriptDir, "dsh-pet");
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) {
    console.error(`✗ 这里不像插件包：${dir}`);
    console.error(
      "  该目录需要有 package.json；插件装在别处（如 dsh plugin add 装进 profile）时用 --target <插件目录> 指过去。",
    );
    process.exit(2);
  }
  try {
    const name = JSON.parse(readFileSync(manifest, "utf8")).name;
    if (name !== "dsh-pet") {
      console.error(
        `✗ ${dir} 的 package.json name 是 ${JSON.stringify(name)}，不是 dsh-pet。`,
      );
      process.exit(2);
    }
  } catch (error) {
    console.error(`✗ 读不了 ${manifest}：${error.message}`);
    process.exit(2);
  }
  return dir;
}

const pluginDir = resolvePluginDir();

/**
 * voice 根目录；与插件 resolveVoiceDir() 同一套规则：
 * `DSH_PET_VOICE_DIR` 覆盖，否则 `<插件包根>/voice`。与用户目录、DSH 数据根都无关。
 */
const voiceRoot = (() => {
  const override = (process.env.DSH_PET_VOICE_DIR ?? "").trim();
  return override || join(pluginDir, "voice");
})();
const runtimeDir = join(voiceRoot, "runtime");
const modelDir = join(voiceRoot, MODEL_DIR_NAME);

/**
 * 解析 DSH 数据根（**只用于 --set-voice 改配置**，与语音目录无关）。
 *
 * 优先级与官方 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` 一致：显式 `$DSH_HOME`
 * （空串 / 纯空白视为未设，绝不落成 cwd）→ 否则 `~/.dsh`；支持 `~` 前缀。
 * 这里不 import 那个包：patch.mjs 要在用户机器上直接跑，不能依赖插件的 node_modules 是否完整。
 */
function resolveDshHome() {
  const raw = (process.env.DSH_HOME ?? "").trim();
  if (!raw) return join(homedir(), ".dsh");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\"))
    return join(homedir(), raw.slice(2));
  return resolve(raw);
}

/** 打印状态行。 */
function report(label, ok, detail = "") {
  console.log(
    `  [${ok ? "OK" : "缺"}] ${label}${detail ? ` — ${detail}` : ""}`,
  );
  return ok;
}

/** 运行时是否就绪：sherpa-onnx-node 已装进 runtime。 */
function runtimeReady() {
  return existsSync(
    join(runtimeDir, "node_modules", "sherpa-onnx-node", "package.json"),
  );
}

/** 模型是否就绪：目录里同时有主模型 onnx、lexicon 与 tokens。 */
function modelReady() {
  if (!existsSync(modelDir)) return false;
  const names = new Set(readdirSync(modelDir));
  return (
    [...names].some((name) => name.endsWith(".onnx")) &&
    names.has("lexicon.txt") &&
    names.has("tokens.txt")
  );
}

/** 安装 sherpa-onnx-node（平台二进制经 optionalDependencies 自动就位）。 */
function installRuntime() {
  console.log(
    `→ 安装 sherpa-onnx 运行时 v${SHIPA_VERSION}（registry: ${NPM_REGISTRY}）…`,
  );
  mkdirSync(runtimeDir, { recursive: true });
  // Windows 下 npm 是 npm.cmd，spawnSync 直接调 npm 会 ENOENT，靠 shell 解析
  const result = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      runtimeDir,
      `sherpa-onnx-node@${SHIPA_VERSION}`,
      `--registry=${NPM_REGISTRY}`,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) {
    console.error("✗ 运行时安装失败。若网络不通，请先设置代理环境变量后重试：");
    console.error("    set HTTPS_PROXY=http://127.0.0.1:7897  (Windows)");
    console.error(
      "    export HTTPS_PROXY=http://127.0.0.1:7897  (macOS / Linux)",
    );
    process.exit(1);
  }
}

/** 下载并解压模型 tarball；优先 curl（三端都有），必要时提示代理。 */
function downloadModel() {
  console.log(`→ 下载模型 ${MODEL_DIR_NAME}（约 100+ MB）…`);
  mkdirSync(voiceRoot, { recursive: true });
  const archive = join(tmpdir(), `${MODEL_DIR_NAME}.tar.bz2`);
  const curl = spawnSync(
    "curl",
    [
      "-fL",
      "--retry",
      "3",
      "--connect-timeout",
      "30",
      "-o",
      archive,
      MODEL_URL,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (curl.status !== 0) {
    console.error(
      "✗ 模型下载失败。GitHub 需要代理时先设置 HTTPS_PROXY 再重跑本脚本；",
    );
    console.error(
      `  或手动下载 ${MODEL_URL} 并解压到 ${voiceRoot}（解出 ${MODEL_DIR_NAME}/ 目录即可）。`,
    );
    process.exit(1);
  }
  console.log(`→ 解压到 ${voiceRoot} …`);
  // Windows 必须用系统自带 bsdtar（System32\tar.exe）：Git Bash 的 GNU tar 会把 `C:\...` 当远程主机名。
  // shell 关掉，参数数组直传，路径带空格也不会被二次拆分。
  const tarExe =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  let extract = spawnSync(tarExe, ["-xjf", archive, "-C", voiceRoot], {
    stdio: "inherit",
  });
  if (extract.status !== 0)
    extract = spawnSync(tarExe, ["-xf", archive, "-C", voiceRoot], {
      stdio: "inherit",
    });
  if (extract.status !== 0 || !modelReady()) {
    console.error(
      `✗ 解压失败。请手动解压 ${archive} 到 ${voiceRoot}（解出 ${MODEL_DIR_NAME}/ 目录即可）。`,
    );
    process.exit(1);
  }
  rmSync(archive, { force: true });
}

/**
 * 旧版本把语音部署在 DSH 数据根下（`<$DSH_HOME>/dsh-pet/voice`），搬过来免掉重下 100+ MB。
 * 只在部署模式调用（`--check` 保持只读）；同盘 rename 很快，跨盘失败就留给后面的正常下载。
 * @returns 是否真的搬过。
 */
function migrateLegacyVoice() {
  const legacy = join(resolveDshHome(), "dsh-pet", "voice");
  if (legacy === voiceRoot || !existsSync(legacy)) return false;
  if (runtimeReady() && modelReady()) return false; // 新位置已经齐了，旧的不动
  mkdirSync(voiceRoot, { recursive: true });
  let moved = false;
  for (const name of readdirSync(legacy)) {
    const from = join(legacy, name);
    const to = join(voiceRoot, name);
    if (existsSync(to)) continue;
    try {
      renameSync(from, to);
      moved = true;
    } catch {
      /* 跨盘 / 占用：这一项就算了，后面会按需重下 */
    }
  }
  if (!moved) return false;
  // 只在搬空之后删旧壳，避免误删没搬成功的文件
  try {
    if (readdirSync(legacy).length === 0) rmSync(legacy, { recursive: true });
  } catch {
    /* 残留空目录不影响使用 */
  }
  console.log(`→ 已从旧位置搬迁：${legacy}\n  → ${voiceRoot}`);
  return true;
}

/** 把用户配置切成本地德丽莎音：改 voiceName + 打开 voiceEnabled（JSONC 行级替换，不碰注释）。 */
function applyVoiceConfig() {
  // 用户主配置属于 DSH 数据（跟着 DSH 自己的数据根），与语音目录无关
  const userConfigPath = join(resolveDshHome(), "dsh-pet", "main-config.jsonc");
  if (!existsSync(userConfigPath)) {
    // 全新安装时数据根可能还不存在（插件没跑过）：先建目录，否则写文件 ENOENT
    mkdirSync(dirname(userConfigPath), { recursive: true });
    writeFileSync(
      userConfigPath,
      `{\n  "voiceEnabled": true,\n  "voiceName": "vits-theresa"\n}\n`,
      "utf8",
    );
    console.log(`→ 已创建 ${userConfigPath}（德丽莎音 + 语音总开关开）`);
    return;
  }
  let text = readFileSync(userConfigPath, "utf8");
  let changed = false;
  // 只匹配「行首就是该键」的真配置行，注释里的同名提及不受影响
  const nameLine = /^\s*"voiceName"\s*:\s*"[^"]*"/m;
  if (nameLine.test(text)) {
    const next = text.replace(nameLine, (match) =>
      match.replace(/"[^"]*"\s*$/, '"vits-theresa"'),
    );
    if (next !== text) {
      text = next;
      changed = true;
    }
  } else {
    text = text.replace(/\{/, `{\n  "voiceName": "vits-theresa",`);
    changed = true;
  }
  const enabledLine = /^\s*"voiceEnabled"\s*:\s*(true|false)/m;
  if (enabledLine.test(text)) {
    const next = text.replace(enabledLine, (match) =>
      match.replace(/true|false/, "true"),
    );
    if (next !== text) {
      text = next;
      changed = true;
    }
  } else {
    text = text.replace(/\{/, `{\n  "voiceEnabled": true,`);
    changed = true;
  }
  if (changed) {
    writeFileSync(userConfigPath, text, "utf8");
    console.log(
      `→ 已更新 ${userConfigPath}（voiceName=vits-theresa，voiceEnabled=true）`,
    );
  } else {
    console.log(`→ ${userConfigPath} 已是德丽莎音，无需改动`);
  }
}

/** 主流程。 */
function main() {
  const overridden = (process.env.DSH_PET_VOICE_DIR ?? "").trim() !== "";
  console.log(`dsh-pet 本地语音部署（跟随插件安装位置）\n`);
  console.log(`  插件目录：${pluginDir}`);
  console.log(
    `  voice 根：${voiceRoot}${overridden ? "（DSH_PET_VOICE_DIR 覆盖）" : ""}\n`,
  );
  // 部署模式先尝试从旧位置（DSH 数据根）搬过来，避免白下 100+ MB
  if (!checkOnly) migrateLegacyVoice();
  const runtimeOk = report("sherpa-onnx 运行时（runtime/）", runtimeReady());
  const modelOk = report(`模型（${MODEL_DIR_NAME}/）`, modelReady());

  if (checkOnly) {
    console.log(
      `\n--check：全部就绪退出码 0；有缺失退出码 1。${runtimeOk && modelOk ? "当前：就绪。" : "当前：未就绪。"}`,
    );
    process.exit(runtimeOk && modelOk ? 0 : 1);
  }

  if (!runtimeOk) installRuntime();
  if (!modelOk) downloadModel();

  if (setVoice) applyVoiceConfig();

  console.log("\n完成。接下来：");
  console.log("  1. 先听一句不装插件的声音（最快验证）：");
  console.log(
    "       cd dsh-pet && node --experimental-strip-types scripts/smoke-vits.mjs --play",
  );
  console.log("  2. 设置页「语音」打开播报总开关（或已由 --set-voice 打开）；");
  console.log("  3. 音色下拉选「德丽莎（女 · 本地 · 萝莉）」，保存；");
  console.log(
    "  4. 宿主半侧改动要重开 DSH 生效，浏览器 overlay 刷新页面即可。",
  );
  // 单进程桌宠应用（Electron）里推理走独立 Node 子进程：Electron 的 V8 memory cage 禁止
  // sherpa-onnx 的外部缓冲区（连 ELECTRON_RUN_AS_NODE 也一样），必须有个真 Node。
  console.log(
    "\n注：`npm run start:app` 这类单进程桌面应用还需要系统里有 node（PATH 或 DSH_PET_NODE_BIN）；" +
      "在 DSH 宿主里不需要，那边本来就在 Node 上跑。",
  );
}

main();
