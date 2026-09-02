# WorkBuddy 字体 & 配色补丁工具

把 WorkBuddy 桌面端的界面字体换成你喜欢的任意字体，并可一键切换为 **Claude 暖色配色**（暖米白纸感 + 墨色文字 + 橙棕点缀）。

> 缘起：群里有人想把 WorkBuddy 界面换成「仓耳今楷」，折腾半天发现官方设置只能调字号、改不了字体样式，于是写了个脚本直接把字体"焊"进程序里。后来又想把配色改成 Obsidian 上 Claude 主题的暖色调，一并做了。这里把它做成了通用版，任何人都能用。

## 原理

WorkBuddy 是基于 Electron 的桌面应用，界面字体和配色硬编码在安装目录的 `app.asar` 文件里（CSS 变量的字体栈 + 设计 token）。本脚本：

1. **关闭界面校验开关**：新版 WorkBuddy（5.5.x）在 `WorkBuddy.exe` 里开了 Electron 的
   `EnableEmbeddedAsarIntegrityValidation`，一旦改了 `app.asar` 就拒绝启动。本脚本会先把它关掉（改 exe 里 1 个字节）；
2. 解析 `app.asar`（自包含解析逻辑，**零第三方依赖**，只要电脑有 Node.js 就能跑）；
3. **字体**：把你指定的字体名加进界面字体栈的最前面；
4. **配色**：在设计 token 主文件末尾追加一段 light 主题的变量覆盖；
5. 重新打包，自动备份原文件。

**只改「界面 UI 字体」**，代码区/等宽字体不受影响（代码保持等宽，不会变楷体）。

## 前置条件

1. **先安装好你想要的字体**（否则改了也不显示）。下载 `.ttf`/`.otf` 后双击 → 点「安装」即可。
2. 电脑上有 **Node.js**（脚本零依赖，但需要 node 运行时）。没装的话去 <https://nodejs.org> 下载安装。
   - 装了 WorkBuddy 的机器一般也自带了 node，双击 `.bat` 会自动找到，无需手动装。

## 用法

### 方式一：双击运行（最简单）

> **新版 WorkBuddy（5.5.x 及以上）必须按两步走。** 官方在程序里加了校验，直接改界面会导致打不开。

1. **完全退出 WorkBuddy**（右下角托盘图标右键 → 退出，不是关窗口）。
2. **第 1 步**：双击 `fuse-off.bat`，把官方的界面校验开关关掉。
3. **重新打开 WorkBuddy，确认能正常启动。**（这一步很重要，确认没问题再往下走）
4. 再次**完全退出 WorkBuddy**。
5. **第 2 步**：双击 `patch-font.bat`。
   - 输入字体名，直接回车 = 用上次的选择（例如 `仓耳今楷03` 或 `霞鹜文楷`）；
   - 是否改成 Claude 暖色配色，直接回车 = 改。
6. 等窗口显示「替换完成」，重新打开 WorkBuddy 即可。

> 嫌两步麻烦？直接双击 `patch-font.bat` 也行——它会自己检测到校验开关还开着，自动关掉再改，
> 全程一步完成。分两步走只是为了**先把风险切小**：万一第 1 步就出问题，界面还没动过。

### 方式二：命令行

```bash
# 换字体 + 改配色（会自动处理校验开关）
node workbuddy-font-patcher.js "仓耳今楷03"

# 换多个字体（第一个优先，找不到就回退到第二个）
node workbuddy-font-patcher.js "霞鹜文楷, LXGW WenKai"

# 只改配色、不动字体（字体那步直接回车跳过）

# 体检：只看当前状态，不做任何修改
node workbuddy-font-patcher.js check

# 更新后一键恢复：用记住的设置，全程无交互
node workbuddy-font-patcher.js auto

# 总还原：把字体、配色、程序文件全部恢复成官方原样
node workbuddy-font-patcher.js restore
```

校验开关也可以单独操作（对应 `fuse-off.bat`）：

```bash
node workbuddy-fuse-tool.js status    # 只看状态
node workbuddy-fuse-tool.js off       # 关闭校验（改界面的前提）
node workbuddy-fuse-tool.js on        # 恢复官方默认
node workbuddy-fuse-tool.js restore   # 用备份还原整个 exe
```

## 怎么知道字体名？

装完字体后，在 **Windows 设置 → 个性化 → 字体** 里搜索它，显示的名字就是「字体家族名」。例如：

- 仓耳今楷 → `仓耳今楷03`（或英文 `TsangerJinKai03`）
- 霞鹜文楷 → `LXGW WenKai`
- 思源黑体 → `Source Han Sans SC` / `Noto Sans CJK SC`

⚠️ **字体名要精确**，差一个字都不生效（比如「仓耳今楷」和「仓耳今楷03」是两个名字）。

## 配色改了什么

只改 **light（浅色）主题**，dark 主题不受影响。功能色（红/绿/黄/蓝）一律不动。

| 变量 | 原值 | 改后 |
|---|---|---|
| 主强调色（品牌色） | 青绿 `#00C29A` | 橙棕 `#b7791f` |
| 主背景 | 纯白 `#FFFFFF` | 暖米白 `#f8f7f2` |
| 主文字 | 纯黑 `#000000` | 墨色 `#49432f` |
| 灰阶 1~5 | 冷灰 `#FAFAFA`~`#E6E6E6` | 暖灰 `#faf9f4`~`#ddd7c6` |
| 侧边栏背景 | 冷灰 | `#f6f5ef` |

## 注意事项

- **必须先完全退出 WorkBuddy 再运行**，否则文件被占用、且要重启才生效。脚本检测到程序在运行会直接停手，不会破坏任何文件。
- **WorkBuddy 升级更新后，字体、配色、校验开关都会被官方恢复原样**，重新跑一次即可。
  - 升级后最省事：双击 `auto-restore.bat`，用记住的设置一键全部恢复（关开关 + 字体 + 配色），全程无交互。
  - 脚本会检测到升级并自动刷新备份，不会拿旧备份覆盖新版。
  - 重复运行不会把字体名叠加（自动以原始备份为基底重新生成）。
- 脚本会自动备份原文件（`app.asar.backup` + `WorkBuddy.exe.backup`），还原时用 `restore-font.bat`（或命令行 `restore`）即可。
- 只测过 **Windows**。macOS 的安装路径已内置探测，但未经实测；如找不到，欢迎提 issue。

## 升级后失效了怎么办

先跑体检看看：

```bash
node workbuddy-font-patcher.js check
```

它会告诉你有没有找到「设计 token 主文件」，以及**校验开关当前的状态**。正常应该显示类似：

```
token 主文件   : renderer/assets/safe-delete-events-XXXX.css
asar 校验开关  : ❌ 开启中 → 改界面会导致打不开，需先关闭
```

- 如果校验开关显示「开启中」：升级后官方把它恢复了，直接双击 `patch-font.bat` 会自动关掉再改。
- 如果显示「未找到 token 主文件」：说明官方又改了结构，把体检结果贴到 issue 里即可。想看得更细，可以用自带的诊断脚本：

```bash
node tools/asar-probe.js
```

它会输出 asar 概况、token 主文件位置、字体变量定义在哪几个文件、CSS 加载顺序、主题选择器分布、补丁状态等，只读不改，方便你自己定位新挂载点。

> 本工具的配色挂载点是**按内容特征自动识别**的（找定义 `--wb-palette-brand-8` 的那个 CSS），不认文件名，所以官方改文件名不会导致失效。

## 文件说明

| 文件 | 作用 |
|---|---|
| `patch-font.bat` | 一键换字体 + 改配色（自动处理校验开关） |
| `fuse-off.bat` | 分两步走时的第 1 步：只关校验开关，不动字体配色 |
| `restore-font.bat` | 总还原：字体、配色、程序文件全部恢复官方原样（有确认） |
| `emergency-restore.bat` | 紧急还原：同上但**无交互直接执行**，用于改完打不开时 |
| `auto-restore.bat` | WorkBuddy 更新后一键恢复字体配色（用记住的设置，无交互） |
| `check.bat` | 一键体检，只看不改 |
| `workbuddy-font-patcher.js` | 核心脚本（纯 Node，零依赖） |
| `workbuddy-fuse-tool.js` | 校验开关专用工具（status / off / on / restore） |
| `tools/asar-probe.js` | 诊断脚本，输出 asar 结构与挂载点信息（只读，排查用） |
| `fonts/` | 附赠字体：仓耳今楷（5 字重，免费商用）+ 霞鹜文楷（3 字重，开源 OFL），双击 ttf 即可安装 |

## 更新日志

### v3.0

- **解决「改完打不开」**：官方在 `WorkBuddy.exe` 里开启了 Electron 的 asar 完整性校验
  （`EnableEmbeddedAsarIntegrityValidation`），改 `app.asar` 会被拒绝启动。本版主流程会先**自动检测并关闭该校验开关**
  （改 exe 里 1 个字节，改前自动备份 exe）。
- `restore` 升级为**总还原**：app.asar + WorkBuddy.exe + 校验开关，一次全部恢复官方原样，不会退回旧版本。
- 新增 `auto` 模式（`auto-restore.bat`）：记住上次的字体名和配色选择，更新后无交互一键恢复。
- 记住用户选择存到本地配置，重复运行默认沿用上次选择。

### v2.0

- 适配新版 WorkBuddy：**配色挂载点不再认文件名**（旧版 `cb-bridge` 文件已被官方移除），改为按内容特征自动识别设计 token 主文件。
- 配色变量加 `!important`，防止官方调整 CSS 加载顺序导致失效。
- 重复运行不再叠加字体名。
- WorkBuddy 升级后自动刷新备份，避免「还原」退回旧版本。
- 新增 `check` 体检模式。

## 免责声明

本工具通过修改本地安装的程序文件实现，属于非官方手段，仅供个人美化使用。使用前会自动备份，但请知悉：改动程序文件有极小概率导致异常（可随时 `restore` 还原）；WorkBuddy 升级后需重新应用。
