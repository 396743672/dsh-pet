/**
 * 独立模式的「语音与音效」设置：只读写用户层的几个顶层字段，pets 与其余配置原样保留。
 *
 * 为什么不走 PUT /config：那条路径会按白名单重建 pets，独立设置页并不编辑宠物，
 * 没必要把它当作写入口去冒险；这里只改自己负责的四五个顶层键，用户手改的内容一字不动。
 * 不负责合成与播放（归 host 的 voice 域），也不管桌面宠物重载（由页面在保存后显式触发）。
 * 必须始终成立：音色必须在白名单内；任何一步失败都不留下半个配置文件。
 * @module dsh-pet/src/standalone/voice-settings
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

import { readAllConfig, readUserConfig, type ConfigPaths } from '../host/config.ts';
import { allVoices, DEFAULT_VOICE, isKnownVoice, type VoiceInfo } from '../host/voice/voices.ts';

/** 设置页一次能读到的全部信息：当前值 + 可选音色。 */
export interface VoiceSettingsView {
  readonly ok: true;
  readonly voiceEnabled: boolean;
  readonly voiceName: string;
  readonly voiceWhisperEnabled: boolean;
  readonly voiceTodoEnabled: boolean;
  readonly clickSoundEnabled: boolean;
  readonly voices: readonly VoiceInfo[];
}

/** 语音设置补丁的契约：未知字段一律拒绝（避免把拼错的键静默写进配置）。 */
const patchSchema = z
  .object({
    voiceEnabled: z.boolean().optional(),
    voiceName: z.string().max(120).optional(),
    voiceWhisperEnabled: z.boolean().optional(),
    voiceTodoEnabled: z.boolean().optional(),
    clickSoundEnabled: z.boolean().optional(),
  })
  .strict();

/** 补丁里可写的键，写回时只认这些。 */
type VoicePatch = z.infer<typeof patchSchema>;

/**
 * 校验补丁；音色必须落在白名单内（与 /voice/speak 同一份规则）。
 * @param input - 请求体。
 * @returns 已校验的补丁。
 * @throws 形状不符或音色不在白名单时抛出。
 */
export function validateVoicePatch(input: unknown): VoicePatch {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) throw new Error('语音设置无效：只接受语音相关的几个开关与音色 id');
  const { voiceName } = parsed.data;
  if (voiceName !== undefined && !isKnownVoice(voiceName)) throw new Error('音色不在可选列表内');
  return parsed.data;
}

/**
 * 读当前语音设置：值取成品配置（合并后的 main 条目），音色取白名单。
 * @param paths - 配置路径。
 * @returns 设置页需要的视图。
 */
export function readVoiceSettings(paths: ConfigPaths): VoiceSettingsView {
  const main = readAllConfig(paths).main ?? {};
  return {
    ok: true,
    voiceEnabled: main.voiceEnabled === true,
    voiceName: typeof main.voiceName === 'string' ? main.voiceName : DEFAULT_VOICE,
    voiceWhisperEnabled: main.voiceWhisperEnabled === true,
    voiceTodoEnabled: main.voiceTodoEnabled === true,
    clickSoundEnabled: main.clickSoundEnabled === true,
    voices: allVoices(),
  };
}

/**
 * 写语音设置：只改补丁里出现的顶层键，其余字段（pets、memes、人设…）原样保留。
 *
 * 用户层还不存在时，用合并后的 main 条目做底（否则写入一个没有 pets 的裸对象，
 * 读取侧每次都要走「pets 缺失」的兜底告警）。写盘是整份覆盖，不做增量追加。
 *
 * @param paths - 配置路径。
 * @param patch - 已校验的补丁。
 * @returns 写回后重新读到的视图（页面据此刷新控件）。
 */
export function saveVoiceSettings(paths: ConfigPaths, patch: VoicePatch): VoiceSettingsView {
  const base = readUserConfig(paths) ?? readAllConfig(paths).main ?? {};
  const next: Record<string, unknown> = { ...base, ...patch };
  mkdirSync(dirname(paths.userFile), { recursive: true });
  writeFileSync(paths.userFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return readVoiceSettings(paths);
}

/** 语音设置服务：HTTP 层只依赖这两个方法。 */
export interface VoiceSettingsService {
  /** 读当前设置。 */
  read(): VoiceSettingsView;
  /** 保存补丁并返回新视图。 */
  save(input: unknown): VoiceSettingsView;
}

/**
 * 造语音设置服务。
 * @param paths - 配置路径。
 * @returns 读写两端。
 */
export function createVoiceSettings(paths: ConfigPaths): VoiceSettingsService {
  return {
    read: () => readVoiceSettings(paths),
    save: (input) => saveVoiceSettings(paths, validateVoicePatch(input)),
  };
}
