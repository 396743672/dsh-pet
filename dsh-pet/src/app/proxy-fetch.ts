/**
 * 独立应用的模型出网通道：走 Chromium 网络栈（`net.fetch`），并在每次请求前对齐代理设置。
 *
 * 为什么不能用 `globalThis.fetch`：主进程里那是 Node 的实现，既不读 Windows 系统代理，
 * 也没法指定代理，于是「系统代理开着但应用直连」这种失败会以 30 秒超时的形式出现，且看不出原因。
 * Chromium 网络栈可以按 `session.setProxy` 显式指定代理，用户填一次地址就够。
 *
 * 不负责校验代理地址（归 ai-config），也不负责生成逻辑（归 ai-provider）。
 * 必须始终成立：本机回环地址永远直连——代理一旦生效，应用自己那个 127.0.0.1 的 HTTP 服务也得绕开。
 * @module dsh-pet/src/app/proxy-fetch
 */
import type { AiFetch } from '../standalone/ai-transport.ts';

/** 代理设置的最小面：Electron `session` 的子集，便于测试替换。 */
export interface ProxySession {
  setProxy(config: {
    mode?: 'system' | 'direct' | 'fixed_servers';
    proxyRules?: string;
    proxyBypassRules?: string;
  }): Promise<void>;
}

/** Chromium 网络栈的最小面：Electron `net` 的子集。 */
export interface ProxyNet {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** 造出网通道所需的外部依赖。 */
export interface ProxyFetchOptions {
  /** Chromium 的 fetch（Electron `net.fetch`）。 */
  net: ProxyNet;
  /** 用来应用代理的会话。 */
  session: ProxySession;
  /** 当前设置的代理地址；空串表示跟随系统代理。 */
  proxyOf(): string;
  /** 变更日志出口；代理切换需要留痕，否则「填了没生效」无从查起。 */
  log?(message: string): void;
}

/**
 * 本机地址永远直连。
 *
 * 应用自己的 HTTP 服务就在 127.0.0.1 上：代理生效后若不绕开，渲染端连本机接口都会被转出去。
 */
const BYPASS = 'localhost;127.0.0.1;[::1];<local>';

/**
 * 造一个按设置切换代理的 fetch。
 *
 * 代理只在「地址变化」时下发一次：`setProxy` 是 Chromium 的全局状态，每次请求都设会拖慢首字。
 * 设置保存后不需要通知本层——下一次请求读到的 `proxyOf()` 已经变了。
 *
 * @param options - 网络栈、会话与代理来源。
 * @returns 供 standalone AI 服务使用的 fetch。
 */
export function createProxyFetch(options: ProxyFetchOptions): AiFetch {
  /** 已下发的代理地址；`undefined` 表示还没下发过（首次请求必定对齐一次）。 */
  let applied: string | undefined;

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const desired = options.proxyOf().trim();
    if (desired !== applied) {
      try {
        await options.session.setProxy(
          desired ? { mode: 'fixed_servers', proxyRules: desired, proxyBypassRules: BYPASS } : { mode: 'system' },
        );
        applied = desired;
        options.log?.(desired ? `模型请求走代理 ${desired}` : '模型请求跟随系统代理');
      } catch (error) {
        // 代理下发失败不该让整条通道报废：沿用上一次的代理继续试，失败原因留给请求本身。
        options.log?.('模型请求的代理设置下发失败：' + (error instanceof Error ? error.message : String(error)));
      }
    }
    return options.net.fetch(String(input), init);
  };
}
