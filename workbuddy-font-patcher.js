#!/usr/bin/env node
/**
 * WorkBuddy 字体 & 配色补丁工具（通用版 v3.0）
 * 把 WorkBuddy 桌面端界面字体改成你指定的任意字体，并可切换为 Claude 暖色配色。
 * （先确保字体已安装到系统）
 *
 * 用法：
 *   node workbuddy-font-patcher.js "字体名"      换字体 + 配色（例如：node workbuddy-font-patcher.js "仓耳今楷03"）
 *   node workbuddy-font-patcher.js              不带参数，交互输入
 *   node workbuddy-font-patcher.js check        只体检，不做任何修改
 *   node workbuddy-font-patcher.js restore      总还原（asar + exe + 校验开关全部恢复官方原样）
 *   node workbuddy-font-patcher.js auto         更新后一键恢复（用记住的设置，无交互）
 *   node workbuddy-font-patcher.js dry "字体名"  试运行，生成新文件但不替换
 *
 * 说明：
 *   - 零第三方依赖，纯 Node.js 实现（不需要 npm install）。
 *   - 原理：WorkBuddy 界面字体/配色硬编码在其安装目录的 app.asar 里，本脚本把其中
 *     的字体栈前面加上你指定的字体，并在设计 token 文件末尾追加配色覆盖，再重新打包。
 *   - 必须先完全退出 WorkBuddy 再运行本脚本，否则文件被占用、且要重启才生效。
 *   - 改的是"界面 UI 字体"（正文、对话、侧边栏等）；代码/等宽字体不受影响。
 *   - WorkBuddy 升级更新后修改会被覆盖，重新跑一次即可。
 *
 * v3.0 变更（适配 5.5.x，解决"改完打不开"）：
 *   - 官方在 WorkBuddy.exe 里开启了 Electron 的 asar 完整性校验（EnableEmbeddedAsarIntegrityValidation），
 *     改 app.asar 会被拒绝启动。主流程现在会先检测并自动关闭该开关（改 exe 里 1 个字节），
 *     改界面前自动备份 exe。
 *   - restore 升级为"总还原"：app.asar + WorkBuddy.exe + 校验开关，一次全部恢复官方原样。
 *   - 新增 auto 模式：记住上次的字体名/配色选择，更新后无交互一键恢复。
 *   - 记住用户选择存到配置文件，重复运行默认沿用上次选择。
 *
 * v2.0 变更（适配新版 WorkBuddy）：
 *   - 配色挂载点不再认文件名（旧版 cb-bridge 文件已被官方移除），改为按内容特征
 *     自动识别设计 token 主文件，官方改文件名也不会失效。
 *   - 配色变量加 !important，防止官方调整 CSS 加载顺序导致失效。
 *   - 重复运行不再叠加字体名（自动以原始备份为基底重新生成）。
 *   - WorkBuddy 升级后自动刷新备份，避免"还原"退回旧版本。
 *   - 新增 check 体检模式。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VERSION = '3.0';

// ==================== 1. 定位 WorkBuddy 的 app.asar ====================
function findAppAsar() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkBuddy', 'resources', 'app.asar'));
    }
    candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'WorkBuddy', 'resources', 'app.asar'));
    candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'Tencent CodeBuddy', 'resources', 'app.asar'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/WorkBuddy.app/Contents/Resources/app.asar');
    candidates.push(path.join(home, 'Applications', 'WorkBuddy.app', 'Contents', 'Resources', 'app.asar'));
  } else {
    candidates.push(path.join(home, '.config', 'WorkBuddy', 'resources', 'app.asar'));
    candidates.push('/opt/WorkBuddy/resources/app.asar');
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// 由 app.asar 路径反推 WorkBuddy.exe 路径（resources 的上一级）
function findExeFromAsar(asarPath) {
  const dir = path.dirname(asarPath);           // .../WorkBuddy/resources
  const root = path.dirname(dir);               // .../WorkBuddy
  const name = path.basename(root);
  for (const exeName of [name + '.exe', 'WorkBuddy.exe', 'CodeBuddy.exe']) {
    const p = path.join(root, exeName);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ==================== 1b. Electron fuse（asar 完整性校验开关）====================
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const FUSE_ASAR_INTEGRITY_INDEX = 4;   // EnableEmbeddedAsarIntegrityValidation

function findFuseWire(exePath) {
  const fd = fs.openSync(exePath, 'r');
  const size = fs.statSync(exePath).size;
  const CHUNK = 8 * 1024 * 1024;
  const target = Buffer.from(FUSE_SENTINEL, 'ascii');
  let found = -1, pos = 0;
  try {
    while (pos < size) {
      const len = Math.min(CHUNK + target.length, size - pos);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      const i = buf.indexOf(target);
      if (i >= 0) { found = pos + i; break; }
      pos += CHUNK;
    }
  } finally { fs.closeSync(fd); }
  return found;
}

// 返回 true = 校验开启（改 asar 会打不开）；false = 已关闭；null = 无 fuse wire
function isAsarIntegrityOn(exePath) {
  try {
    const wire = findFuseWire(exePath);
    if (wire < 0) return null;
    const fd = fs.openSync(exePath, 'r');
    let ch;
    try {
      const meta = Buffer.alloc(2);
      fs.readSync(fd, meta, 0, 2, wire + FUSE_SENTINEL.length);
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, wire + FUSE_SENTINEL.length + 2 + FUSE_ASAR_INTEGRITY_INDEX);
      ch = String.fromCharCode(b[0]);
    } finally { fs.closeSync(fd); }
    return ch === '1';
  } catch (e) { return null; }
}

// ==================== 1c. 配置记忆（更新后一键恢复）====================
function configFile() {
  return path.join(__dirname, 'font-patcher-config.json');
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); }
  catch (e) { return {}; }
}
function saveConfig(obj) {
  try {
    fs.writeFileSync(configFile(), JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { /* 配置文件写不了不影响主流程 */ }
}

// ==================== 2. asar 读写（自包含实现，零依赖）====================
// asar 文件格式：
//   [8 字节]  pickle(uint32=4) + pickle(uint32=headerBuf.length)
//   [N 字节]  pickle(JSON header)  =>  uint32(4) + uint32(jsonLen) + json + padding
//   [数据区]  各文件内容
function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerBufLen = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(headerBufLen);
  fs.readSync(fd, headerBuf, 0, headerBufLen, 8);
  const jsonLen = headerBuf.readUInt32LE(4);
  const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLen));
  return { file, fd, header, dataStart: 8 + headerBufLen };
}

function closeAsar(h) { try { fs.closeSync(h.fd); } catch (e) { /* ignore */ } }

function listEntries(h) {
  const out = [];
  (function walk(node, p) {
    if (node.files) { for (const n of Object.keys(node.files)) walk(node.files[n], p + '/' + n); }
    else out.push({ path: p.replace(/^\//, ''), node });
  })(h.header, '');
  return out;
}

function readEntry(h, node) {
  if (node.unpacked) return null;
  const buf = Buffer.alloc(node.size);
  if (node.size > 0) fs.readSync(h.fd, buf, 0, node.size, h.dataStart + parseInt(node.offset, 10));
  return buf;
}

function serializeHeader(headerObj) {
  const jsonStr = JSON.stringify(headerObj);
  const jsonLen = Buffer.byteLength(jsonStr, 'utf8');
  const pad = (4 - (jsonLen % 4)) % 4;
  const payloadSize = 4 + jsonLen + pad;
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
// F 形如：'"仓耳今楷03", '
function makePatcher(F) {
  return function patchFont(s) {
    s = s.replace(/(--(?:default|vscode)-font-family\s*:\s*)/g, '$1' + F);
    s = s.replace(/(var\(--vscode-font-family,\s*)/g, '$1' + F);
    s = s.replace(/(font-family\s*:\s*)(?="PingFang SC"|'PingFang SC'|PingFang SC|-apple-system|BlinkMacSystemFont|system-ui|"Segoe UI"|'Segoe UI'|Roboto|"Helvetica Neue"|'Helvetica Neue'|sans-serif)/g, '$1' + F);
    return s;
  };
}

function parseFontName(input) {
  const names = String(input).split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('字体名不能为空');
  return names.map(n => '"' + n.replace(/"/g, '') + '"').join(', ') + ', ';
}

// 补丁标记：写进 index.html，用于识别"当前 app.asar 是否已被本工具改过"
const MARK = 'wb-font-patched';
const THEME_MARK = 'wb-claude-theme';

// ==================== 4. Claude Warm 配色 ====================
// 说明：
//   - 用 !important 保证生效，不受官方 CSS 加载顺序变化影响。
//   - 只在 light 主题（body[data-vscode-theme-name="IDE Light"]）下生效，dark 主题不受影响。
//   - 追加到"设计 token 主文件"末尾（该文件由内容特征自动识别，见 isTokenCss）。
const CLAUDE_THEME_CSS = `
/* ${THEME_MARK} Claude Warm 配色覆盖（仅 light 主题，由 workbuddy-font-patcher 注入） */
body[data-vscode-theme-name="IDE Light"] {
  --wb-palette-brand-1: #f6ead6 !important;
  --wb-palette-brand-2: #edd9b3 !important;
  --wb-palette-brand-3: #e4c78f !important;
  --wb-palette-brand-4: #dbb56b !important;
  --wb-palette-brand-5: #d2a347 !important;
  --wb-palette-brand-7: #c98a2a !important;
  --wb-palette-brand-8: #b7791f !important;
  --wb-palette-brand-9: #9f6819 !important;
  --wb-palette-brand-10: #8a5e16 !important;
  --wb-palette-gray-1: #faf9f4 !important;
  --wb-palette-gray-2: #f5f3eb !important;
  --wb-palette-gray-3: #f0eee6 !important;
  --wb-palette-gray-4: #e9e4d6 !important;
  --wb-palette-gray-5: #ddd7c6 !important;
  --wb-palette-white-100: #f8f7f2 !important;
  --wb-palette-black-100: #49432f !important;
  --wb-brand-accent: #b7791f !important;
  --wb-brand-accent-bg: #f6ead6 !important;
  --wb-brand-icon-bg: #f6ead6 !important;
  --wb-brand-primary-subtle: rgba(183, 121, 31, 0.12) !important;
  --wb-brand-primary-deep: #8a5e16 !important;
  --wb-home-bg-primary: #f0eee6 !important;
  --wb-home-bg-secondary: #f8f7f2 !important;
  --wb-sidebar-bg: #f6f5ef !important;
  --vscode-editor-background: #f8f7f2 !important;
  --vscode-editor-foreground: #49432f !important;
}
`;

/**
 * 判断一个 CSS 文件是不是"设计 token 主文件"。
 * 认内容不认文件名 —— 官方每次构建都会给 CSS 加 hash 后缀（如 xxx-Cb4BnJzK.css），
 * 硬编码文件名必然失效。
 */
function isTokenCss(filePath, content) {
  return /^renderer\/assets\/.*\.css$/.test(filePath) && /--wb-palette-brand-8\s*:/.test(content);
}

// ==================== 5. 检测当前 asar 是否已被本工具打过补丁 ====================
function detectPatched(h, entries) {
  const found = { font: false, theme: [], tokenFile: [] };
  const ih = entries.find(e => e.path === 'renderer/index.html');
  if (ih) {
    const b = readEntry(h, ih.node);
    if (b && b.toString('utf8').includes(MARK)) found.font = true;
  }
  for (const e of entries) {
    if (!/^renderer\/assets\/.*\.css$/.test(e.path)) continue;
    const b = readEntry(h, e.node);
    if (!b) continue;
    const s = b.toString('utf8');
    if (isTokenCss(e.path, s)) found.tokenFile.push(e.path);
    if (s.includes(THEME_MARK)) found.theme.push(e.path);
  }
  return found;
}

// ==================== 6. 交互输入 ====================
function ask(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ==================== 7. 主流程 ====================
(async function main() {
  const arg = process.argv[2] || '';
  const DRY = arg === 'dry';
  const fontArg = DRY ? (process.argv[3] || '') : arg;

  console.log('WorkBuddy 字体 & 配色补丁工具 v' + VERSION);
  console.log('----------------------------------------');

  const target = findAppAsar();
  if (!target) {
    console.error('✗ 没找到 WorkBuddy 的 app.asar，请确认 WorkBuddy 已安装。');
    process.exit(1);
  }
  console.log('程序文件:', target);

  const backup = target + '.backup';

  // ---------- restore：总还原（asar + exe + 校验开关，全部回到官方原样）----------
  if (arg === 'restore' || arg === 'restore-all') {
    const FORCE = process.argv.includes('--force') || process.argv.includes('-y');
    const exePath = findExeFromAsar(target);
    const exeBackup = exePath ? exePath + '.backup' : null;

    console.log('\n===== 总还原 =====');
    console.log('将把 WorkBuddy 恢复成官方原样：');
    console.log('  1) 界面字体 / 配色  → 官方默认');
    if (exeBackup && fs.existsSync(exeBackup)) {
      console.log('  2) WorkBuddy.exe   → 官方原版（asar 校验开关恢复开启）');
    } else {
      console.log('  2) WorkBuddy.exe   → 无需还原（没有 exe 备份，说明没改过）');
    }
    console.log('');

    if (!FORCE) {
      const ok = await ask('确定还原吗？(y/n)：');
      if (!ok || !ok.toLowerCase().startsWith('y')) { console.log('已取消，未做任何修改。'); process.exit(0); }
    }

    // 1) 还原 app.asar
    if (!fs.existsSync(backup)) {
      console.error('\n✗ 没找到 asar 备份 ' + backup + '，无法还原界面。');
      console.error('  如果 WorkBuddy 已经打不开，建议直接重装 WorkBuddy。');
      process.exit(1);
    }
    try {
      fs.copyFileSync(backup, target);
      console.log('✓ 界面已还原为官方默认（字体 / 配色）');
    } catch (e) {
      console.error('✗ 还原 app.asar 失败: ' + e.code + ' - ' + e.message);
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        console.error('  请【完全退出 WorkBuddy】后重试（右下角托盘图标右键 → 退出）。');
      }
      process.exit(1);
    }

    // 2) 还原 WorkBuddy.exe（把 asar 校验开关恢复成官方原样）
    if (exeBackup && fs.existsSync(exeBackup)) {
      try {
        fs.copyFileSync(exeBackup, exePath);
        console.log('✓ WorkBuddy.exe 已还原为官方原版');
      } catch (e) {
        console.error('✗ 还原 WorkBuddy.exe 失败: ' + e.code + ' - ' + e.message);
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
          console.error('  ⚠ 程序文件被占用，请【完全退出 WorkBuddy】后重新运行本还原。');
          console.error('    界面已还原，但 exe 还是改过的状态。');
        }
        process.exit(1);
      }
    }

    // 3) 清理配置里记住的选择，避免下次一键恢复又改回去
    try {
      const cfg = loadConfig();
      if (cfg.font || cfg.theme) {
        delete cfg.font; delete cfg.theme;
        saveConfig(cfg);
        console.log('✓ 已清除记住的字体 / 配色设置');
      }
    } catch (e) { /* 忽略 */ }

    console.log('\n✓ 全部还原完成，现在 WorkBuddy 是 100% 官方原版状态。');
    console.log('  请重新打开 WorkBuddy。');
    process.exit(0);
  }

  // ---------- 打开当前 asar，体检 ----------
  const cur = openAsar(target);
  const curEntries = listEntries(cur);
  const stat = detectPatched(cur, curEntries);

  // ---------- check 模式 ----------
  if (arg === 'check') {
    console.log('\n===== 体检结果 =====');
    console.log('asar 大小      : ' + (fs.statSync(target).size / 1048576).toFixed(1) + ' MB');
    console.log('文件总数       : ' + curEntries.length);
    console.log('token 主文件   : ' + (stat.tokenFile.length ? stat.tokenFile.join(', ') : '❌ 未找到（配色会失效）'));
    console.log('字体补丁状态   : ' + (stat.font ? '✅ 已打补丁' : '— 未打补丁（官方原版）'));
    console.log('配色补丁状态   : ' + (stat.theme.length ? '✅ 已打补丁 → ' + stat.theme.join(', ') : '— 未打补丁（官方原版）'));
    console.log('备份文件       : ' + (fs.existsSync(backup) ? '✅ 存在' : '❌ 不存在'));
    const exeC = findExeFromAsar(target);
    const fuseOn = exeC ? isAsarIntegrityOn(exeC) : null;
    console.log('asar 校验开关  : ' + (fuseOn === null ? '— 未检测到（无需处理）'
      : (fuseOn ? '❌ 开启中 → 改界面会导致打不开，需先关闭'
                : '✅ 已关闭 → 可以安全修改界面')));
    if (exeC) console.log('exe 备份       : ' + (fs.existsSync(exeC + '.backup') ? '✅ 存在' : '— 未备份'));
    closeAsar(cur);
    process.exit(0);
  }

  // ---------- 模式判断 ----------
  const AUTO = arg === 'auto' || arg === 'restore-config'; // 无交互，直接用记住的配置
  const cfg = loadConfig();

  // ---------- 交互：字体名 ----------
  let fontInput = fontArg;
  if (AUTO) {
    fontInput = cfg.font || '';
    console.log('[自动模式] 字体: ' + (fontInput || '不改'));
    if (!fontInput && !cfg.theme) {
      console.error('\n✗ 没有记住任何设置。请先运行「改字体.bat」设置一次。');
      closeAsar(cur); process.exit(1);
    }
  }
  if (fontInput === undefined || fontInput === '') {
    const hint = cfg.font ? '（直接回车 = 用上次的「' + cfg.font + '」）' : '（直接回车 = 不改字体）';
    fontInput = await ask('[1/2] 字体名' + hint + '：');
    if (!fontInput.trim() && cfg.font) fontInput = cfg.font;
  }
  let F = null;
  if (fontInput && fontInput.trim()) {
    try { F = parseFontName(fontInput); }
    catch (e) { console.error('✗ ' + e.message); closeAsar(cur); process.exit(1); }
  }

  // ---------- 交互：配色 ----------
  let doTheme;
  if (AUTO) {
    doTheme = cfg.theme !== false;
    console.log('[自动模式] 配色: ' + (doTheme ? 'Claude 暖色' : '不改'));
  } else {
    const tHint = cfg.theme === false ? '，直接回车 = 不改' : '，直接回车 = 改';
    const themeAns = await ask('[2/2] 改成 Claude 暖色配色？(y/n' + tHint + ')：');
    if (themeAns && themeAns.trim()) doTheme = !themeAns.toLowerCase().startsWith('n');
    else doTheme = cfg.theme !== false;
  }

  console.log('----------------------------------------');
  console.log(F ? ('字体: ' + F.trim()) : '字体: 不改');
  console.log(doTheme ? '配色: 改为 Claude 暖色' : '配色: 不改');
  if (!F && !doTheme) { console.log('未选择任何改动，退出。'); closeAsar(cur); process.exit(0); }

  // ---------- 检查 / 关闭 asar 完整性校验开关 ----------
  // 新版 WorkBuddy 在 exe 里开了 Electron 的 EnableEmbeddedAsarIntegrityValidation，
  // 开启时改 app.asar 会导致启动被拒，必须先关掉（改 exe 里 1 个字节）。
  const exePath = findExeFromAsar(target);
  if (exePath) {
    const fuseOn = isAsarIntegrityOn(exePath);
    if (fuseOn === true) {
      console.log('----------------------------------------');
      console.log('⚠ 检测到 WorkBuddy 开启了 asar 完整性校验。');
      console.log('  不动这个开关的话，改完界面 WorkBuddy 会打不开（这是上次打不开的原因）。');
      const exeBackup = exePath + '.backup';
      if (!fs.existsSync(exeBackup)) {
        console.log('  正在备份 WorkBuddy.exe（约 195 MB，请稍候）...');
        try { fs.copyFileSync(exePath, exeBackup); console.log('  ✓ 已备份 → ' + exeBackup); }
        catch (e) {
          console.error('  ✗ 备份 exe 失败: ' + e.message);
          console.error('  未做任何修改，你的 WorkBuddy 是安全的。');
          closeAsar(cur); process.exit(1);
        }
      } else {
        console.log('  · exe 备份已存在，跳过备份。');
      }
      const wire = findFuseWire(exePath);
      const byteOff = wire + FUSE_SENTINEL.length + 2 + FUSE_ASAR_INTEGRITY_INDEX;
      try {
        const rw = fs.openSync(exePath, 'r+');
        try { fs.writeSync(rw, Buffer.from([0x30]), 0, 1, byteOff); } finally { fs.closeSync(rw); }
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
          console.error('\n✗ 无法修改 WorkBuddy.exe：文件被占用。');
          console.error('  请【完全退出 WorkBuddy】（右下角托盘图标右键 → 退出，不是关窗口），');
          console.error('  然后重新运行本脚本。');
          console.error('  未做任何修改，你的 WorkBuddy 现在是安全的。');
          closeAsar(cur); process.exit(1);
        }
        throw e;
      }
      if (isAsarIntegrityOn(exePath)) {
        console.error('✗ 关闭校验开关失败（回读仍为开启）。未改 asar，你的 WorkBuddy 是安全的。');
        closeAsar(cur); process.exit(1);
      }
      console.log('  ✓ 校验开关已关闭。');
    } else if (fuseOn === false) {
      console.log('· asar 校验开关已是关闭状态，可以直接修改界面。');
    }
  }

  // ---------- 决定基底：已打补丁就以备份为基底，避免重复叠加 ----------
  let base;
  if (stat.font || stat.theme.length) {
    if (fs.existsSync(backup)) {
      console.log('· 检测到已打过补丁 → 以原始备份为基底重新生成（不会重复叠加）');
      base = openAsar(backup);
      closeAsar(cur);
    } else {
      console.log('⚠ 检测到已打过补丁，但备份文件不存在。');
      console.log('  将基于当前文件修改，字体名可能重复叠加。建议先还原或重装 WorkBuddy。');
      base = cur;
    }
  } else {
    // 官方原版（可能是刚升级的新版）→ 刷新备份
    fs.copyFileSync(target, backup);
    console.log('✓ 已备份当前原始文件 → ' + backup);
    base = cur;
  }

  const entries = listEntries(base);
  const patcher = F ? makePatcher(F) : null;

  let fontPatched = 0, themePatched = 0, totalModified = 0;
  const themeTargets = [];
  const packed = [];

  for (const e of entries) {
    if (e.node.unpacked) { packed.push({ path: e.path, unpacked: true, node: e.node }); continue; }
    let buf = readEntry(base, e.node);
    let modified = false;

    const isUI = e.path.startsWith('renderer/') && (e.path.endsWith('.css') || e.path.endsWith('.html'));
    if (isUI) {
      const s = buf.toString('utf8');
      let s2 = s;

      // 字体补丁
      if (patcher) s2 = patcher(s2);

      // 配色补丁：追加到设计 token 主文件末尾（先删旧块，保证可重复更新）
      if (doTheme && isTokenCss(e.path, s2)) {
        const idx = s2.indexOf('/* ' + THEME_MARK);
        if (idx >= 0) s2 = s2.slice(0, idx).replace(/\s+$/, '');
        s2 = s2 + '\n' + CLAUDE_THEME_CSS;
        themePatched++;
        themeTargets.push(e.path);
        modified = true;
      }

      // index.html 里打标记，用于识别"已 patch"状态
      if (e.path === 'renderer/index.html' && !s2.includes(MARK)) {
        s2 = s2.replace('</style>', '/* ' + MARK + ' */</style>');
      }

      if (s2 !== s) {
        if (!modified) { modified = true; }
        if (patcher) fontPatched++;
        buf = Buffer.from(s2, 'utf8');
      }
    }
    if (modified) totalModified++;
    packed.push({ path: e.path, buffer: buf, node: e.node, modified });
  }
  closeAsar(base);

  console.log('----------------------------------------');
  console.log('共 ' + entries.length + ' 个文件');
  if (F) console.log('字体已修改: ' + fontPatched + ' 个文件');
  if (doTheme) console.log('配色挂载点: ' + (themeTargets.length ? themeTargets.join(', ') : '❌ 未找到'));

  if (fontPatched === 0 && themePatched === 0) {
    console.error('\n✗ 没有做任何修改。');
    if (F) console.error('  字体规则没命中 → WorkBuddy 的 UI 结构可能又变了。');
    if (doTheme) console.error('  没找到设计 token 文件（含 --wb-palette-brand-8 定义的 CSS）→ 配色挂载点又变了。');
    console.error('  请把上面的信息反馈给脚本作者，或运行 check 模式查看体检结果。');
    process.exit(1);
  }

  // ---------- 重算 offset，构建新 header ----------
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
    console.log('\n[dry-run] 仅生成 ' + newFile + '，未替换（可手动删除该文件）。');
    return;
  }

  fs.renameSync(newFile, target);

  // 记住这次的选择，WorkBuddy 更新后可一键恢复
  saveConfig({
    font: F ? fontInput.trim() : '',
    theme: doTheme,
    savedAt: new Date().toISOString(),
  });

  console.log('\n✓ 替换完成！请重新打开 WorkBuddy。');
  if (F) console.log('  字体已更换为 ' + F.trim() + '。');
  if (doTheme) console.log('  配色已改为 Claude 暖色。');
  console.log('  设置已记住。以后 WorkBuddy 更新后，双击「一键恢复.bat」即可全部恢复。');
  console.log('  如需还原，运行：node workbuddy-font-patcher.js restore');
  console.log('  如需体检，运行：node workbuddy-font-patcher.js check');
})().catch(e => { console.error('✗ 出错了：', e); process.exit(1); });
