/**
 * 点击音效（src/client/pet/click-sound.ts）的契约测试。
 *
 * 这一层很薄：把「点击」翻译成共享层的 `playCue('click')`。所以这里只钉住三件事：
 * 开关关闭时一个合成请求都不发；打开后确实按短语气词去合成；连点不会各发一串请求。
 * 音色、缓存与回落内置音效的细节在 shared/voice 那边，不在这里重复一遍。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { playClickSound, setClickSoundEnabled } from './click-sound.ts';

/** 假合成端点：记下每次请求的正文；响应给一段「音频」。 */
function stubFetch(): { texts: () => string[]; restore: () => void } {
  const texts: string[] = [];
  const previous = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (_url: string, init?: { body?: string }) => {
    texts.push(String((JSON.parse(init?.body ?? '{}') as { text?: unknown }).text ?? ''));
    return {
      ok: true,
      headers: { get: () => 'audio/wav' },
      blob: async () => ({ size: 1 }),
    };
  };
  return {
    texts: () => texts,
    restore: () => {
      (globalThis as { fetch: unknown }).fetch = previous;
    },
  };
}

/** 补上浏览器才有的音频对象；播放失败也不该外抛，所以只要能构造即可。 */
function stubBrowser(): () => void {
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  (globalThis as { Audio?: unknown }).Audio = class {
    volume = 0;
    currentTime = 0;

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

/** 让 void 出去的异步旁路跑完。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('playClickSound —— 转发到短语音效', () => {
  test('开关关闭：不发合成请求，也不抛', async () => {
    const fetchStub = stubFetch();
    const restore = stubBrowser();
    try {
      setClickSoundEnabled(false);
      assert.doesNotThrow(() => playClickSound());
      await flush();
      assert.deepEqual(fetchStub.texts(), [], '关了就不该再去合成');
    } finally {
      restore();
      fetchStub.restore();
      setClickSoundEnabled(false);
    }
  });

  test('开关打开：按短语气词发起一次合成', async () => {
    const fetchStub = stubFetch();
    const restore = stubBrowser();
    try {
      setClickSoundEnabled(true);
      playClickSound();
      await flush();
      const texts = fetchStub.texts();
      assert.equal(texts.length, 1, '一次点击一次合成');
      assert.ok(texts[0].length > 0 && texts[0].length <= 4, '语气词必须极短，实际：' + texts[0]);
    } finally {
      restore();
      fetchStub.restore();
      setClickSoundEnabled(false);
    }
  });

  test('连点：同一窗口内最多一次请求（不会叠成一串）', async () => {
    const fetchStub = stubFetch();
    const restore = stubBrowser();
    try {
      setClickSoundEnabled(true);
      const before = fetchStub.texts().length;
      playClickSound();
      playClickSound();
      playClickSound();
      await flush();
      assert.ok(fetchStub.texts().length - before <= 1, '节流窗口内最多一次');
    } finally {
      restore();
      fetchStub.restore();
      setClickSoundEnabled(false);
    }
  });
});
