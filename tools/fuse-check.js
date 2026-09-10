#!/usr/bin/env node
/**
 * 检测 Electron 二进制中的 fuse 配置（只读）
 *
 * 用途：判断"改完 app.asar 后应用打不开"是不是官方的 asar 完整性校验导致的。
 *   ★ 新版 WorkBuddy（5.5.x 起）启用了 EnableEmbeddedAsarIntegrityValidation，
 *     启动时拿 app.asar 头部与烧死在 exe 里的哈希比对，不一致直接拒绝启动。
 *     该行为发生在日志系统初始化之前，debug.log 里看不到任何痕迹。
 *
 * 用法：
 *   node fuse-check.js                     自动探测
 *   node fuse-check.js "<exe路径>"          手动指定
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

// Electron fuse 名称顺序（fuse wire v1）
const FUSE_NAMES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
];

// ---------- 自动探测可执行文件 ----------
function findExe() {
  const c = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    const bases = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      path.join(home, 'AppData', 'Local', 'Programs')].filter(Boolean);
    for (const b of bases) {
      for (const app of ['WorkBuddy', 'Tencent CodeBuddy']) c.push(path.join(b, app, app + '.exe'));
    }
  } else if (process.platform === 'darwin') {
    for (const app of ['WorkBuddy', 'Tencent CodeBuddy']) {
      c.push('/Applications/' + app + '.app/Contents/MacOS/' + app);
      c.push(path.join(home, 'Applications', app + '.app', 'Contents', 'MacOS', app));
    }
  } else {
    c.push('/opt/WorkBuddy/workbuddy');
    c.push(path.join(home, '.config', 'WorkBuddy', 'workbuddy'));
  }
  return c.find(p => p && fs.existsSync(p)) || null;
}

const EXE = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : findExe();
if (!EXE || !fs.existsSync(EXE)) {
  console.error('✗ 找不到可执行文件。请手动指定路径：');
  console.error('  node fuse-check.js "C:/path/to/WorkBuddy.exe"');
  process.exit(1);
}

const stat = fs.statSync(EXE);
console.log('可执行文件: ' + EXE);
console.log('大小: ' + (stat.size / 1048576).toFixed(1) + ' MB');

const CHUNK = 8 * 1024 * 1024;
const fd = fs.openSync(EXE, 'r');
let found = -1;
let pos = 0;
const target = Buffer.from(SENTINEL, 'ascii');

while (pos < stat.size) {
  const len = Math.min(CHUNK + target.length, stat.size - pos);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  const idx = buf.indexOf(target);
  if (idx >= 0) { found = pos + idx; break; }
  pos += CHUNK;
}

if (found < 0) {
  console.log('\n❌ 未找到 fuse sentinel —— 该 Electron 未使用 fuse wire');
  console.log('   （较老版本或被打过补丁的二进制）');
  fs.closeSync(fd);
  process.exit(0);
}

console.log('\n✅ 找到 fuse sentinel，偏移: ' + found);

// 读取 sentinel 之后的字节：version(1) + length(1) + fuse data
const meta = Buffer.alloc(2);
fs.readSync(fd, meta, 0, 2, found + SENTINEL.length);
const version = meta[0];
const dataLen = meta[1];
console.log('fuse wire 版本: ' + version);
console.log('fuse 数据长度: ' + dataLen);

const data = Buffer.alloc(dataLen);
fs.readSync(fd, data, 0, dataLen, found + SENTINEL.length + 2);
fs.closeSync(fd);

console.log('fuse 原始字节: ' + data.toString('ascii'));
console.log('\n=== fuse 状态 ===');
let asarIntegrityOn = false;
let onlyLoadFromAsar = false;
for (let i = 0; i < dataLen && i < FUSE_NAMES.length; i++) {
  const c = String.fromCharCode(data[i]);
  let state;
  if (c === '1') state = '启用';
  else if (c === '0') state = '禁用';
  else if (c === 'r') state = '⚠ REMOVED（不可恢复地移除）';
  else if (c === 's') state = '? 静态(未设置)';
  else state = '? 未知 (' + c + ')';
  console.log((i + 1) + '. ' + FUSE_NAMES[i].padEnd(40) + state);
  if (FUSE_NAMES[i] === 'EnableEmbeddedAsarIntegrityValidation' && c === '1') asarIntegrityOn = true;
  if (FUSE_NAMES[i] === 'OnlyLoadAppFromAsar' && c === '1') onlyLoadFromAsar = true;
}

console.log('\n=== 结论 ===');
if (asarIntegrityOn) {
  console.log('❌ 已启用 asar 完整性校验：直接改 app.asar 会被拒绝启动。');
  console.log('   → 用补丁脚本（wb-toolbox.bat / workbuddy-font-patcher.js），');
  console.log('     它会先把该校验关掉再改界面，无需手动处理。');
} else {
  console.log('✅ 未启用 asar 完整性校验：改 asar 可行。');
}
if (onlyLoadFromAsar) console.log('⚠ OnlyLoadAppFromAsar 已启用（正常，不影响改界面）。');
