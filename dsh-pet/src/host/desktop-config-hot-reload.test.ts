/**
 * 「设置页保存语音 → 桌面宠物立刻换音色」这条链路的跨半侧契约。
 *
 * 背景（真实故障）：单进程应用里 `startHelper` 是空实现，所以 `POST /reload` 旧实现只调
 * `requestRestart()`，实际什么都没做；设置页又是 fire-and-forget，照样提示「正在重载」。
 * 用户看到的就是「提示已保存、一直在等、音色一直没变」。
 *
 * 这条链路横跨两半（宿主半侧 src/ 与桌面运行时 runtime/），两边各自打包、无法互相 import，
 * 只能读源码钉住接线。任何一环被删掉，都会退回到「点了没反应」：
 *   ① 渲染端认识 `pet:config-changed` 并重拉配置（换音色才会真的换）；
 *   ② preload 把该频道暴露给渲染端（缺了渲染端永远收不到）；
 *   ③ 同进程 Helper 注册热重载入口（缺了宿主半侧无处可调）；
 *   ④ 宿主半侧把入口交给伪 ctx（缺了路由软取不到）；
 *   ⑤ 路由优先热重载（缺了又回到空转的 requestRestart）；
 *   ⑥ 设置页等结果并如实回显（缺了用户还是看不到失败）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { handleDesktopRoutes } from './routes/desktop.ts';
import type { PetRouteDeps, RouteInput } from './routes/types.ts';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const renderer = read('../../runtime/electron-helper/renderer.js');
const preload = read('../../runtime/electron-helper/preload.js');
const helperMain = read('../../runtime/electron-helper/main.js');
const appMain = read('../app/main.ts');
const context = read('../standalone/context.ts');
const desktopRoute = read('./routes/desktop.ts');
const settingsPage = read('../standalone/settings-page.ts');

describe('配置热重载 —— 设置页保存后桌面宠物立刻换音色', () => {
  test('渲染端：监听 pet:config-changed 并重拉配置（音色由此更新）', () => {
    assert.match(preload, /onConfigChanged\(cb\)/, 'preload 必须暴露 onConfigChanged');
    assert.match(preload, /ipcRenderer\.on\('pet:config-changed'/, '频道名必须与主进程 send 一致');
    assert.match(renderer, /petBridge\.onConfigChanged\(/, 'renderer 必须订阅热更新');
    assert.match(renderer, /function reloadConfig\(\)/, 'renderer 必须有 reloadConfig');
    // 热重载必须复用同一份「全局配置应用」接线，否则容易只更新音色、漏掉音效开关
    assert.match(renderer, /function applyGlobalConfig\(cfg\)/, '全局配置应用必须抽成一份共同实现');
    const reload = /async function reloadConfig\(\) \{([\s\S]*?)\n\}/.exec(renderer);
    assert.ok(reload, 'reloadConfig 必须存在');
    assert.match(reload[1], /applyGlobalConfig\(cfg\)/, '热重载必须复用 applyGlobalConfig');
    assert.match(renderer, /S\.setVoiceConfig\(cfg\.voiceName, cfg\.voiceEnabled\)/, '音色注入仍在共用实现里');
  });

  test('同进程 Helper：APP_MODE 下注册热重载入口，向窗口发同一频道', () => {
    assert.match(helperMain, /if \(APP_MODE\) \{[\s\S]*?__dshPetReloadDesktop/, '仅同进程应用注册该入口');
    const hook = /__dshPetReloadDesktop = \(\) => \{([\s\S]*?)\n {2}\};/.exec(helperMain);
    assert.ok(hook, '必须定义 __dshPetReloadDesktop');
    assert.match(hook[1], /webContents\.send\('pet:config-changed'\)/, '必须把频道推给每个宠物窗口');
    assert.match(hook[1], /petWindows\.state\.windows\.values\(\)/, '必须遍历全部窗口（多只宠物）');
  });

  test('宿主半侧：伪 ctx 带上 reloadDesktop，路由优先走它', () => {
    assert.match(context, /reloadDesktop\?: \(\) => unknown/, 'StandaloneContextOptions 必须有 reloadDesktop');
    assert.match(context, /\.\.\.\(options\.reloadDesktop \? \{ reloadDesktop: options\.reloadDesktop \} : \{\}\)/);
    assert.match(appMain, /reloadDesktop: \(\) => \{/, '独立应用必须把它交给伪 ctx');
    assert.match(appMain, /__dshPetReloadDesktop/, '实现里要读 Helper 注册的全局入口');

    const block = /if \(rest === 'reload'\) \{([\s\S]*?)\n {2}\}/.exec(desktopRoute);
    assert.ok(block, '/reload 路由必须存在');
    assert.match(block[1], /optionalService\('reloadDesktop'\)/, '路由必须软取热重载能力');
    assert.match(block[1], /mode: 'hot'/, '热重载成功要如实标成 hot');
    assert.match(block[1], /void requestRestart\(\)/, '没有热重载能力时仍要回落到重启 Helper');
  });

  test('设置页等结果再回显，不再 fire-and-forget 一句「正在重载」', () => {
    assert.match(settingsPage, /async function reloadDesktopPet\(\)/, '必须有带结果的重载调用');
    assert.match(settingsPage, /voiceMessage\(await reloadDesktopPet\(\)\)/, '必须等结果再提示');
    assert.doesNotMatch(
      settingsPage,
      /fetch\(ROUTE \+ '\/reload'[\s\S]{0,200}\.catch\(\(\) => \{\}\)/,
      '不能吞掉重载失败——那正是「一直在等、音色没变」的成因',
    );
  });
});

/**
 * 行为级验证：直接调路由，确认「有热重载能力就热重载、没有才重启 Helper」。
 * 上面几条是源码接线断言，这条钉的是真正跑起来的分支，避免接线在、分支写反。
 */
describe('/reload 的分支行为', () => {
  /** 一份只含本路由用到字段的依赖。 */
  function deps(hot: (() => unknown) | undefined) {
    const calls = { restarted: 0, hot: 0 };
    return {
      calls,
      value: {
        log: { warn: () => {}, info: () => {}, error: () => {} },
        requestRestart: async () => {
          calls.restarted += 1;
        },
        optionalService: (name: string) => (name === 'reloadDesktop' ? hot : undefined),
      } as unknown as PetRouteDeps,
    };
  }

  const input = (method: string): RouteInput => ({ url: new URL('http://127.0.0.1/x/reload'), rest: 'reload', method });

  test('宿主提供热重载：调用它、回 mode=hot，且不重启 Helper', async () => {
    const { calls, value } = deps(() => {
      calls.hot += 1;
      return 1;
    });
    const result = await handleDesktopRoutes(value, input('POST'));
    assert.equal(calls.hot, 1, '必须真的调用宿主的热重载入口');
    assert.equal(calls.restarted, 0, '热重载可用时不该再走（空转的）重启');
    assert.deepEqual((result as { obj: unknown }).obj, { reloading: true, mode: 'hot', windows: 1 });
  });

  test('热重载抛错：回落到重启 Helper（别让设置页以为成功）', async () => {
    const { calls, value } = deps(() => {
      throw new Error('未就绪');
    });
    const result = await handleDesktopRoutes(value, input('POST'));
    assert.equal(calls.restarted, 1, '热重载失败要回落到重启，避免请求白点');
    assert.equal((result as { obj: { mode?: string } }).obj.mode, 'restart');
  });

  test('DSH 双进程模式（无该服务）：照旧重启 Helper', async () => {
    const { calls, value } = deps(undefined);
    const result = await handleDesktopRoutes(value, input('POST'));
    assert.equal(calls.restarted, 1);
    assert.equal((result as { obj: { mode?: string } }).obj.mode, 'restart');
  });

  test('只接受 POST：GET 探能力也不行（重载是动作）', async () => {
    const { calls, value } = deps(() => 1);
    const result = await handleDesktopRoutes(value, input('GET'));
    assert.equal(calls.hot, 0);
    assert.equal(calls.restarted, 0);
    assert.equal((result as { status: number }).status, 405);
  });
});
