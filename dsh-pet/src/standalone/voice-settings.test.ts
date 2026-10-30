/**
 * 独立模式「语音与音效」设置读写测试 —— 钉住三件事：
 * ① 只改语音相关的顶层键，pets 与用户手改的字段一字不动；
 * ② 用户层还不存在时，写出来的文件是「合并后的 main 条目」，不是没有 pets 的裸对象
 *   （否则读取侧每次启动都要走一次「pets 缺失」的兜底告警）；
 * ③ 补丁走严格 schema：未知键（例如顺手带上 pets）与白名单外的音色一律拒绝。
 *
 * 跑法：node --experimental-strip-types --test src/standalone/voice-settings.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ConfigPaths } from '../host/config.ts';
import { readVoiceSettings, saveVoiceSettings, validateVoicePatch } from './voice-settings.ts';

/** 内置默认配置的最小形态：只保留语音测试要读的字段。 */
const BASE = {
  pets: [
    {
      id: 'main',
      name: '主宠',
      size: 462,
      balanceEnabled: false,
      display: 'web',
      position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
    },
  ],
  voiceEnabled: false,
  voiceName: 'zh-CN-XiaoyiNeural',
  voiceWhisperEnabled: false,
  voiceTodoEnabled: false,
  clickSoundEnabled: true,
  chatMemoryRounds: 5,
};

/** 造一套隔离的临时配置路径。 */
function tempPaths(defaultOverrides: Record<string, unknown> = {}): ConfigPaths {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-voice-settings-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(paths.defaultFile, JSON.stringify({ ...BASE, ...defaultOverrides }));
  return paths;
}

/** 用完删目录。 */
function cleanup(paths: ConfigPaths): void {
  rmSync(dirname(paths.defaultFile), { recursive: true, force: true });
}

describe('readVoiceSettings —— 读成品配置，音色取白名单', () => {
  test('没有用户层时全部取内置默认，且音色列表含本地音色', () => {
    const paths = tempPaths();
    try {
      const view = readVoiceSettings(paths);
      assert.equal(view.voiceEnabled, false);
      assert.equal(view.voiceName, 'zh-CN-XiaoyiNeural');
      assert.equal(view.clickSoundEnabled, true);
      const ids = view.voices.map((voice) => voice.id);
      assert.ok(ids.includes('vits-theresa'), '本地音色必须出现在下拉里');
      assert.ok(ids.includes('zh-CN-XiaoyiNeural'), 'Edge 音色必须出现在下拉里');
    } finally {
      cleanup(paths);
    }
  });

  test('用户层写了就以用户层为准', () => {
    const paths = tempPaths();
    try {
      writeFileSync(paths.userFile, JSON.stringify({ voiceEnabled: true, voiceName: 'vits-theresa' }));
      const view = readVoiceSettings(paths);
      assert.equal(view.voiceEnabled, true);
      assert.equal(view.voiceName, 'vits-theresa');
    } finally {
      cleanup(paths);
    }
  });
});

describe('saveVoiceSettings —— 只写自己负责的顶层键', () => {
  test('用户层里手改的 pets 与其他字段原样保留', () => {
    const paths = tempPaths();
    try {
      const userLayer = {
        pets: [{ ...BASE.pets[0], id: 'main', whisperPrompt: '你是德丽莎' }],
        whisperPrompt: '条目级人设',
        memes: { 自定义: { desc: '别动我' } },
        voiceEnabled: false,
      };
      writeFileSync(paths.userFile, JSON.stringify(userLayer));
      saveVoiceSettings(paths, { voiceEnabled: true, voiceName: 'vits-theresa', clickSoundEnabled: false });
      const written = JSON.parse(readFileSync(paths.userFile, 'utf8')) as Record<string, unknown>;
      assert.deepEqual(written.pets, userLayer.pets, 'pets 必须逐字保留');
      assert.deepEqual(written.memes, userLayer.memes, '非语音字段必须原样保留');
      assert.equal(written.whisperPrompt, '条目级人设');
      assert.equal(written.voiceEnabled, true);
      assert.equal(written.voiceName, 'vits-theresa');
      assert.equal(written.clickSoundEnabled, false);
    } finally {
      cleanup(paths);
    }
  });

  test('用户层不存在时写合并后的 main 条目（必须带 pets）', () => {
    const paths = tempPaths();
    try {
      saveVoiceSettings(paths, { voiceName: 'vits-theresa' });
      const written = JSON.parse(readFileSync(paths.userFile, 'utf8')) as Record<string, unknown>;
      assert.ok(Array.isArray(written.pets) && written.pets.length === 1, '新文件必须带 pets');
      assert.equal(written.voiceName, 'vits-theresa');
      // 其余默认值一起落地：这是「用户显式保存过一次」的必然结果，写全比写半个对象更好读
      assert.equal(written.clickSoundEnabled, true);
    } finally {
      cleanup(paths);
    }
  });

  test('保存后立刻能读到新值（读写同一口径）', () => {
    const paths = tempPaths();
    try {
      saveVoiceSettings(paths, { voiceEnabled: true, voiceWhisperEnabled: true, voiceTodoEnabled: true });
      const view = readVoiceSettings(paths);
      assert.equal(view.voiceEnabled, true);
      assert.equal(view.voiceWhisperEnabled, true);
      assert.equal(view.voiceTodoEnabled, true);
    } finally {
      cleanup(paths);
    }
  });
});

describe('validateVoicePatch —— 严格白名单', () => {
  test('放行语音相关的四个开关与合法音色', () => {
    assert.deepEqual(validateVoicePatch({ voiceEnabled: true }), { voiceEnabled: true });
    assert.deepEqual(validateVoicePatch({ voiceName: 'vits-theresa' }), { voiceName: 'vits-theresa' });
    assert.deepEqual(validateVoicePatch({ clickSoundEnabled: false }), { clickSoundEnabled: false });
  });

  test('拒绝白名单外的音色、未知键与非布尔值', () => {
    for (const input of [
      null,
      { voiceName: 'zh-CN-UnknownNeural' },
      { voiceEnabled: 'true' },
      { pets: [] },
      { voiceName: 123 },
    ]) {
      assert.throws(() => validateVoicePatch(input), Error, JSON.stringify(input));
    }
    // 空补丁本身合法：等于什么都不改，不该被当成错误
    assert.deepEqual(validateVoicePatch({}), {});
  });
});
