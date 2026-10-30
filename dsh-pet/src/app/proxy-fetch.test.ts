import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProxyFetch, type ProxyNet, type ProxySession } from './proxy-fetch.ts';

/** 造一套可观测的假网络栈：session 记录下发过的代理，net 记录真正发出去的地址。 */
function harness(initial: string) {
  let proxy = initial;
  const applied: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  const session: ProxySession = {
    async setProxy(config) {
      applied.push(config as Record<string, unknown>);
    },
  };
  const net: ProxyNet = {
    async fetch(input) {
      sent.push(input);
      return new Response('ok');
    },
  };
  const fetch = createProxyFetch({ net, session, proxyOf: () => proxy });
  return {
    fetch,
    applied,
    sent,
    setProxy: (value: string) => {
      proxy = value;
    },
  };
}

test('空代理 = 跟随系统，且整条通道只下发一次', async () => {
  const h = harness('');
  await h.fetch('https://api.example.test/v1/chat/completions');
  await h.fetch('https://api.example.test/v1/chat/completions');
  assert.deepEqual(h.applied, [{ mode: 'system' }], '重复请求不该反复改全局代理状态');
  assert.equal(h.sent.length, 2, '每次调用都要真的发出去');
});

test('填了代理：固定代理下发，并绕开本机地址', async () => {
  const h = harness('http://127.0.0.1:7897');
  await h.fetch('https://api.example.test/v1/chat/completions');
  assert.deepEqual(h.applied, [
    {
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7897',
      // 应用自己那个 127.0.0.1 的 HTTP 服务必须绕开，否则代理会把本机请求也转出去
      proxyBypassRules: 'localhost;127.0.0.1;[::1];<local>',
    },
  ]);
  assert.deepEqual(h.sent, ['https://api.example.test/v1/chat/completions']);
});

test('设置里改了地址：下一次请求重新下发，不需要重启', async () => {
  const h = harness('http://127.0.0.1:7897');
  await h.fetch('https://api.example.test/v1/chat/completions');
  h.setProxy('socks5://127.0.0.1:1080');
  await h.fetch('https://api.example.test/v1/chat/completions');
  assert.equal(h.applied.length, 2);
  assert.equal(h.applied[1].proxyRules, 'socks5://127.0.0.1:1080');
  h.setProxy('');
  await h.fetch('https://api.example.test/v1/chat/completions');
  assert.deepEqual(h.applied[2], { mode: 'system' }, '清空代理要回到跟随系统');
});

test('代理下发失败不阻断请求本身', async () => {
  const logs: string[] = [];
  const net: ProxyNet = { fetch: async () => new Response('ok') };
  const session: ProxySession = {
    setProxy: async () => {
      throw new Error('proxy daemon down');
    },
  };
  const fetch = createProxyFetch({
    net,
    session,
    proxyOf: () => 'http://127.0.0.1:7897',
    log: (message) => void logs.push(message),
  });
  const response = await fetch('https://api.example.test/v1/chat/completions');
  assert.equal(await response.text(), 'ok');
  assert.match(logs.join('\n'), /下发失败/);
});
