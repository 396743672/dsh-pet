/**
 * 桌面端音效接线的契约测试。
 *
 * 自从音效实现搬到共享层（`src/shared/voice.ts` 的 `playCue`），桌面端只剩一根线：
 * sprite 的点击处理器 → `S.playCue('click')`，开关由 renderer 在读完配置后注入。
 * 所以这里钉的是「这根线有没有接上」以及「回落音效是否还走 bridge/HTTP 同一条素材通道」，
 * 具体行为（节流、关闭不合成）由 `src/client/pet/click-sound.test.ts` 覆盖，不重复。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const sprite = readFileSync(new URL('../../runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../../runtime/electron-helper/renderer.js', import.meta.url), 'utf8');
const sharedVoice = readFileSync(new URL('../shared/voice.ts', import.meta.url), 'utf8');

/** 在 VM 里跑 sprite.js，导出 playClickSound，并记录它触发的音效种类。 */
function fixture(): { calls: string[]; play(): void } {
  const calls: string[] = [];
  const controls = runInNewContext(sprite + '\n({ play: playClickSound })', {
    BASE: 'dsh-pet-bridge://dsh-pet/dsh-pet-7340',
    ORIGIN: 'http://127.0.0.1:3080',
    config: { clickSoundEnabled: true },
    navigator: { platform: 'Win32' },
    S: {
      playCue: (kind: string) => {
        calls.push(kind);
      },
    },
  }) as { play(): void };
  return { calls, play: controls.play };
}

test('桌面点击音效委托给共享层的 playCue("click")', () => {
  const desktop = fixture();
  desktop.play();
  assert.deepEqual(desktop.calls, ['click']);
});

test('桌面端不再自己维护一份 audio 单例与节流状态', () => {
  assert.doesNotMatch(sprite, /new Audio\(/, '音效播放只在共享层实现一次');
  assert.doesNotMatch(sprite, /CLICK_SOUND_THROTTLE_MS/, '节流不该在桌面端再写一遍');
});

test('renderer 在注入音色之后才注入音效开关（预热要用到音色）', () => {
  const voiceAt = renderer.indexOf('S.setVoiceConfig(');
  const cueAt = renderer.indexOf('S.setCueEnabled(');
  assert.ok(voiceAt > 0 && cueAt > 0, '两处注入都必须存在');
  assert.ok(cueAt > voiceAt, 'setCueEnabled 必须排在 setVoiceConfig 之后');
  assert.match(renderer, /S\.setCueEnabled\(cfg\.clickSoundEnabled\)/);
});

test('回落音效与读配置同源：URL 由 voiceBase 拼出，bridge 模式自然复用素材通道', () => {
  assert.match(sharedVoice, /voiceBase \+ '\/sound\/click-duck\.wav'/);
  assert.match(sharedVoice, /export function playCue\(/);
  assert.match(sharedVoice, /export function setCueEnabled\(/);
});

test('点播出声只挂在菜单派发上，不挂在自动轮换路径', () => {
  const menuActions = readFileSync(new URL('../client/pet/menu-actions.ts', import.meta.url), 'utf8');
  // 点播动作念逐动作台词，没配就念动作名（都在 playActionLine 一处出口）
  assert.match(menuActions, /playActionLine\(deps\.voiceLineOf\(leaf\.anim\) \|\| leaf\.anim\)/);
  const menuJs = readFileSync(new URL('../../runtime/electron-helper/sprite/menu.js', import.meta.url), 'utf8');
  assert.match(menuJs, /S\.playActionLine\(\(this\.pet\.actionVoiceLines \|\| \{\}\)\[leaf\.anim\] \|\| leaf\.anim\)/);
  // 自动待机/轮换走的是播放链（playOnce 内部），那里不该出现音效调用
  const playback = readFileSync(new URL('../../runtime/electron-helper/sprite/playback.js', import.meta.url), 'utf8');
  assert.doesNotMatch(playback, /playCue\(/, '待机轮换每几秒一次，出声就是噪音');
});
