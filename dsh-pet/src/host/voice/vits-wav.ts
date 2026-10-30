/**
 * PCM → WAV 封装：把 VITS 吐出的 float32 单声道样本包成标准 16-bit PCM WAV。
 *
 * 纯函数、无依赖、无 IO：封装与文件写入分离，本模块可独立单测。
 * 输入样本超界（|x| > 1）按限幅处理——VITS 输出偶发轻微过冲，直接截断比爆音好。
 * @module dsh-pet/src/host/voice/vits-wav
 */

/** 单声道 16-bit PCM WAV 的文件头字节数（RIFF/fmt/data 三段）。 */
const WAV_HEADER_BYTES = 44;
/** 16-bit 采样的满幅值。 */
const PCM16_MAX = 32_767;
/** 16-bit 采样的负向满幅值（|−32768| 比正向多 1，截断时分开算）。 */
const PCM16_MIN = -32_768;

/**
 * 把 float32 样本封装成 WAV 字节（16-bit PCM，单声道）。
 * @param samples - 归一化浮点样本（−1..1；超出按限幅处理）。
 * @param sampleRate - 采样率（Hz，如 22050）；必须为正整数。
 * @returns 完整的 WAV 文件字节。
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate 必须是正整数');
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, value < 0 ? Math.round(value * (0 - PCM16_MIN)) : Math.round(value * PCM16_MAX), true);
  }
  const file = new Uint8Array(WAV_HEADER_BYTES + pcm.length);
  const head = new DataView(file.buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) head.setUint8(offset + index, text.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  head.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  head.setUint32(16, 16, true); // fmt 块长度（PCM 固定 16）
  head.setUint16(20, 1, true); // 音频格式：PCM
  head.setUint16(22, 1, true); // 声道数：单声道
  head.setUint32(24, sampleRate, true);
  head.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 声道 × 2 字节
  head.setUint16(32, 2, true); // 块对齐 = 声道 × 2 字节
  head.setUint16(34, 16, true); // 位深
  writeAscii(36, 'data');
  head.setUint32(40, pcm.length, true);
  file.set(pcm, WAV_HEADER_BYTES);
  return file;
}
