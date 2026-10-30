/**
 * 点击音效：转发到共享层的短语音效（当前音色的一句语气词）。
 *
 * 为什么还留这一层：卡片的拖拽驱动只想「有没有声音」这个能力，不该知道音色、缓存与回落；
 * 语音的合成、内存缓存与「合成失败退回内置 click-duck.wav」全在 `shared/voice` 里。
 * 开关与节流也在那一份实现里，这里不再重复一遍状态。
 * @module dsh-pet/src/client/pet/click-sound
 */
import { playCue, setCueEnabled } from '../../shared/voice.ts';

/**
 * 打开或关闭音效。
 * @param enabled - 成品配置里的 `clickSoundEnabled`。
 */
export function setClickSoundEnabled(enabled: boolean): void {
  setCueEnabled(enabled);
}

/** 播放点击音效；开关关闭、节流中或音频不可用时静默返回。 */
export function playClickSound(): void {
  playCue('click');
}
