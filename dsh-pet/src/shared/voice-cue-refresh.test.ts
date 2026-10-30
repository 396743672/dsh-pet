/**
 * 换音色必须让「短语音效」缓存作废。
 *
 * 音效（点击 / 菜单点播）是拿当前音色合成的一句语气词，并在内存里留一份 blob 复用。
 * 缓存键只有文本、不含音色——所以改音色时若不把缓存一起清掉，就会出现
 * 「设置里明明改了、点一下还是旧声音」，而改音色的整套机制本来就是为了立刻生效。
 *
 * 只钉这一条不变量：音色变了 → 语气词重新合成；音色没变 → 不重复合成。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { setCueEnabled, setSurface, setVoiceConfig } from './voice.ts';

/** 假合成端点：记录每次请求的文本与音色。 */
function stubFetch(): { calls: Array<{ text: string; voice?: string }>; restore: () => void } {
  const calls: Array<{ text: string; voice?: string }> = [];
  const previous = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { text?: unknown; voice?: unknown };
    calls.push({
      text: String(body.text ?? ''),
      ...(typeof body.voice === 'string' ? { voice: body.voice } : {}),
    });
    return { ok: true, headers: { get: () => 'audio/mpeg' }, blob: async () => ({ size: 1 }) };
  };
  return {
    calls,
    restore: () => {
      (globalThis as { fetch: unknown }).fetch = previous;
    },
  };
}

/** 补上浏览器才有的音频对象与 blob 地址。 */
function stubBrowser(): () => void {
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  (globalThis as { Audio?: unknown }).Audio = class {
    play(): Promise<void> {
      return Promise.resolve();
    }
  };
  URL.createObjectURL = () => 'blob:dsh-pet-cue-test';
  URL.revokeObjectURL = () => undefined;
  return () => {
    (globalThis as { Audio?: unknown }).Audio = previousAudio;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  };
}

/** 让串行预热跑完（playCue/预热都是 void 出去的旁路）。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 40; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('音效缓存 —— 换音色即刻生效', () => {
  test('换音色后语气词重新合成，且用的是新音色', async () => {
    const fetchStub = stubFetch();
    const restoreBrowser = stubBrowser();
    try {
      setSurface('desktop');
      setVoiceConfig('edge-a', true);
      setCueEnabled(true); // 首次预热：每句语气词各合成一次
      await flush();
      const warmed = fetchStub.calls.length;
      assert.ok(warmed > 0, '开关打开后必须预热语气词，否则第一次点击要等整段合成');

      // 同一音色再注入一次（典型场景：只改了别的开关）：不该白白重合成
      setVoiceConfig('edge-a', true);
      await flush();
      assert.equal(fetchStub.calls.length, warmed, '音色没变就不该重新合成');

      // 换音色：缓存必须整体作废，否则点击还是旧声音
      setVoiceConfig('vits-theresa', true);
      await flush();
      assert.ok(fetchStub.calls.length > warmed, '换音色后必须重新合成语气词');
      const refreshed = fetchStub.calls.slice(warmed);
      assert.ok(
        refreshed.every((call) => call.voice === 'vits-theresa'),
        '重新合成的请求必须带上新音色，不能还拿旧音色发',
      );
    } finally {
      restoreBrowser();
      fetchStub.restore();
    }
  });
});
