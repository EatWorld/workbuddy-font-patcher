// 检测 Electron 二进制中的 fuse 配置（只读）
const fs = require('fs');

const EXE = 'C:/Users/94493/AppData/Local/Programs/WorkBuddy/WorkBuddy.exe';
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

const stat = fs.statSync(EXE);
console.log('WorkBuddy.exe 大小: ' + (stat.size / 1048576).toFixed(1) + ' MB');

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
  if (c === '1') state = '✅ 启用 (enabled)';
  else if (c === '0') state = '— 禁用 (disabled)';
  else if (c === 'r') state = '⚠ REMOVED（不可恢复地移除）';
  else if (c === 's') state = '? 静态(未设置)';
  else state = '? 未知 (' + c + ')';
  console.log((i + 1) + '. ' + FUSE_NAMES[i].padEnd(40) + state);
  if (FUSE_NAMES[i] === 'EnableEmbeddedAsarIntegrityValidation' && c === '1') asarIntegrityOn = true;
  if (FUSE_NAMES[i] === 'OnlyLoadAppFromAsar' && c === '1') onlyLoadFromAsar = true;
}

console.log('\n=== 结论 ===');
if (asarIntegrityOn) {
  console.log('❌ 已启用 asar 完整性校验：任何对 app.asar 的修改都会导致启动被拒。');
  console.log('   → 改 asar 这条路在新版上彻底不可行，必须换方案。');
} else {
  console.log('✅ 未启用 asar 完整性校验：改 asar 理论上可行。');
}
if (onlyLoadFromAsar) console.log('⚠ OnlyLoadAppFromAsar 已启用（正常，不影响）。');
