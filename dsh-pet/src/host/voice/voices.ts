/**
 * 语音音色的唯一真相：白名单、展示元数据与默认值。
 *
 * 请求体里的 `voice` 只接受这里列出的 id——不接受任意音色串，否则等于把上游的能力面
 * 全部开放，出问题也说不清是谁传的。列表接口与校验都读同一个常量，不写第二份。
 * @module dsh-pet/src/host/voice/voices
 */

/** 一个可选音色；`id` 是 edge 服务端的 short name，其余字段只用于展示。 */
export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly default: boolean;
}

/** 允许请求的四个中文音色；标记 `default` 的那个是缺省值。本地 VITS 音色不在这里——见 {@link LOCAL_VOICE_DEFS}。 */
export const VOICES: readonly VoiceInfo[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', tag: '女 · 通用', default: false },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', tag: '女 · 活泼', default: true },
  { id: 'zh-CN-YunxiNeural', name: '云希', tag: '男 · 年轻', default: false },
  { id: 'zh-CN-YunjianNeural', name: '云健', tag: '男 · 沉稳', default: false },
];

/** 默认音色 id；请求与配置都没指定时用它，必须与 {@link VOICES} 里 `default` 标记的那个一致。 */
export const DEFAULT_VOICE = 'zh-CN-XiaoyiNeural';

/**
 * 本地 VITS 音色的定义：模型目录名与说话人 id。
 *
 * 模型与 sherpa-onnx 运行时都放在**插件安装目录**下的 `voice/`（`<插件包根>/voice/`，由仓库根的
 * patch.mjs 部署），不随插件包发布——目录缺失时本地音色合成失败并提示运行 patch.mjs，
 * 不影响 Edge 在线音色。
 */
export interface LocalVoiceDef {
  /** 对外音色 id（参与缓存键与配置校验）。 */
  readonly id: string;
  /** 模型目录名，位于 voice 根目录下。 */
  readonly modelDir: string;
  /** VITS 说话人 id（多说话人模型里挑哪个声线）。 */
  readonly sid: number;
  /** 展示名。 */
  readonly name: string;
  /** 展示标签。 */
  readonly tag: string;
}

/** 内置本地音色表；新增本地模型时在这里加一行即可（其余全部自动生效）。 */
export const LOCAL_VOICE_DEFS: readonly LocalVoiceDef[] = [
  { id: 'vits-theresa', modelDir: 'vits-zh-hf-theresa', sid: 0, name: '德丽莎', tag: '女 · 本地 · 萝莉' },
];

/** 本地音色 id → 定义；路由与校验都查这一份。 */
const LOCAL_VOICE_MAP = new Map(LOCAL_VOICE_DEFS.map((def) => [def.id, def]));

/**
 * 查本地音色定义；本地合成路由与缓存扩展名判定都用它。
 * @param id - 音色 id。
 * @returns 命中时给定义，否则 undefined。
 */
export function localVoiceDef(id: string): LocalVoiceDef | undefined {
  return LOCAL_VOICE_MAP.get(id);
}

/**
 * 判断音色是否是本地 VITS 音色（合成走本地推理而不是 Edge 在线）。
 * @param id - 音色 id。
 * @returns 属于本地音色时为 true。
 */
export function isLocalVoice(id: string): boolean {
  return LOCAL_VOICE_MAP.has(id);
}

/**
 * 判断音色是否在白名单内（Edge 在线音色 + 本地 VITS 音色的并集）。
 * @param id - 待校验的音色 id。
 * @returns 属于白名单时为 true。
 */
export function isKnownVoice(id: string): boolean {
  return VOICES.some((voice) => voice.id === id) || LOCAL_VOICE_MAP.has(id);
}

/**
 * 全部可选音色（Edge 在线 + 本地 VITS），与 {@link VOICES} 同形状。
 *
 * `/voice/voices` 与独立模式设置页的下拉都读这一份：列表只在这里拼一次，
 * 增删音色只需改上面的两张表，不必在消费端各写一遍。
 * @returns 可直接展示与校验的音色列表。
 */
export function allVoices(): readonly VoiceInfo[] {
  return [...VOICES, ...LOCAL_VOICE_DEFS.map(({ id, name, tag }) => ({ id, name, tag, default: false }))];
}
