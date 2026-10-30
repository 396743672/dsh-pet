# 安装（dsh-pet）

> 返回 [README](README.md)

装法取决于你在用哪个 DSH：**桌面应用**用应用内「插件管理」，**`dsh web`** 用命令行，改用源码安装则先 clone 再构建。几条路最终都是把插件装进 profile 的 `node_modules`，效果一样；区别只是入口。

装完**重开 DSH**（`dsh web` 用户则重启 `dsh web`）才生效——运行中的进程持有内存里的旧插件。宠物出现在界面右上角（默认配置角落，可在设置页修改）。

## 前置要求

命令行安装需要 Node.js 与 DSH 启动器；桌面应用自带 CLI 与运行时，可跳过本节。

```sh
# ① 前置要求：确认 Node.js 已安装
node -v

# ② 安装 DSH 启动器与 pnpm（已装可跳过；装完请重新打开终端）
npm install -g @deepseek-ai/dsh pnpm
dsh --version   # 验证 dsh 命令可用
```

## 方式一：应用内「插件管理」（桌面应用）

直接打开应用内「插件管理」页，在安装框里填 `dsh-pet`，不用开终端。需要在终端里操作插件时，用桌面应用自带的那份 CLI。

## 方式二：命令行（`dsh web` 与桌面应用）

`--profile <profile>` 指定装进哪个 profile，按你在用的界面填：

| 你在用的界面            | `--profile` 的值 |
| ----------------------- | ---------------- |
| `dsh web`（浏览器）     | `web`            |
| 桌面应用（Electron 版） | `desktop`        |

```sh
# dsh web
dsh plugin --profile web add dsh-pet

# 桌面应用（Electron 版）
dsh plugin --profile desktop add dsh-pet
```

> **兼容性**：本插件当前在 dsh **`0.2.1-rc.3`** 下开发并测试（`dsh --version` 可查看你的版本）。建议使用相同版本；其他版本如遇问题欢迎反馈。

## 方式三：从源码安装（clone 本仓库后）

`lib/` 构建产物不入库，clone 后需要先构建再安装：

```sh
# ① clone 本仓库，进入插件目录
git clone https://github.com/PC2005-cloud/dsh-pet.git
cd dsh-pet/dsh-pet

# ② 安装依赖
npm install

# ③ 构建（完整 lib：tsdown → lib + 桌面共享核心 + 类型声明）
npm run build       # 必须手动跑一次（克隆后 npm install 不再自动构建）

# ④ 安装到 DSH（file: 指向**插件目录**——上面 cd 进去的那一层，用构建好的 lib）
#    --profile 填实际在用的那个：dsh web → web；桌面应用 → desktop
dsh plugin --profile web add file:D:/path/to/dsh-pet/dsh-pet
```

> 注：`npm run build`（即 `scripts/prepare.js`）才产出**完整可安装**的 lib——除 tsdown 构建外还构建桌面共享核心（`shared-core.js`）、生成类型声明并收敛发布 `files` 清单；裸 `tsdown` 构建会缺桌面运行时与类型。发布与打包（`npm publish` / `npm pack`）时由 `prepack` 自动调用它，克隆仓库后需手动跑一次。

## 独立模式（无需 DSH）

完全不装 DSH 也能用：宿主半边跑在伪 ctx 上，由一个本机服务接管路由（**路由表仍是插件那一份**），桌宠显示在独立窗口里。两种拿到它的方式——用 Release 里的绿色包，或从源码自己构建。

### 直接运行（Release 绿色版）

1. 到 [Releases](https://github.com/PC2005-cloud/dsh-pet/releases) 页面挑一个版本，下载它的 `dsh-pet-win-x64.zip`（固定名）；
2. 解压到任意目录，例如 `D:\dsh-pet`；
3. 双击目录里的 `dsh-pet.exe`。

不需要 Node.js，也不需要 DSH，Electron 运行时已经打进包里；关闭窗口即退出。

> Release 只提供 **Windows x64**；macOS / Linux 用下面的 npm 形态。

### 用 npm 全局安装（Node 形态）

需要 Node.js，跨平台通用：

```sh
npm install -g dsh-pet        # 必须 npm 装；dsh plugin add 会装进 profile，bin 不在 PATH 上
dsh-pet-standalone            # http://127.0.0.1:3080/dsh-pet-7340/（端口占用则顺延）
dsh-pet-standalone --check    # 只体检，不启动
dsh-pet-standalone --port 3100
```

`Ctrl+C` 或 `POST /shutdown` 退出。

### 从源码构建与启动

```sh
npm install
npm run build          # 完整 lib：tsdown + 桌面共享核心 + 类型声明
npm run standalone     # Node 形态启动，等同 dsh-pet-standalone
```

### 打包成 exe

```sh
npm run ensure:electron   # 首次：解析本机 Electron 解压目录（没有则下载到 ~/.dsh/electron）
npm run dist              # electron-builder 打包
```

产物在 `dist-app/win-unpacked/`，双击其中的 `dsh-pet.exe` 即可运行。**只出「解包目录」一种形态**（绿色版），不出 nsis 安装包——要分发就把整个目录压成 zip。

- 本机找不到 Electron 解压目录时 `dist` 会直接失败并提示先跑 `ensure:electron`（可用 `DSH_PET_ELECTRON_DIST` 指向现成目录）；CI 里设 `DSH_PET_ALLOW_ELECTRON_DOWNLOAD=1` 让它自行下载。
- 发版由 `v*` tag 触发 `.github/workflows/release-app.yml`：构建后把固定名 `dsh-pet-win-x64.zip` 挂到该 tag 的 Release 上（不创建 Release、不改更新日志）。

### 能力边界

- **能用**：动画链、点击/拖拽/甩抛、右键菜单、多开、自定义动画与表情包、pet pack。
- **不可用**：余额、碎碎念、对话、系统通知——没有 DSH 的凭据与模型连接，接口返回带 `reason` 的结构化失败（见 [API.md](API.md)）。
- **配置**：与 DSH 同一份（`$DSH_HOME/dsh-pet/main-config.jsonc` → 包内默认）。
- **只显示** `display` 含 `desktop` / `both` 的实例；端口默认 3080（占用则顺延）。
- **可与 DSH 内运行同时开**，但共用 `%APPDATA%\dsh-pet-electron-helper`，可能互相踩缓存（仅告警）。

## 安装后你会看到什么

默认配置是 `display: "both"`（浏览器与桌面都显示），所以重开 DSH 之后会依次出现两处，不必手动开：

1. **浏览器端先出现。** 宠物落在界面右上角（默认角落，设置页可改），此时桌面上还是空的。
2. **宿主自动补桌面运行时。** 本机没有 Electron 时，插件会自己下载一份（落在 `~/.dsh/electron`，同一版本只下一次；默认走 npmmirror 镜像）。进度直接打在 DSH 的控制台里，形如：

   ```
   [dsh-pet] Electron not found, downloading to <用户目录>/.dsh/electron/electron.exe ...
   [dsh-pet] Electron not found, downloading v43.3.0 (win32-x64) ...
   [dsh-pet] downloading 42.3MB / 104.1MB
   [dsh-pet] download complete (37.5s), extracting to <用户目录>/.dsh/electron ...
   ```

   这一步在**后台**进行，浏览器里的宠物照常可用；要等多久取决于网速（几十秒到几分钟），期间不用管它。

3. **桌面端随后出现。** 解压完自动拉起桌面 Helper，同一只宠物以透明窗形式落到桌面上——**此时屏幕上一共两只**：浏览器里一只、桌面上那只，共用同一份配置与同一套动画。
4. **想只留一只。** 两条路都行，改完即时生效：
   - **设置页**：选中该宠物 →「显示位置」下拉框 → 仅浏览器 / 仅桌面 / 两者都显示 / 都不显示；
   - **宠物右键**：菜单里的「显示位置」子菜单 → 仅网页 / 仅桌面 / 两者 / 都不（不用回设置页）。

> 已经装过 Electron（或设了 `DSH_PET_ELECTRON_PATH` 指向现成可执行文件）时，第 2 步会跳过，桌面端几乎立刻出现。下载失败**只影响桌面模式**：控制台会给出提示，浏览器里的宠物不受影响；网络受限时可以设 `DSH_PET_ELECTRON_MIRROR` 换镜像、`DSH_PET_ELECTRON_VERSION` 指定版本，重启后再试。

## 本地语音（德丽莎 / VITS）怎么验

本地音色是**离线神经网络合成**，模型与 sherpa-onnx 运行时不在 npm 包里，要单独部署一次：在**仓库根**（不是 `dsh-pet/` 目录）跑

```sh
node patch.mjs                     # 缺什么补什么；重跑幂等，插件升级后重跑即可恢复
node patch.mjs --check             # 只查状态：就绪退出码 0
node patch.mjs --target <插件目录>  # 插件装在别处（如 dsh plugin add 装进 profile）时指过去
```

部署到**插件自己的安装目录**下的 `voice/`（`<插件包根>/voice/`）——跟着插件装在哪就跟到哪，不依赖用户目录、也不依赖 DSH 数据根。脚本启动会打印它认定的「插件目录」和「voice 根」，两个路径都能一眼核对；插件装在别的路径（尤其 `dsh plugin add` 装进 profile 的副本）时用 `--target` 指过去。确实要放共享盘之类的地方，设 `DSH_PET_VOICE_DIR` 直指 voice 根——部署脚本和运行时读的是同一个变量。

> 合成缓存仍在用户数据根（`<DSH 数据根>/dsh-pet/voice-cache/`）：模型是随插件的运行件，缓存是用户数据，两者分开。

装好后按三级验证，从便宜到贵：

**① 只听音色（不需要 DSH、不需要装插件）**

```sh
cd dsh-pet
node --experimental-strip-types scripts/smoke-vits.mjs --play
```

走完整推理链（worker 线程 → sherpa-onnx → theresa → WAV），打印文件路径、采样率（22050 Hz）、音频时长，`--play` 顺手用系统播放器打开。没声音但文件正常，就用别的播放器双击那个 wav。

**② 再验语音服务（校验 / 音色路由 / 缓存）**

```sh
node --experimental-strip-types scripts/smoke-vits.mjs --service
```

这一层走插件的 `createVoiceService`，会打印 `cache=miss` / `cache=hit` 与 `contentType=audio/wav`。连跑两次，第二次应该是 `cache=hit` 且几十毫秒返回。

**③ 实机（DSH 里）**

源码装法见上文方式三（宿主半侧改动必须**重开 DSH**）。然后在设置页「语音」打开播报总开关、音色选「德丽莎（女 · 本地 · 萝莉）」保存，右键宠物 →「碎碎念」应能听到德丽莎音。三个验收点：

- **音色对不对**：女声、幼、偏萝莉；不是 Windows 系统音那个机器人腔。
- **断网也能响**：拔网线或关掉代理后再触发一次（Edge 音色这时会失败，本地音色不受影响）——这是本地后端和 Edge 后端最本质的区别。
- **重启后音色保持**：重启 DSH，设置页里仍是德丽莎（配置落在 `main-config.jsonc`，不是内存态）。

> 本地音色不可用时不会拖垮其它功能：合成失败只让气泡上的喇叭变成静音态，切回 Edge 音色照常联网合成。

### 单进程桌宠应用（Electron）下的额外要求

`npm run start:app` / 打包出来的桌面应用里，本地音色的推理跑在**独立 Node 子进程**里，因此那台机器上必须能找到 `node`（Node ≥ 22.12）：

- 默认在 `PATH` 里找 `node`；
- 找不到就设 `DSH_PET_NODE_BIN=/path/to/node`（或 `node.exe`）。

为什么不能像 DSH 那样用线程：Electron 从 21 起启用 V8 memory cage，禁止 `napi_create_external_arraybuffer`（见 Electron 官方博客 _Electron and the V8 Memory Cage_ 与 Node-API 文档里的 `napi_no_external_buffers_allowed`），而 sherpa-onnx 的原生插件正是用外部缓冲返回采样，`tts.generate()` 会直接抛 `External buffers are not allowed`；连 `ELECTRON_RUN_AS_NODE` 也是同一个二进制，同样被拒。放进普通 Node 进程即绕开。

在 DSH 宿主里没有这个限制——那里本来就是 Node，用 worker 线程，不需要额外安装任何东西。

### 单进程应用里语音/音效在哪改

单进程应用没有 DSH 的设置页，配置入口是**右键桌宠 →「打开 AI 设置」**（本机带令牌的设置页）。页面下半部分「语音播报与音效」就是这一组开关：

- **语音播报**：总开关（碎碎念与对话回复念不念）；
- **音色**：下拉里同时列出 Edge 在线音色与本地「德丽莎」（本地那条不需要联网）；
- **周期碎碎念朗读 / 待办提醒朗读**：两个子开关，受总开关约束；
- **音效**：点一下宠物 / 右键点播动画时，用当前音色说一句短语气词（点击「嗯？」「干嘛？」「哼」，点播「看好了」）；合成不出来（没部署 `voice/`、断网）时回落内置 `click-duck.wav`。待机与随机漫游不出声——那些几秒一次，出声就是噪音；
- **试听**：就地合成一句，验证音色与「voice/ 目录部署好了没」。

保存后页面会让桌面宠物**就地重拉配置**（换音色、开关音效立刻生效，不闪窗、位置不变），页面会如实回显重载结果。桌面窗口只在启动时读一次音色，没有这一步就得重启应用。写入的仍是 `main-config.jsonc` 顶层的同一批字段，DSH 设置页看到的是同一份值。

### 碎碎念一直不出声？先看「出网代理」

单进程应用的模型请求走 Chromium 网络栈（不是 Node 的 `fetch`），默认**跟随系统代理**：

- 系统代理没开、而接口又直连不通时，每个请求都会一直等到超时，表现就是「右键碎碎念没反应」「日志里每拍都是 `Standalone AI request cancelled or timed out`」；
- 这时在设置页「模型连接」里填**出网代理**（如 `127.0.0.1:7897`，省略协议按 http 处理，支持 http/https/socks5），保存后下一次请求即生效；本机与局域网地址永远直连；
- 慢接口/推理模型首字可能要 20 秒以上，把**单次请求超时**调到 60 秒；碎碎念的本地截止时间会跟着这个设置走（不再写死 30 秒）；
- 手动点「碎碎念」会**抢占**正在跑的周期碎碎念（用户意图优先），所以慢接口下不必等那一拍跑完。

代理设置只在单进程桌面应用里生效；CLI 模式（`npm run standalone`）用纯 Node 出网，会打一行 warn 说明该字段不适用。

## 下一步

- 大小、位置、多开、物理参数等配置：见 [CONFIG.md](CONFIG.md)
- 想自己生成一只宠物：见 [MAKE-YOUR-OWN-PET.md](MAKE-YOUR-OWN-PET.md)
