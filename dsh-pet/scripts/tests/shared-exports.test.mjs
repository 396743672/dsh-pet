/**
 * 桌面运行端与 `window.PetShared` 的契约测试：`S.xxx(...)` 调用的每个函数都必须真的被导出。
 *
 * 为什么要测：`runtime/electron-helper/sprite/**` 是手写 CJS，靠全局 `S` 调共享层；共享层
 * （src/shared → runtime/electron-helper/shared-core.js）由 `npm run build:desktop-core` 生成。
 * 两边没有类型约束，`src/shared` 重构删掉一个导出时，构建与 typecheck 全绿，只在运行时点开
 * 对应菜单才炸 —— 本项目已踩过两次（PLATFORM_LABELS 漏导出、markVoicePending 删了没清调用）。
 *
 * 本测试把这条契约钉在 CI 里：一旦出现「调用了不存在的导出」，直接失败并把函数名与文件打出来。
 * 跑法：node --test scripts/tests/shared-exports.test.mjs（npm run test:ui 会带上）。
 * 依赖生成物 shared-core.js：缺失时跳过（构建产物不入 git 的分支也能跑通）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const corePath = join(root, 'runtime', 'electron-helper', 'shared-core.js');
const helperDir = join(root, 'runtime', 'electron-helper');

/** 递归收集运行端所有手写源文件（生成物 shared-core.js 除外）。 */
function runtimeFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) runtimeFiles(full, out);
    else if (name.endsWith('.js') && full !== corePath) out.push(full);
  }
  return out;
}

describe('PetShared 导出契约 —— 运行端不得调用不存在的导出', () => {
  test('每个 S.xxx( 调用都能在 shared-core.js 里找到对应导出', () => {
    if (!existsSync(corePath)) {
      // 生成物缺失（未跑 build:desktop-core）：这里没有可校验的事实，跳过而不是假装通过
      return;
    }
    const core = readFileSync(corePath, 'utf8');
    const exported = new Set([...core.matchAll(/^exports\.([A-Za-z_$][\w$]*)\s*=/gm)].map((match) => match[1]));
    assert.ok(exported.size > 100, `导出解析异常：只读到 ${exported.size} 个，生成物格式可能变了`);

    const missing = [];
    for (const file of runtimeFiles(helperDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bS\.([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!exported.has(match[1])) {
          missing.push(`${match[1]}() ← ${file.slice(root.length).replace(/\\/g, '/')}`);
        }
      }
    }
    assert.deepEqual(
      [...new Set(missing)],
      [],
      '运行端调用了 shared-core.js 未导出的函数（点开对应菜单才会崩，构建与 typecheck 都不报）',
    );
  });
});
