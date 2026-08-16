#!/usr/bin/env node
/**
 * WorkBuddy 字体补丁工具（通用版）
 * 把 WorkBuddy 桌面端界面字体改成你指定的任意字体（先确保字体已安装到系统）。
 *
 * 用法：
 *   node workbuddy-font-patcher.js "字体名"      换字体（例如：node workbuddy-font-patcher.js "霞鹜文楷"）
 *   node workbuddy-font-patcher.js              不带参数，交互输入字体名
 *   node workbuddy-font-patcher.js restore      还原为官方默认字体
 *
 * 说明：
 *   - 零第三方依赖，纯 Node.js 实现（不需要 npm install）。
 *   - 原理：WorkBuddy 界面字体硬编码在其安装目录的 app.asar 里，本脚本把其中
 *     的字体栈前面加上你指定的字体，再重新打包。
 *   - 必须先完全退出 WorkBuddy 再运行本脚本，否则文件被占用、且要重启才生效。
 *   - 改的是“界面 UI 字体”（正文、对话、侧边栏等）；代码/等宽字体不受影响。
 *   - WorkBuddy 升级更新后字体可能被覆盖，重新跑一次即可。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ==================== 1. 定位 WorkBuddy 的 app.asar ====================
function findAppAsar() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkBuddy', 'resources', 'app.asar'));
    }
    candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'WorkBuddy', 'resources', 'app.asar'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'WorkBuddy', 'resources', 'app.asar'));
    candidates.push('/Applications/WorkBuddy.app/Contents/Resources/app.asar');
  } else {
    candidates.push(path.join(home, '.config', 'WorkBuddy', 'resources', 'app.asar'));
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// ==================== 2. asar 读写（自包含实现，零依赖）====================
// asar 文件格式：
//   [8 字节]  pickle(uint32=4) + pickle(uint32=headerBuf.length)
//   [N 字节]  pickle(JSON header)  =>  uint32(4) + uint32(jsonLen) + json + padding
//   [数据区]  各文件内容
function readAsarHeader(appPath) {
  const fd = fs.openSync(appPath, 'r');
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerBufLen = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(headerBufLen);
  fs.readSync(fd, headerBuf, 0, headerBufLen, 8);
  const jsonLen = headerBuf.readUInt32LE(4);
  const jsonStr = headerBuf.toString('utf8', 8, 8 + jsonLen);
  const header = JSON.parse(jsonStr);
  const dataStart = 8 + headerBufLen;
  return { fd, header, dataStart };
}

function readPackedFile(fd, dataStart, node) {
  const buf = Buffer.alloc(node.size);
  if (node.size > 0) {
    fs.readSync(fd, buf, 0, node.size, dataStart + parseInt(node.offset, 10));
  }
  return buf;
}

function serializeHeader(headerObj) {
  const jsonStr = JSON.stringify(headerObj);
  const jsonLen = Buffer.byteLength(jsonStr, 'utf8');
  const pad = (4 - (jsonLen % 4)) % 4;
  const payloadSize = 4 + jsonLen + pad; // uint32(4) + json + padding
  const headerBuf = Buffer.alloc(4 + payloadSize);
  headerBuf.writeUInt32LE(payloadSize, 0);
  headerBuf.writeUInt32LE(jsonLen, 4);
  headerBuf.write(jsonStr, 8, 'utf8');
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);
  return { sizeBuf, headerBuf };
}

function calcIntegrity(buf) {
  const BLOCK = 4 * 1024 * 1024;
  const fileHash = crypto.createHash('SHA256');
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK) {
    const b = buf.slice(i, i + BLOCK);
    blocks.push(crypto.createHash('SHA256').update(b).digest('hex'));
    fileHash.update(b);
  }
  if (buf.length === 0) blocks.push(crypto.createHash('SHA256').update('').digest('hex'));
  return { algorithm: 'SHA256', hash: fileHash.digest('hex'), blockSize: BLOCK, blocks };
}

function setInHeader(root, filePath, node) {
  const parts = filePath.split('/');
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts[i];
    if (!dir[name]) dir[name] = { files: {} };
    dir = dir[name].files;
  }
  dir[parts[parts.length - 1]] = node;
}

// ==================== 3. 字体补丁规则 ====================
// F 形如：'"霞鹜文楷", "LXGW WenKai", '
function makePatcher(F) {
  return function patchFont(s) {
    s = s.replace(/(--(?:default|vscode)-font-family\s*:\s*)/g, '$1' + F);
    s = s.replace(/(var\(--vscode-font-family,\s*)/g, '$1' + F);
    s = s.replace(/(font-family\s*:\s*)(?="PingFang SC"|'PingFang SC'|PingFang SC|-apple-system|BlinkMacSystemFont|system-ui|"Segoe UI"|'Segoe UI'|Roboto|"Helvetica Neue"|'Helvetica Neue'|sans-serif)/g, '$1' + F);
    return s;
  };
}

// 解析用户输入的字体名 -> CSS 值片段，如 '"霞鹜文楷", "LXGW WenKai", '
function parseFontName(input) {
  const names = String(input).split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('字体名不能为空');
  return names.map(n => '"' + n.replace(/"/g, '') + '"').join(', ') + ', ';
}

// 补丁标记：写进 index.html，用于识别"当前 app.asar 是否已被本工具改过"
// （从而在 WorkBuddy 升级后能正确识别新版本并更新备份，而不是拿旧备份覆盖新版）
const MARK = 'wb-font-patched';

// Claude Warm 配色覆盖（仅 light 主题），追加到 cb-bridge 样式文件末尾
const THEME_MARK = 'wb-claude-theme';
const CLAUDE_THEME_CSS = `
/* ${THEME_MARK} Claude Warm 配色覆盖（仅 light 主题） */
body[data-vscode-theme-name="IDE Light"] {
  --wb-palette-brand-1: #f6ead6;
  --wb-palette-brand-2: #edd9b3;
  --wb-palette-brand-3: #e4c78f;
  --wb-palette-brand-4: #dbb56b;
  --wb-palette-brand-5: #d2a347;
  --wb-palette-brand-7: #c98a2a;
  --wb-palette-brand-8: #b7791f;
  --wb-palette-brand-9: #9f6819;
  --wb-palette-brand-10: #8a5e16;
  --wb-palette-gray-1: #faf9f4;
  --wb-palette-gray-2: #f5f3eb;
  --wb-palette-gray-3: #f0eee6;
  --wb-palette-gray-4: #e9e4d6;
  --wb-palette-gray-5: #ddd7c6;
  --wb-palette-white-100: #f8f7f2;
  --wb-palette-black-100: #49432f;
  --wb-brand-accent: #b7791f;
  --wb-brand-accent-bg: #f6ead6;
  --wb-brand-icon-bg: #f6ead6;
  --wb-brand-primary-subtle: rgba(183, 121, 31, 0.12);
  --wb-brand-primary-deep: #8a5e16;
  --wb-home-bg-primary: #f0eee6;
  --wb-home-bg-secondary: #f8f7f2;
  --wb-sidebar-bg: #f6f5ef;
  --vscode-editor-background: #f8f7f2;
  --vscode-editor-foreground: #49432f;
}
`;

// ==================== 4. 交互输入 ====================
function ask(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ==================== 5. 主流程 ====================
(async function main() {
  const arg = process.argv[2] || '';
  const DRY = arg === 'dry';
  const fontArg = DRY ? (process.argv[3] || '') : arg;

  const target = findAppAsar();
  if (!target) {
    console.error('✗ 没找到 WorkBuddy 的 app.asar，请确认 WorkBuddy 已安装。');
    console.error('  （默认支持 Windows / macOS 标准安装位置）');
    process.exit(1);
  }
  console.log('WorkBuddy 文件:', target);

  const backup = target + '.backup';

  // restore
  if (arg === 'restore') {
    if (!fs.existsSync(backup)) { console.error('✗ 没找到备份文件 ' + backup + '，无法还原。'); process.exit(1); }
    fs.copyFileSync(backup, target);
    console.log('✓ 已还原为官方默认字体，请重新打开 WorkBuddy。');
    process.exit(0);
  }

  // 字体名（可跳过）
  let fontInput = fontArg;
  if (fontInput === undefined || fontInput === '') {
    fontInput = await ask('[1/2] 字体名（直接回车 = 不改字体；要精确，例如：仓耳今楷03 / 霞鹜文楷）：');
  }
  let F = null;
  if (fontInput && fontInput.trim()) {
    try {
      F = parseFontName(fontInput);
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
  }

  // 配色（默认改）
  let doTheme = true;
  const themeAns = await ask('[2/2] 改成 Claude 暖色配色？(y/n，默认 y)：');
  if (themeAns && themeAns.toLowerCase().startsWith('n')) doTheme = false;

  if (!F && !doTheme) { console.log('未选择任何改动，退出。'); process.exit(0); }
  console.log(F ? ('目标字体: ' + F.trim()) : '字体: 不改');
  console.log(doTheme ? '配色: 改为 Claude 暖色' : '配色: 不改');

  // 始终从「当前 app.asar」读，避免 WorkBuddy 升级后从旧备份覆盖回旧版
  const { fd, header, dataStart } = readAsarHeader(target);

  // 仅在首次运行时备份原始文件（backup 不存在时），之后保留这份原始备份用于还原
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(target, backup);
    console.log('✓ 已备份原始文件（用于还原）:', backup);
  }

  // 遍历收集所有文件
  const entries = [];
  (function walk(node, p) {
    if (node.files) { for (const n of Object.keys(node.files)) walk(node.files[n], p + '/' + n); }
    else entries.push({ path: p.replace(/^\//, ''), node });
  })(header, '');

  const patcher = F ? makePatcher(F) : null;
  let patched = 0;
  const packed = [];
  for (const e of entries) {
    if (e.node.unpacked) { packed.push({ path: e.path, unpacked: true, node: e.node }); continue; }
    let buf = readPackedFile(fd, dataStart, e.node);
    let modified = false;
    if (e.path.startsWith('renderer/') && (e.path.endsWith('.css') || e.path.endsWith('.html'))) {
      let s = buf.toString('utf8');
      let s2 = s;
      // 字体补丁
      if (patcher) s2 = patcher(s2);
      // 配色补丁：在 cb-bridge 样式文件末尾追加 Claude 覆盖（先删旧块，保证可更新）
      if (doTheme && e.path.includes('cb-bridge')) {
        const idx = s2.indexOf('/* ' + THEME_MARK);
        if (idx >= 0) s2 = s2.slice(0, idx).replace(/\s+$/, '');
        s2 = s2 + '\n' + CLAUDE_THEME_CSS;
      }
      // 在 index.html 里打字体标记，用于识别"已 patch"状态
      if (e.path === 'renderer/index.html' && !s2.includes(MARK)) {
        s2 = s2.replace('</style>', '/* ' + MARK + ' */</style>');
      }
      if (s2 !== s) { buf = Buffer.from(s2, 'utf8'); modified = true; patched++; }
    }
    packed.push({ path: e.path, buffer: buf, node: e.node, modified });
  }
  fs.closeSync(fd);
  console.log('共 ' + entries.length + ' 个文件，修改 ' + patched + ' 个');
  if (patched === 0) { console.error('✗ 没有做任何修改，可能 WorkBuddy 版本结构有变化。'); process.exit(1); }

  // 重算 offset，构建新 header
  let offset = 0;
  const newHeader = { files: {} };
  for (const f of packed) {
    if (f.unpacked) {
      const nn = { size: f.node.size, unpacked: true };
      if (f.node.integrity) nn.integrity = f.node.integrity;
      setInHeader(newHeader.files, f.path, nn);
    } else {
      const nn = { size: f.buffer.length, offset: String(offset) };
      if (f.modified) nn.integrity = calcIntegrity(f.buffer);
      else if (f.node.integrity) nn.integrity = f.node.integrity;
      setInHeader(newHeader.files, f.path, nn);
      offset += f.buffer.length;
    }
  }

  const { sizeBuf, headerBuf } = serializeHeader(newHeader);
  const newFile = target + '.new';
  const out = fs.createWriteStream(newFile);
  out.write(sizeBuf);
  out.write(headerBuf);
  for (const f of packed) { if (!f.unpacked) out.write(f.buffer); }
  await new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); out.end(); });

  if (DRY) {
    console.log('[dry-run] 仅生成新文件 ' + newFile + '，未替换。');
    return;
  }

  // 首次运行备份原始文件
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(target, backup);
    console.log('✓ 已备份原始文件到:', backup);
  }

  fs.renameSync(newFile, target);
  console.log('✓ 替换完成！请重新打开 WorkBuddy。');
  if (F) console.log('  字体已更换为 ' + F.trim() + '。');
  if (doTheme) console.log('  配色已改为 Claude 暖色。');
  console.log('  如需还原，运行：node workbuddy-font-patcher.js restore');
})().catch(e => { console.error('✗ 出错了：', e); process.exit(1); });
