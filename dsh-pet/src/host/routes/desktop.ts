/**
 * 桌面端生命周期：/reload 重新解析配置并重启 Helper，/quit 关闭宿主应用。
 *
 * 不负责 Helper 进程本身的拉活与重启（归 ./helper-process）。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/desktop
 */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** 桌面端生命周期领域：未命中返回 undefined，命中返回应答。 */
export async function handleDesktopRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { log, optionalService, requestRestart } = deps;
  const { method, rest } = input;

  // 桌面端「重载配置」（右键菜单 → POST /reload）：重启桌面 Helper，全部窗口按最新配置重建。
  // 与保存走同一条重启路径（requestRestart），宠物数量 / display / size 的变化同样生效——渲染端
  // 就地重拉做不到这几项。发起者就是即将被重启的 helper，故不 await、立刻回 200。
  if (rest === 'reload') {
    if (method !== 'POST') return methodNotAllowed();
    // 同进程应用（src/app/main.ts）里没有可重启的 Helper——startHelper 在那边是空实现，
    // 于是 requestRestart() 看起来成功、实际什么都没做（「提示正在重载，音色一直不变」的真因）。
    // 宿主若提供 reloadDesktop，就走「通知渲染端重拉 /config」的热重载：不重建窗口、不闪、位置不变。
    // DSH 双进程模式没有这个服务，仍旧重启 Helper（display/size 的变化只能靠重建窗口生效）。
    const hot = optionalService('reloadDesktop');
    if (typeof hot === 'function') {
      try {
        const sent = (hot as () => unknown)();
        return okResult({ reloading: true, mode: 'hot', windows: typeof sent === 'number' ? sent : undefined });
      } catch (e: unknown) {
        log.warn(`[dsh-pet] 配置热重载失败，改为重启 Helper：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    void requestRestart();
    return okResult({ reloading: true, mode: 'restart' });
  }

  // 托盘「退出」（托盘菜单 → GET 探能力 / POST 执行，issue #178）。不能让 helper 自己 app.quit()：
  // BRIDGE 模式下它由宿主拉起，退出会被当成崩溃按指数退避重启，点了只是闪一下、进程还在；
  // 必须由宿主执行「停 Helper + 关服务 + 退出」。该能力只有独立模式提供，DSH 内 canQuit:false。
  if (rest === 'quit') {
    // 能力按请求时软取：DSH 宿主没有这个服务（裸读属性会抛，见 optionalService 的说明），
    // 于是拿到 undefined → canQuit:false，退出菜单项不出现；独立模式取得到 → 菜单可用。
    const quit = optionalService('shutdownApp');
    const canQuit = typeof quit === 'function';
    if (method === 'GET') return okResult({ canQuit });
    if (method !== 'POST') return methodNotAllowed();
    // 失败按动作端点口径回 200 + 结构化结果（与 /pet-display 一致）：不支持退出不是协议层错误。
    if (!canQuit) {
      return failResult('unsupported', '宿主未提供退出能力（DSH 内请关闭桌面模式）');
    }
    // 不 await：收尾会先停掉发起请求的这个 Helper，响应不保证送达（与 /reload 同一处境）。
    // 推到下一拍再执行，让本次 200 先写出去。
    setImmediate(() => {
      try {
        (quit as (reason: string) => void)('托盘退出');
      } catch (e: unknown) {
        log.warn(`[dsh-pet] 托盘退出失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return okResult({ ok: true });
  }

  return undefined;
}
