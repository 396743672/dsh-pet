/**
 * 音色白名单的行为测试（src/host/voice/voices.ts）。
 * 只钉住「校验与列表同源」这条契约：默认音色必须真的在列表里。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VOICE, VOICES, isKnownVoice, isLocalVoice, localVoiceDef } from './voices.ts';

test('isKnownVoice：白名单内的 id 命中，任意串不命中', () => {
  assert.equal(isKnownVoice('zh-CN-XiaoxiaoNeural'), true);
  assert.equal(isKnownVoice('zh-CN-MadeUpNeural'), false);
  assert.equal(isKnownVoice(''), false);
});

test('DEFAULT_VOICE：必须在列表里，且恰好一个 default', () => {
  assert.equal(isKnownVoice(DEFAULT_VOICE), true, '默认音色不能落在白名单外');
  const defaults = VOICES.filter((voice) => voice.default);
  assert.equal(defaults.length, 1, 'default 标记必须唯一');
  assert.equal(defaults[0]?.id, DEFAULT_VOICE);
});

test('本地音色：isKnownVoice 认识，isLocalVoice 只有本地 id 为真，定义可查', () => {
  assert.equal(isKnownVoice('vits-theresa'), true, '本地音色必须过配置校验');
  assert.equal(isLocalVoice('vits-theresa'), true);
  assert.equal(isLocalVoice('zh-CN-XiaoyiNeural'), false, 'Edge 音色不该被当作本地音色');
  const def = localVoiceDef('vits-theresa');
  assert.ok(def);
  assert.equal(def.modelDir, 'vits-zh-hf-theresa');
  assert.equal(def.sid, 0);
  assert.equal(localVoiceDef('zh-CN-XiaoyiNeural'), undefined);
});
