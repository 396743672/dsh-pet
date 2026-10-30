import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiConfig, validateSettings, DEFAULT_AI_SETTINGS } from './ai-config.ts';

const configured = {
  protocol: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  model: 'chosen-model',
  apiKey: 'test-secret',
  enabled: true,
};

test('validates safe endpoints and explicit configuration with fixed redacted errors', () => {
  for (const baseUrl of [
    'ftp://example.test',
    'https://u:p@example.test',
    'https://example.test/?key=secret',
    'https://example.test/#secret',
    'javascript:alert(1)',
    'https://example.test\\v1',
  ]) {
    assert.throws(
      () => validateSettings({ ...configured, baseUrl }, DEFAULT_AI_SETTINGS),
      /^Error: Invalid standalone AI settings\.$/,
    );
  }
  for (const baseUrl of [
    'http://192.168.1.100:8000/v1',
    'http://localhost:1234/v1',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'https://example.test/v1',
  ]) {
    assert.equal(validateSettings({ ...configured, baseUrl }, DEFAULT_AI_SETTINGS).baseUrl, baseUrl);
  }
  for (const patch of [
    { model: '' },
    { timeoutMs: 60001 },
    { whisperIntervalSec: 59 },
    { maxTokens: 100000 },
    { hasKey: true },
    { enabled: 'true' },
    { apiKey: 'bad\nkey' },
  ]) {
    assert.throws(
      () => validateSettings({ ...configured, ...patch }, DEFAULT_AI_SETTINGS),
      /Invalid standalone AI settings/,
    );
  }
});

test('代理地址：留空跟随系统，省略协议按 http，多余成分整份拒绝', () => {
  assert.equal(validateSettings(configured, DEFAULT_AI_SETTINGS).proxyUrl, '');
  assert.equal(
    validateSettings({ ...configured, proxyUrl: '127.0.0.1:7897' }, DEFAULT_AI_SETTINGS).proxyUrl,
    'http://127.0.0.1:7897',
    '省略协议时按 http 补齐，用户直接填 host:port 也能用',
  );
  assert.equal(
    validateSettings({ ...configured, proxyUrl: '  socks5://127.0.0.1:1080 ' }, DEFAULT_AI_SETTINGS).proxyUrl,
    'socks5://127.0.0.1:1080',
  );
  for (const proxyUrl of [
    'ftp://127.0.0.1:21',
    'http://user:pass@127.0.0.1:7897',
    'http://127.0.0.1:7897/v1',
    'http://127.0.0.1:7897/?x=1',
    'http://127.0.0.1:7897#frag',
    'http://a b:1',
  ]) {
    // 这些写法 Chromium 会静默丢掉整条规则（表现成「填了代理没生效」），所以在保存时就拒
    assert.throws(
      () => validateSettings({ ...configured, proxyUrl }, DEFAULT_AI_SETTINGS),
      /Invalid standalone AI settings/,
      proxyUrl,
    );
  }
});

test('升级兼容：老配置文件没有 proxyUrl 时照常读出来，不会整份失效', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-ai-'));
  try {
    const dir = join(home, 'dsh-pet');
    mkdirSync(dir, { recursive: true });
    // 上一版本落盘的内容（还没有 proxyUrl 这个字段），逐字模拟真实老文件
    writeFileSync(
      join(dir, 'standalone-ai.json'),
      JSON.stringify({
        protocol: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        model: 'old-model',
        enabled: true,
        automaticWhispers: true,
        whisperIntervalSec: 60,
        maxTokens: 512,
        timeoutMs: 30000,
        apiKey: 'old-secret',
      }),
      { mode: 0o600 },
    );
    const settings = createAiConfig(home).publicSettings();
    assert.equal(settings.model, 'old-model', '老字段必须原样读回');
    assert.equal(settings.enabled, true);
    assert.equal(settings.proxyUrl, '', '新字段缺省 = 跟随系统代理');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('persists only in isolated home, redacts keys, supports keep and clear, reloads offline', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-ai-'));
  try {
    const store = createAiConfig(home);
    assert.equal(store.publicSettings().hasKey, false);
    const saved = await store.save(configured);
    assert.equal(saved.hasKey, true);
    assert.equal('apiKey' in saved, false);
    assert.equal(saved.maxTokens, 1024);
    assert.equal(saved.whisperIntervalSec, 300);
    assert.equal((await store.save({ apiKey: '', automaticWhispers: true })).hasKey, true);
    assert.equal(createAiConfig(home).publicSettings().model, 'chosen-model');
    assert.match(readFileSync(join(home, 'dsh-pet', 'standalone-ai.json'), 'utf8'), /test-secret/);
    assert.equal((await store.save({ clearApiKey: true, enabled: false })).hasKey, false);
    assert.equal(createAiConfig(home).publicSettings().enabled, false);
    writeFileSync(join(home, 'dsh-pet', 'standalone-ai.json'), '{broken');
    assert.throws(() => createAiConfig(home), /^Error: Cannot securely load standalone AI settings\.$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
