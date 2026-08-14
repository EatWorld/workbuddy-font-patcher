# WorkBuddy 字体更换工具

把 WorkBuddy 桌面端的界面字体换成你喜欢的任意字体（正文、对话区、侧边栏等）。

> 缘起：群里有人想把 WorkBuddy 界面换成「仓耳今楷」，折腾半天发现官方设置只能调字号、改不了字体样式，于是写了个脚本直接把字体"焊"进程序里。这里把它做成了通用版，任何人都能用。

## 原理

WorkBuddy 是基于 Electron 的桌面应用，界面字体硬编码在安装目录的 `app.asar` 文件里（几个 CSS 变量的字体栈）。本脚本：

1. 解析 `app.asar`（自包含解析逻辑，**零第三方依赖**，只要电脑有 Node.js 就能跑）；
2. 把你指定的字体名加进那些字体栈的最前面；
3. 重新打包，自动备份原文件。

**只改「界面 UI 字体」**，代码区/等宽字体不受影响（代码保持等宽，不会变楷体）。

## 前置条件

1. **先安装好你想要的字体**（否则改了也不显示）。下载 `.ttf`/`.otf` 后双击 → 点「安装」即可。
2. 电脑上有 **Node.js**（脚本零依赖，但需要 node 运行时）。没装的话去 <https://nodejs.org> 下载安装。
   - 装了 WorkBuddy 的机器一般也自带了 node，双击 `.bat` 会自动找到，无需手动装。

## 用法

### 方式一：双击运行（最简单）

1. **完全退出 WorkBuddy**（右下角托盘图标右键 → 退出，不是关窗口）。
2. 双击 `patch-font.bat`，按提示输入字体名（例如 `霞鹜文楷` 或 `LXGW WenKai`）。
3. 等窗口显示「替换完成」，重新打开 WorkBuddy 即可。

### 方式二：命令行

```bash
# 换字体
node workbuddy-font-patcher.js "霞鹜文楷"

# 换多个字体（第一个优先，找不到就回退到第二个）
node workbuddy-font-patcher.js "霞鹜文楷, LXGW WenKai"

# 还原为官方默认字体
node workbuddy-font-patcher.js restore
```

（`restore-font.bat` 就是「还原」的一键版。）

## 怎么知道字体名？

装完字体后，在 **Windows 设置 → 个性化 → 字体** 里搜索它，显示的名字就是「字体家族名」。例如：

- 仓耳今楷 → `仓耳今楷03`（或英文 `TsangerJinKai03`）
- 霞鹜文楷 → `LXGW WenKai`
- 思源黑体 → `Source Han Sans SC` / `Noto Sans CJK SC`

## 注意事项

- **必须先完全退出 WorkBuddy 再运行**，否则文件被占用、且要重启才生效。
- **WorkBuddy 升级更新后，字体可能被覆盖回默认**，重新跑一次脚本即可（脚本会自动从原始备份重建，不会残留）。
- 脚本会自动备份原文件（`app.asar.backup`），还原时用 `restore` 即可。
- 只测过 **Windows**。macOS 的安装路径已内置探测，但未经实测；如找不到，欢迎提 issue。

## 文件说明

| 文件 | 作用 |
|---|---|
| `patch-font.bat` | 一键换字体（Windows） |
| `restore-font.bat` | 一键还原默认字体 |
| `workbuddy-font-patcher.js` | 核心脚本（纯 Node，零依赖） |

## 免责声明

本工具通过修改本地安装的程序文件实现，属于非官方手段，仅供个人美化使用。使用前会自动备份，但请知悉：改动程序文件有极小概率导致异常（可随时 `restore` 还原）；WorkBuddy 升级后需重新应用。
