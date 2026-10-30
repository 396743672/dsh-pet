/**
 * 端侧语音播报：按 `say` 叶子决定这一句要不要念，以及合成请求与播放。
 *
 * 两端各判各的：叶子里的 `voiceTo` 指向哪一端，就只有那一端出声；缺省 = 谁都不念。
 * 网页端另加一道「页面可见」——被切到后台的页面没人看，出声只是打扰。
 * 音色与总开关经 `setVoiceConfig` 从成品配置注入；手动点播（对话面板的喇叭）不受这些门控。
 * 不负责合成与缓存：那些在宿主侧（`/voice/speak`）。
 * @module dsh-pet/src/shared/voice
 */
import { ROUTE_PATH } from './constants.ts';
import type { VoiceTarget } from './state.ts';

/** 当前音色；空串 = 不指定，由宿主用默认音色。 */
let voiceName = '';
/** 播报总开关；只有成品配置明确为 true 才播。 */
let voiceEnabled = false;
/** 本端是网页端还是桌面端；`null` = 还没声明，此时不按叶子播放。 */
let surface: VoiceTarget | null = null;
/** 接口基址：网页端是同源前缀，桌面端由 `setVoiceBase` 换成 bridge 地址。 */
let voiceBase = ROUTE_PATH;
/** 配置是否已就绪；网页端由 `setVoiceConfig` 置位，桌面端首次播放时懒加载。 */
let configLoaded = false;
/** 当前播报状态；气泡据此显示图标。 */
let voiceState: VoiceState = 'idle';
/** 状态订阅者：两端的说话气泡据此渲染图标。 */
const stateListeners = new Set<(state: VoiceState) => void>();

/** 语音播报对外的四种状态；只用于展示，不接受外部驱动。`failed` = 这次合成没成功。 */
export type VoiceState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * 客户端等合成结果的上限（ms）。
 *
 * 比宿主侧第三方合成的超时（15s）再宽一点：让宿主先超时并回结构化失败，
 * 客户端这道只是兜底，避免上游挂住时气泡上的转圈永远停不下来。
 */
const SPEAK_TIMEOUT_MS = 20_000;

/** 合成请求的超时信号；自动播报与手动点播共用同一份口径。 */
function speakSignal(): AbortSignal {
  return AbortSignal.timeout(SPEAK_TIMEOUT_MS);
}

/** 切换状态并通知订阅者；同值不重复通知。 */
function setVoiceState(next: VoiceState): void {
  if (voiceState === next) return;
  voiceState = next;
  for (const listener of stateListeners) listener(next);
}

/**
 * 读当前播报状态；桌面端在重绘气泡时直接取（它没有 react 的订阅机制）。
 * @returns `idle` / `loading` / `ready`。
 */
export function getVoiceState(): VoiceState {
  return voiceState;
}

/**
 * 订阅播报状态；订阅时会立刻收到当前值。
 * @param listener - 状态变化回调。
 * @returns 取消订阅；组件卸载/气泡关闭时必须调用。
 */
export function subscribeVoiceState(listener: (state: VoiceState) => void): () => void {
  stateListeners.add(listener);
  listener(voiceState);
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * 换掉接口基址；桌面端在模块加载时调一次（`file://` 页面不能用相对路径）。
 * @param base - 已含前缀的地址，如 `dsh-pet-bridge://dsh-pet/dsh-pet-7340`。
 */
export function setVoiceBase(base: unknown): void {
  if (typeof base === 'string' && base) voiceBase = base;
}

/**
 * 声明本端是网页端还是桌面端；两端各自在启动时调一次。
 * 没声明时不按 `say` 叶子播放——宁可没声音，也不替另一端出声。
 * @param next - `web` / `desktop`；其余值忽略。
 */
export function setSurface(next: unknown): void {
  if (next === 'web' || next === 'desktop') surface = next;
}

/**
 * 记录成品配置里的音色与总开关；网页端在读到 `/config` 时调一次。
 * 调用即视为配置已就绪，后续播放不再自己去拉。
 * @param name - 音色 id（非字符串按未指定处理）。
 * @param enabled - 播报总开关（严格 `=== true` 才算开启）。
 */
export function setVoiceConfig(name: unknown, enabled: unknown): void {
  const next = typeof name === 'string' ? name : '';
  // 换音色必须让音效缓存整体作废：语气词是「用当时那个音色」合成的，留着旧 blob 就会出现
  // 「设置里改了、点一下还是旧声音」——而这段代码本来就是为了让改音色立刻生效。
  if (next !== voiceName) {
    cueBlobs.clear();
    cuePending.clear();
    cueWarmed = false;
  }
  voiceName = next;
  voiceEnabled = enabled === true;
  configLoaded = true;
  prewarmCues(); // 音色已知才预热短语音效（开关开着时才会真的发合成请求）
}

/** 懒加载成品配置；失败按「不播」处理，且只试一次（避免每句都发请求）。 */
async function loadConfigOnce(): Promise<void> {
  if (configLoaded) return;
  try {
    const response = await fetch(voiceBase + '/config', { cache: 'no-store' });
    const body = (await response.json()) as { main?: Record<string, unknown> } | null;
    const main = body?.main;
    voiceName = typeof main?.voiceName === 'string' ? main.voiceName : '';
    voiceEnabled = main?.voiceEnabled === true;
    // 只有成功才置位：拉不到（bridge 还没就绪 / 瞬时故障）留给下一句重试——
    // 否则一次失败就把这一端永久静音了。
    configLoaded = true;
  } catch {
    /* 拉不到就保持关闭：宁可没声音，也不乱播 */
  }
}

/**
 * 按 `say` 叶子播放：叶子指定了本端、且总开关开着才念。
 *
 * 三个门依次是：叶子有没有点名本端 → 网页端页面是否可见 → 成品配置的总开关。
 * 任何一道没过都只把状态归回 `idle`，气泡照常显示，不打断渲染。
 *
 * @param say - 要念的那一句：`text` 正文，`voiceTo` 该由哪一端念。
 */
export function playSayVoice(say: { readonly text: string; readonly voiceTo?: VoiceTarget }): void {
  const isMine = say.voiceTo !== undefined && say.voiceTo === surface;
  if (!say.text || !isMine) {
    setVoiceState('idle');
    return;
  }
  if (surface === 'web' && typeof document !== 'undefined' && document.hidden) {
    setVoiceState('idle');
    return;
  }
  void speakIfEnabled(say.text); // 不 await：播放是旁路，不能挡住气泡与动画
}

/** 确认配置后再播；桌面端首次调用会顺手拉一次 `/config`。 */
async function speakIfEnabled(text: string): Promise<void> {
  await loadConfigOnce();
  if (!voiceEnabled) {
    setVoiceState('idle');
    return;
  }
  setVoiceState('loading');
  await speak(text);
}

/** 请求合成并播放；任何一步失败都落到 `failed`（气泡上留一个静音喇叭，而不是干脆没图标）。 */
async function speak(text: string): Promise<void> {
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
      signal: speakSignal(),
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      setVoiceState('failed');
      return;
    }
    const handle = await playBlob(await response.blob());
    if (!handle) {
      setVoiceState('failed');
      return;
    }
    // 播放引擎就绪即置 ready：喇叭表示「这句有语音」，不跟播放进度绑定
    setVoiceState('ready');
    if ((await handle.done) === 'failed') setVoiceState('failed');
  } catch {
    /* 含超时：气泡已经显示，失败也不能反过来打断渲染，只把图标换成静音喇叭 */
    setVoiceState('failed');
  }
}

/** 全页共享的 Web Audio 上下文；懒创建，失败由调用方兜底。 */
let audioContext: AudioContext | null = null;

/** 一次已开跑的播放：`done` 在播完（或被 `stop`）时给 `ended`，无法播放时给 `failed`。 */
interface PlaybackHandle {
  stop(): void;
  readonly done: Promise<'ended' | 'failed'>;
}

/**
 * 播一段音频 blob：首选 Web Audio（`AudioContext.decodeAudioData` + `BufferSource`，mp3/wav 通吃），
 * 环境不支持或解码失败时回落到 `HTMLAudioElement`——两端最终都收敛成同一个 {@link PlaybackHandle}。
 * @param blob - 合成接口返回的音频（audio/mpeg 或 audio/wav）。
 * @returns 播放句柄；两种引擎都起不来时给 null。
 */
async function playBlob(blob: Blob): Promise<PlaybackHandle | null> {
  try {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (Ctor) {
      const context = audioContext ?? (audioContext = new Ctor());
      if (context.state === 'suspended') await context.resume();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const done = new Promise<'ended' | 'failed'>((resolve) => {
        source.onended = () => resolve('ended');
      });
      source.start();
      return {
        done,
        stop: () => {
          try {
            source.stop();
          } catch {
            /* 已经播完，onended 已走 */
          }
        },
      };
    }
  } catch {
    /* 落到 HTMLAudio 兜底：多半是 AudioContext 被自动播放策略挂起 */
  }
  return playViaElement(blob);
}

/** HTMLAudio 兜底播放；语义与 Web Audio 路径一致（`done` 区分播完与失败）。 */
function playViaElement(blob: Blob): PlaybackHandle | null {
  try {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    // 收尾函数由 Promise 执行器同步赋值：撤销 blob 引用只做一次，结束状态只取先到的那个
    let finish: (outcome: 'ended' | 'failed') => void = () => undefined;
    const done = new Promise<'ended' | 'failed'>((resolve) => {
      finish = (outcome) => {
        URL.revokeObjectURL(objectUrl);
        resolve(outcome);
      };
    });
    audio.onended = () => finish('ended');
    audio.onerror = () => finish('failed');
    void audio.play().catch(() => finish('failed'));
    return {
      done,
      stop: () => {
        audio.pause();
        finish('ended');
      },
    };
  } catch {
    return null;
  }
}

/** 手动点播时正在响的那个播放；新的一句先掐掉旧的，避免两句话叠在一起。 */
let manualHandle: PlaybackHandle | null = null;

/** 手动点播对外暴露的阶段；`idle` = 没在放（含被打断），`failed` = 合成没成功。 */
export type SpeakPhase = 'idle' | 'loading' | 'playing' | 'failed';

/** 手动点播的世代号：新的点播会作废旧请求的阶段回调，避免旧回调清掉新状态。 */
let manualSeq = 0;

/**
 * 手动播报一句（对话面板的喇叭按钮用）。
 *
 * 与自动播报有两点不同：不看待播标记（用户点的就是这一句），也不受总开关限制——
 * 开关管的是「自动念不念」，用户主动点播是明确意图。音色仍取配置值。
 *
 * @param text - 要念的正文。
 * @param onPhase - 阶段回调：请求合成时 `loading`、音频就绪开始播时 `playing`、播完 `idle`、失败或超时 `failed`。
 */
export function speakText(text: string, onPhase?: (phase: SpeakPhase) => void): void {
  if (!text) return;
  void playManual(text, onPhase);
}

/** 请求合成并播放手动点播；失败静默，不打断面板交互。 */
async function playManual(text: string, onPhase?: (phase: SpeakPhase) => void): Promise<void> {
  const token = ++manualSeq;
  await loadConfigOnce();
  if (manualHandle) {
    manualHandle.stop();
    manualHandle = null;
  }
  if (token !== manualSeq) return; // 等配置期间又被点了一次：这次直接让位
  onPhase?.('loading');
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
      signal: speakSignal(),
    });
    if (token !== manualSeq) return;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      onPhase?.('failed');
      return;
    }
    const handle = await playBlob(await response.blob());
    if (token !== manualSeq) return;
    if (!handle) {
      onPhase?.('failed');
      return;
    }
    manualHandle = handle;
    onPhase?.('playing');
    const outcome = await handle.done;
    if (token !== manualSeq) return; // 播放期间被新的一次点播作废：状态归新的那次管
    if (manualHandle === handle) manualHandle = null;
    onPhase?.(outcome === 'ended' ? 'idle' : 'failed');
  } catch {
    /* 含超时：面板里还有文字，不弹错误打断阅读，只把按钮换成失败态 */
    if (token === manualSeq) onPhase?.('failed');
  }
}

// ============================ 短语音效（点击 / 菜单点播） ============================

/**
 * 音效种类。
 *
 * 只覆盖「用户主动发起」的两类动作：点击宠物、右键菜单点播动画。
 * 待机与随机漫游不发声——那些几秒一次，出声就是噪音。
 */
export type CueKind = 'click';

/**
 * 每类音效的候选短句（纯语气词，不含信息）。
 *
 * 用当前音色合成，所以换音色后这些短句跟着换人；内容刻意极短（1–3 字），
 * 合成快、缓存小、播完不拖沓。点播动作的出声走 playActionLine（台词或动作名），不在此列。
 */
const CUE_TEXTS: Record<CueKind, readonly string[]> = {
  click: ['嗯？', '干嘛？', '哼'],
};

/** 音效开关；由成品配置的 `clickSoundEnabled` 注入（与「点击音效」是同一个开关）。 */
let cueEnabled = false;
/** 已合成的短语音频；内存留一份，避免每次点击都重新解 blob。 */
const cueBlobs = new Map<string, Blob>();
/** 正在合成的短句；同一句并发点了两下也只发一次请求。 */
const cuePending = new Map<string, Promise<Blob | null>>();
/** 预热只做一次（每端一次）。 */
let cueWarmed = false;
/** 音效节流窗口：连点不该变成一串「嗯？」。 */
const CUE_THROTTLE_MS = 150;
/** 上一次播放音效的时刻。 */
let lastCueAt = 0;
/** 音效合成超时：点击这种交互等不起 20s，宁可回落到内置音效。 */
const CUE_TIMEOUT_MS = 6000;
/** 逐动作台词的合成超时：台词比语气词长（可达十几字），给到与整句播报接近的宽限。 */
const ACTION_LINE_TIMEOUT_MS = 15_000;

/**
 * 打开或关闭短语音效。
 * @param enabled - 成品配置里的 `clickSoundEnabled`（严格 `=== true` 才算开）。
 */
export function setCueEnabled(enabled: unknown): void {
  cueEnabled = enabled === true;
  prewarmCues();
}

/**
 * 预热：把每句语气词先合成一遍（宿主侧落盘缓存，之后命中只要十几毫秒）。
 *
 * 必须在音色已知之后才会真的跑（`configLoaded`），否则会拿默认音色合成一批用不上的音频。
 * 串行执行：宿主合成队列只有 3 个名额，并发只会互相挤掉。
 */
export function prewarmCues(): void {
  if (cueWarmed || !cueEnabled || !configLoaded) return;
  cueWarmed = true;
  void (async () => {
    for (const text of new Set(Object.values(CUE_TEXTS).flat())) {
      await loadCue(text);
    }
  })();
}

/**
 * 播一个音效；开关关闭、节流中或环境不支持时静默返回。
 *
 * 首选当前音色的短语气词；合成失败（没部署本地语音、断网、宿主拒绝）时退回内置的
 * `click-duck.wav`——「点了没反应」比音色不统一更糟。
 *
 * @param kind - 音效种类：点击 / 菜单点播。
 */
export function playCue(kind: CueKind): void {
  if (!cueEnabled) return;
  const now = Date.now();
  if (now - lastCueAt < CUE_THROTTLE_MS) return;
  lastCueAt = now;
  const texts = CUE_TEXTS[kind];
  const text = texts[Math.floor(Math.random() * texts.length)] ?? texts[0];
  const cached = cueBlobs.get(text);
  if (cached) {
    void playBlob(cached);
    return;
  }
  void loadCue(text).then((blob) => {
    if (blob) void playBlob(blob);
    else playFallbackSound();
  });
}

/**
 * 播一句「逐动作台词」（配置 `actionVoiceLines` 里给该动作写的那句话）。
 *
 * 门控与节流和 {@link playCue} 同一套：同一个「音效」开关管两件事——它是动作音效的增强，
 * 不是新的语音播报通道，不该绕过用户关掉的静音；节流共用一个窗口，连点不会叠声。
 * 缓存复用 cueBlobs（键是文本），换音色时随整体一起作废。
 * 台词没配 / 合成失败都由调用方决定要不要回落固定确认音。
 *
 * @param text - 该动作配置的台词正文。
 */
export function playActionLine(text: string): void {
  if (!cueEnabled || !text) return;
  const now = Date.now();
  if (now - lastCueAt < CUE_THROTTLE_MS) return;
  lastCueAt = now;
  const cached = cueBlobs.get(text);
  if (cached) {
    void playBlob(cached);
    return;
  }
  void loadCue(text, ACTION_LINE_TIMEOUT_MS).then((blob) => {
    if (blob) void playBlob(blob);
    else playFallbackSound();
  });
}

/** 合成一句短语音频并留在内存；失败给 null（调用方回落内置音效）。 */
function loadCue(text: string, timeoutMs = CUE_TIMEOUT_MS): Promise<Blob | null> {
  const cached = cueBlobs.get(text);
  if (cached) return Promise.resolve(cached);
  const pending = cuePending.get(text);
  if (pending) return pending;
  const task = (async (): Promise<Blob | null> => {
    try {
      const response = await fetch(voiceBase + '/voice/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) return null;
      const blob = await response.blob();
      cueBlobs.set(text, blob);
      return blob;
    } catch {
      return null;
    } finally {
      cuePending.delete(text);
    }
  })();
  cuePending.set(text, task);
  return task;
}

/** 内置音效：单例 audio，音量与旧版点击音效一致。 */
let fallbackAudio: HTMLAudioElement | null = null;

/** 播内置点击音效；音频不可用时静默（没有声音不该变成报错）。 */
function playFallbackSound(): void {
  try {
    fallbackAudio ??= new Audio(voiceBase + '/sound/click-duck.wav');
    fallbackAudio.volume = 0.5;
    fallbackAudio.currentTime = 0;
    void fallbackAudio.play().catch(() => {});
  } catch {
    /* 音频不可用：静默忽略 */
  }
}
