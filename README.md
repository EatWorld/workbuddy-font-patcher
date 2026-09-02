# WorkBuddy 字体 & 配色补丁工具

把 WorkBuddy 桌面端的界面字体换成你喜欢的任意字体，并可一键切换为 **Claude 暖色配色**（暖米白纸感 + 墨色文字 + 橙棕点缀）。

> 缘起：群里有人想把 WorkBuddy 界面换成「仓耳今楷」，折腾半天发现官方设置只能调字号、改不了字体样式，于是写了个脚本直接把字体"焊"进程序里。后来又想把配色改成 Obsidian 上 Claude 主题的暖色调，一并做了。这里把它做成了通用版，任何人都能用。

## 原理

WorkBuddy 是基于 Electron 的桌面应用，界面字体和配色硬编码在安装目录的 `app.asar` 文件里（CSS 变量的字体栈 + 设计 token）。**新版 WorkBuddy（5.5.x）在 `WorkBuddy.exe` 里又开启了 Electron 的 `EnableEmbeddedAsarIntegrityValidation`**，改 `app.asar` 直接拒绝启动。本工具：

1. **关掉校验开关**：改 `WorkBuddy.exe` 里 1 个字节（改前自动备份 exe）；
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

**所有操作都从一个入口开始：双击 `wb-toolbox.bat`**（仓库里叫这个；你本地的副本可能叫"工具箱.bat"）。

弹出菜单：

```
[1] 改字体 + 配色（手动输入字体名）
[2] 更新后一键恢复（用上次的选择）
[3] 体检（只看当前状态，不改任何东西）
[4] 还原官方原样（字体配色、程序文件全部恢复默认）
```

**首次使用**：选 `1`，按提示输入字体名（直接回车 = 用上次的选择），配色那步直接回车即可。会**自动**先关校验开关再改字体配色——不需要分两步。

**WorkBuddy 更新后**：选 `2`，用记住的选择一键恢复，全程无交互。

**恢复到默认**：选 `4`，把字体、配色、exe 校验开关一次性全还原。

> ⚠ 改字体/恢复前**记得先完全退出 WorkBuddy**（托盘图标右键 → 退出，不是关窗口）。脚本检测到程序在跑会直接停手，不会破坏任何文件。

### 方式二：命令行

```bash
# 换字体 + 改配色（自动处理校验开关）
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

校验开关也可以单独操作：

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
- **WorkBuddy 升级更新后，字体、配色、校验开关都会被官方恢复原样**——这是官方程序决定的，本工具没法提前预防。脚本会自动检测升级并刷新备份（避免"还原"退回旧版本）。
- 脚本会自动备份原文件（`app.asar.backup` + `WorkBuddy.exe.backup`）。
- 重复运行不会把字体名叠加（自动以原始备份为基底重新生成）。
- 只测过 **Windows**。macOS 的安装路径已内置探测，但 bat 入口未做跨平台，建议 macOS 用户走命令行。

## 升级后失效了怎么办

1. 退出 WorkBuddy
2. 双击 `wb-toolbox.bat`，选 `2`（一键恢复）
3. 完成

如果一键恢复不动，先跑体检看看原因（菜单里 `3`，或命令行 `node workbuddy-font-patcher.js check`）。它会输出：版本、token 主文件位置、字体补丁状态、配色补丁状态、**校验开关状态**。

体检输出里关键两行：

```
token 主文件   : renderer/assets/safe-delete-events-XXXX.css
asar 校验开关  : ❌ 开启中 → 改界面会导致打不开
```

- 如果校验开关显示「开启中」：说明官方更新后把它恢复了，**自动恢复会一并处理**，不用管。
- 如果显示「未找到 token 主文件」：说明官方又改了 CSS 结构，把体检输出贴到 issue 里。

想自己深入定位（只读不改），可以用仓库带的诊断脚本：

```bash
node tools/asar-probe.js   # 输出 asar 结构与挂载点信息
node tools/fuse-check.js   # 探测 exe 的 fuse 校验开关状态
```

> 本工具的配色挂载点是**按内容特征自动识别**的（找定义 `--wb-palette-brand-8` 的那个 CSS），不认文件名，所以官方改文件名不会导致失效。

## 文件说明

| 文件 | 作用 |
|---|---|
| `wb-toolbox.bat` | **唯一入口**：双击后弹菜单，按数字选操作（4 个常用操作全包了） |
| `workbuddy-font-patcher.js` | 核心脚本（纯 Node，零依赖） |
| `workbuddy-fuse-tool.js` | 校验开关专用工具（status / off / on / restore），主流程会自动调用 |
| `tools/asar-probe.js` | asar 结构诊断脚本（只读），新版失效时排查挂载点 |
| `tools/fuse-check.js` | fuse 校验开关探测（只读），判断"改完打不开"是不是校验导致的 |
| `fonts/` | 附赠字体：仓耳今楷（5 字重，免费商用）+ 霞鹜文楷（3 字重，开源 OFL），双击 ttf 即可安装 |

> 你本地的副本可能叫"工具箱.bat"——和 `wb-toolbox.bat` 是同一个文件。

## 更新日志

### v3.1

- 桌面端**单一入口**：`wb-toolbox.bat`（中文版叫"工具箱.bat"）合并了原 6 个分散的 bat（patch-font、restore-font、auto-restore、emergency-restore、check、fuse-off），所有操作一个菜单走完。
- bat 强化：用 GBK + CRLF 编码（Windows 中文 cmd 友好），`chcp 65001` 已移除（旧版在密集中文 echo 下渲染不稳）。
- 仓库清理：移除冗余英文 bat，只保留 `wb-toolbox.bat` 一个入口文件。

### v3.0

- **解决「改完打不开」**：官方在 `WorkBuddy.exe` 里开启了 Electron 的 asar 完整性校验（`EnableEmbeddedAsarIntegrityValidation`），改 `app.asar` 会被拒绝启动。本版主流程会先**自动检测并关闭该校验开关**（改 exe 里 1 个字节，改前自动备份 exe）。
- `restore` 升级为**总还原**：app.asar + WorkBuddy.exe + 校验开关，一次全部恢复官方原样，不会退回旧版本。
- 新增 `auto` 模式：记住上次的字体名和配色选择，更新后无交互一键恢复。

### v2.0

- 适配新版 WorkBuddy：**配色挂载点不再认文件名**（旧版 `cb-bridge` 文件已被官方移除），改为按内容特征自动识别设计 token 主文件。
- 配色变量加 `!important`，防止官方调整 CSS 加载顺序导致失效。
- WorkBuddy 升级后自动刷新备份，避免「还原」退回旧版本。
- 新增 `check` 体检模式。

## 免责声明

本工具通过修改本地安装的程序文件实现，属于非官方手段，仅供个人美化使用。使用前会自动备份，但请知悉：改动程序文件有极小概率导致异常（可随时 `wb-toolbox.bat → 4` 还原）；WorkBuddy 升级后需重新应用。
