/**
 * voice 目录与 Node 解释器解析的行为测试（src/host/voice/vits.ts）。
 *
 * 钉住两条契约：
 * 1. **目录跟着插件自己的安装位置走**，既不写死绝对路径，也不落到用户数据根；需要挪位置只能靠
 *    `DSH_PET_VOICE_DIR` 整体接管。
 * 2. **Node 宿主用自己跑合成**（`process.execPath`），Electron 宿主必须换外部 Node——Electron
 *    的 V8 memory cage 禁止 sherpa-onnx 的外部缓冲，用自己只会必然失败。
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE_ROOT } from '../paths.ts';
import { NODE_BIN_ENV, VOICE_DIR_ENV, resolveNodeBin, resolveVoiceDir } from './vits.ts';

/** 在临时改环境变量前后复原，避免用例间串味。 */
function withEnv<T>(name: string, value: string | undefined, run: () => T): T {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

/** 同 {@link withEnv}，专用于 voice 根目录覆盖变量。 */
function withVoiceDirEnv<T>(value: string | undefined, run: () => T): T {
  return withEnv(VOICE_DIR_ENV, value, run);
}

test('resolveVoiceDir：默认落在插件包根下的 voice/，换包根就跟着换', () => {
  const a = join('anywhere', 'plugin-a');
  const b = join('elsewhere', 'plugin-b');
  withVoiceDirEnv(undefined, () => {
    assert.equal(resolveVoiceDir(a), join(a, 'voice'));
    assert.equal(resolveVoiceDir(b), join(b, 'voice'), '换安装位置必须跟着换');
  });
});

test('resolveVoiceDir：不传参时用 PACKAGE_ROOT，而不是用户目录或数据根', () => {
  withVoiceDirEnv(undefined, () => {
    assert.equal(resolveVoiceDir(), join(PACKAGE_ROOT, 'voice'));
  });
});

test('resolveVoiceDir：DSH_PET_VOICE_DIR 整体接管，空白值视为未设', () => {
  withVoiceDirEnv(join('custom', 'voice'), () => {
    assert.equal(resolveVoiceDir(join('anywhere', 'plugin-a')), join('custom', 'voice'));
  });
  withVoiceDirEnv('   ', () => {
    const root = join('anywhere', 'plugin-a');
    assert.equal(resolveVoiceDir(root), join(root, 'voice'), '纯空白不能当成覆盖值');
  });
});

test('resolveNodeBin：Node 宿主直接用自己（process.execPath）', () => {
  withEnv(NODE_BIN_ENV, undefined, () => {
    // 测试进程本身就跑在 node 下，versions.electron 为空即 Node 宿主分支
    assert.equal(process.versions.electron, undefined);
    assert.equal(resolveNodeBin(), process.execPath);
  });
});

test('resolveNodeBin：DSH_PET_NODE_BIN 优先，空白值视为未设', () => {
  withEnv(NODE_BIN_ENV, join('custom', 'node.exe'), () => {
    assert.equal(resolveNodeBin(), join('custom', 'node.exe'));
  });
  withEnv(NODE_BIN_ENV, '  ', () => {
    assert.equal(resolveNodeBin(), process.execPath, '纯空白不能当成覆盖值');
  });
});
