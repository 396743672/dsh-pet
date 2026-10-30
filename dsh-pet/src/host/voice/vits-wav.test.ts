/**
 * WAV 封装的行为测试（src/host/voice/vits-wav.ts）。
 * 钉住：44 字节标准头、样本数一致、float→PCM16 往返误差在半个 LSB 内、超界限幅。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeWav } from './vits-wav.ts';

/** 从 WAV 字节里读回 16-bit PCM 样本，便于断言。 */
function readPcm(file: Uint8Array): number[] {
  assert.equal(file[0], 0x52); // 'R'
  assert.equal(file[8], 0x57); // 'W'
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  assert.equal(view.getUint32(24, true), 22050, '采样率必须原样写入');
  assert.equal(view.getUint16(22, true), 1, '单声道');
  assert.equal(view.getUint16(34, true), 16, '16-bit');
  assert.equal(view.getUint32(40, true), file.length - 44, 'data 块长度与文件大小一致');
  const samples: number[] = [];
  for (let offset = 44; offset < file.length; offset += 2) {
    samples.push(view.getInt16(offset, true));
  }
  return samples;
}

test('encodeWav：头与样本数一致，往返误差在半个 LSB 内', () => {
  const rate = 22050;
  const samples = Float32Array.from([0, 0.25, -0.25, 0.5, -0.5, 1, -1]);
  const file = encodeWav(samples, rate);
  const pcm = readPcm(file);
  assert.equal(pcm.length, samples.length);
  const expected = [0, 8192, -8192, 16384, -16384, 32767, -32768];
  pcm.forEach((value, index) => assert.equal(value, expected[index]));
});

test('encodeWav：超界样本按限幅处理，不产生回绕爆音', () => {
  const file = encodeWav(Float32Array.from([1.5, -1.5, 42]), 44_100);
  const view = new DataView(file.buffer);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
});

test('encodeWav：非法采样率直接拒绝', () => {
  assert.throws(() => encodeWav(new Float32Array(2), 0), RangeError);
  assert.throws(() => encodeWav(new Float32Array(2), 22050.5), RangeError);
});
