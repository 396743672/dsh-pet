/**
 * 本机设置页的三份静态资源：HTML、CSS 与脚本。
 *
 * 只在本机回环上由 ./server 提供；不包含构建步骤，也不依赖外部 CDN。
 * 必须始终成立：脚本从地址片段读一次令牌后立刻清掉片段；页面不内联脚本与样式，
 * 以便 CSP 保持 default-src 'none'。
 * @module dsh-pet/src/standalone/settings-page
 */
import { ROUTE_SEGMENT } from '../shared/constants.ts';

/** 设置页 HTML。 */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠设置</h1><p class="intro">配置大模型接口、语音音色与音效。<br>所有设置仅保存在本机，支持即时测试连接与试听。</p></header>
<form id="settings" aria-describedby="privacy">
<fieldset><legend>模型连接</legend>
<label for="protocol">接口协议</label><select id="protocol" name="protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select>
<label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="hint" id="endpoint-note">填写服务商提供的基础接口地址（支持 HTTP 与 HTTPS，通常以 /v1 结尾）。不要把密钥放进地址。</p>
<label for="proxyUrl">出网代理（可选）</label><input id="proxyUrl" name="proxyUrl" type="text" maxlength="2048" placeholder="127.0.0.1:7897" spellcheck="false" aria-describedby="proxy-note"><p class="hint" id="proxy-note">留空 = 跟随系统代理。接口直连不通（碎碎念总是超时）时填本机代理，支持 http/https/socks5；本机地址与局域网始终直连。填好后先「保存」再「测试连接」。</p>
<label for="timeoutSec">单次请求超时（秒）</label><input id="timeoutSec" name="timeoutSec" type="number" min="1" max="60" step="1" value="30" required aria-describedby="timeout-note"><p class="hint" id="timeout-note">推理型模型或慢接口首字可能超过 20 秒，超时就算失败；慢的话调到 60。超过 60 秒的等待对桌宠没有意义。</p>
<label for="model">模型名称</label><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false">
<div class="key-heading"><label for="apiKey">API 密钥</label><span id="key-state" class="hint">尚未读取</span></div>
<input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note">
<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>
<label class="check clear"><input id="clearApiKey" type="checkbox">清除已保存的密钥，并关闭 AI</label>
<label class="check enabled"><input id="enabled" type="checkbox">启用 AI 对话</label>
<div class="test-row"><button id="test-btn" type="button">测试连接</button><span id="test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>定时自动碎碎念</legend>
<label class="check"><input id="automaticWhispers" type="checkbox" aria-describedby="cost">开启自动碎碎念</label>
<p id="cost" class="notice">开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。</p>
<div class="pair"><div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>
<div><label for="maxTokens">单次输出上限（tokens）</label><input id="maxTokens" type="number" min="128" max="4096" step="1" value="1024" required></div></div>
<p class="hint">间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。</p>
</fieldset>
<footer><p id="privacy">所有配置与密钥仅保存在当前机器。<br>关闭 AI 后，桌宠仍可正常显示、移动与互动。</p><button id="save" type="submit" disabled>保存到本机</button></footer>
<p id="status" role="status" aria-live="polite">正在读取本机设置…</p>
</form><form id="voice">
<fieldset><legend>语音播报与音效</legend>
<label class="check enabled"><input id="voiceEnabled" type="checkbox" aria-describedby="voice-note">语音播报（碎碎念与对话回复念出来）</label>
<label for="voiceName">音色</label><select id="voiceName" name="voiceName"></select>
<p id="voice-note" class="hint">「德丽莎」是本地离线音色（断网可用，需先部署 voice/ 目录）；其余为 Edge 在线音色（需联网）。</p>
<div class="pair">
<div><label class="check"><input id="voiceWhisperEnabled" type="checkbox">周期碎碎念朗读</label></div>
<div><label class="check"><input id="voiceTodoEnabled" type="checkbox">待办提醒朗读</label></div>
</div>
<label class="check"><input id="clickSoundEnabled" type="checkbox">音效（点击与动作点播，用当前音色说一句短语气词）</label>
<div class="test-row"><button id="voice-test" type="button">试听</button><span id="voice-test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<footer><p>保存后会自动重载桌面宠物窗口，新音色立即生效。</p><button id="voice-save" type="submit" disabled>保存语音设置</button></footer>
<p id="voice-status" role="status" aria-live="polite">正在读取语音设置…</p>
</form><noscript>需要启用 JavaScript 才能保存设置。请从桌宠菜单打开本页。</noscript></main></body></html>`;

/** 设置页样式。 */
export const settingsStyle = `
:root{color-scheme:light;--ink:#203b4b;--muted:#526a78;--blue:#12618b;--line:#cbdce5;--paper:#fff;--water:#edf5fa}
*{box-sizing:border-box}body{margin:0;background:var(--water);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px 32px}header{padding:0 12px 28px}.fish{display:block;font:700 29px/1.3 Georgia,serif;color:var(--blue);letter-spacing:2px;margin-bottom:24px}.local{font-size:13px;color:var(--muted);margin:0 0 10px}h1{font-size:32px;line-height:1.3;letter-spacing:-1px;margin:0 0 16px;font-weight:700}.intro{margin:0;color:var(--muted)}
form{background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 6px 6px;padding:28px 32px 20px}form+form{margin-top:24px;border-radius:6px 6px 16px 16px}fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}input::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover{background:#edf5fa}#test-btn:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
@media(max-width:560px){main{margin:24px auto;padding:0 14px 24px}header{padding:0 8px 24px}h1{font-size:28px}form{padding:24px 20px 16px}.pair{grid-template-columns:1fr;gap:0}footer{align-items:stretch;flex-direction:column}button{width:100%}.fish{margin-bottom:18px}}
`;

/** 设置页脚本；令牌只存在内存，请求时放进自定义头。 */
export const settingsScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const form = get('settings');
  const status = get('status');
  const save = get('save');
  const testBtn = get('test-btn');
  const testResult = get('test-result');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  async function request(method, body) {
    const response = await fetch('/standalone-ai/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
    }
    return response.json();
  }
  function populate(data) {
    for (const id of ['protocol','baseUrl','proxyUrl','model','whisperIntervalSec','maxTokens']) {
      if (data[id] !== undefined) get(id).value = String(data[id]);
    }
    // 超时在页面上是秒，配置里是毫秒：只在这一处换算
    get('timeoutSec').value = String(Math.round((typeof data.timeoutMs === 'number' ? data.timeoutMs : 30000) / 1000));
    for (const id of ['enabled','automaticWhispers']) get(id).checked = data[id] === true;
    get('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
    get('apiKey').value = '';
    get('clearApiKey').checked = false;
  }
  get('clearApiKey').addEventListener('change', () => {
    get('apiKey').disabled = get('clearApiKey').checked;
    if (get('clearApiKey').checked) {
      get('apiKey').value = '';
      get('enabled').checked = false;
      get('automaticWhispers').checked = false;
    }
  });
  if (testBtn && testResult) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testResult.className = 'test-result';
      testResult.textContent = '正在测试连接，请稍候…';
      const input = {
        protocol: get('protocol').value,
        baseUrl: get('baseUrl').value.trim(),
        model: get('model').value.trim(),
        apiKey: get('apiKey').value.trim(),
      };
      try {
        const response = await fetch('/standalone-ai/test', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            'X-DSH-Pet-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (data.ok) {
          testResult.className = 'test-result test-success';
          testResult.textContent = '✓ ' + data.message;
          if (data.reply) {
            const preview = document.createElement('span');
            preview.className = 'reply-preview';
            preview.textContent = '回复: ' + data.reply;
            testResult.appendChild(preview);
          }
        } else {
          testResult.className = 'test-result test-error';
          testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
        }
      } catch (error) {
        testResult.className = 'test-result test-error';
        testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    message('正在保存到本机…');
    const input = {
      protocol: get('protocol').value, baseUrl: get('baseUrl').value.trim(), model: get('model').value.trim(),
      proxyUrl: get('proxyUrl').value.trim(),
      apiKey: get('apiKey').value, clearApiKey: get('clearApiKey').checked,
      enabled: get('enabled').checked, automaticWhispers: get('automaticWhispers').checked,
      whisperIntervalSec: Number(get('whisperIntervalSec').value), maxTokens: Number(get('maxTokens').value),
      timeoutMs: Number(get('timeoutSec').value) * 1000
    };
    get('apiKey').value = '';
    try {
      populate(await request('POST', input));
      get('apiKey').disabled = false;
      message('已保存到本机。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });

  // ---------- 语音播报与音效 ----------
  const ROUTE = '${ROUTE_SEGMENT}';
  const voiceForm = get('voice');
  const voiceStatus = get('voice-status');
  const voiceSave = get('voice-save');
  const voiceTest = get('voice-test');
  const voiceTestResult = get('voice-test-result');
  function voiceMessage(text, error = false) { voiceStatus.textContent = text; voiceStatus.dataset.error = String(error); }
  async function voiceRequest(method, body) {
    const response = await fetch('/standalone-voice/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('语音设置未保存：请检查音色是否在可选列表内。');
    }
    return response.json();
  }
  // 让桌面宠物就地重拉配置：桌面窗口只在启动时读一次音色，不重载它就得重启整个应用。
  // 必须按响应如实回显——以前这里 fire-and-forget，独立模式下 /reload 其实是空操作，
  // 页面照样说「正在重载」，用户就一直等一个永远不会发生的重载。
  async function reloadDesktopPet() {
    try {
      const response = await fetch(ROUTE + '/reload', {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'X-DSH-Pet-Token': token }
      });
      if (!response.ok) {
        return '已保存，但桌面宠物没能重载（HTTP ' + response.status + '）：重启应用后生效。';
      }
      const body = await response.json().catch(() => ({}));
      if (body && body.mode === 'hot') {
        // 没有窗口就没有东西可重载（宠物可能只在网页显示）：别谎报「已重载」
        if (body.windows === 0) return '已保存。桌面上没有宠物窗口，配置会在下次启动生效。';
        return '已保存，桌面宠物已按新设置重载。';
      }
      return '已保存。本次没能热重载，重启应用后生效。';
    } catch (error) {
      return '已保存，但重载请求失败：' + (error && error.message ? error.message : String(error)) + '。重启应用后生效。';
    }
  }
  function populateVoice(data) {    const select = get('voiceName');
    select.textContent = '';
    for (const voice of data.voices || []) {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.name + '（' + voice.tag + '）';
      select.appendChild(option);
    }
    if (data.voiceName) select.value = data.voiceName;
    get('voiceEnabled').checked = data.voiceEnabled === true;
    get('voiceWhisperEnabled').checked = data.voiceWhisperEnabled === true;
    get('voiceTodoEnabled').checked = data.voiceTodoEnabled === true;
    get('clickSoundEnabled').checked = data.clickSoundEnabled === true;
    voiceSave.disabled = false;
  }
  if (voiceTest) {
    voiceTest.addEventListener('click', async () => {
      voiceTest.disabled = true;
      voiceTestResult.className = 'test-result';
      voiceTestResult.textContent = '正在合成试听…（本地音色首次约需数秒）';
      try {
        const response = await fetch(ROUTE + '/voice/speak', {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'X-DSH-Pet-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: '哼，本鱼在这儿呢，别老戳我。', voice: get('voiceName').value })
        });
        if (!response.ok) {
          let reason = '';
          try { reason = (await response.json()).reason || ''; } catch (_) { reason = ''; }
          throw new Error(reason === 'voice-busy' ? '合成排队已满，稍后再试'
            : '合成失败：检查网络，或本地音色是否已部署 voice/ 目录');
        }
        const url = URL.createObjectURL(await response.blob());
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        voiceTestResult.className = 'test-result test-success';
        voiceTestResult.textContent = '✓ 正在播放试听';
      } catch (error) {
        voiceTestResult.className = 'test-result test-error';
        voiceTestResult.textContent = '✗ ' + (error && error.message ? error.message : String(error));
      } finally { voiceTest.disabled = false; }
    });
  }
  if (voiceForm) {
    voiceForm.addEventListener('submit', async event => {
      event.preventDefault();
      voiceSave.disabled = true;
      voiceMessage('正在保存语音设置…');
      try {
        populateVoice(await voiceRequest('POST', {
          voiceEnabled: get('voiceEnabled').checked,
          voiceName: get('voiceName').value,
          voiceWhisperEnabled: get('voiceWhisperEnabled').checked,
          voiceTodoEnabled: get('voiceTodoEnabled').checked,
          clickSoundEnabled: get('clickSoundEnabled').checked
        }));
        // 桌面窗口在启动时就把音色读进内存了：保存后主动让它重拉配置，否则得重启应用才生效
        voiceMessage(await reloadDesktopPet());
      } catch (error) { voiceMessage(error.message, true); }
      finally { voiceSave.disabled = false; }
    });
  }
  if (!token) { message('请从桌宠菜单或本机启动器打开设置，以获得本次运行的访问凭据。', true); return; }
  voiceRequest('GET').then(data => { populateVoice(data); voiceMessage('语音设置只在本机保存。'); })
    .catch(error => voiceMessage(error.message, true));
  request('GET').then(data => { populate(data); save.disabled = false; message('设置只在本机保存。'); })
    .catch(error => message(error.message, true));
})();
`;
