#!/usr/bin/env node
/**
 * WorkBuddy — Electron asar 完整性校验开关工具
 *
 * 背景：新版 WorkBuddy 在 WorkBuddy.exe 里开启了 Electron 的
 *   EnableEmbeddedAsarIntegrityValidation 这个 fuse（熔断开关）。
 * 开启后，Electron 启动时会把 app.asar 的头部哈希与烧录在 exe 里的值比对，
 * 不一致就拒绝启动 —— 所以只要改了 app.asar（换字体/换配色），程序就打不开。
 *
 * 本工具把该开关关掉（改 exe 里 1 个字节），让改 app.asar 重新可行。
 * Electron 官方也提供同类能力（@electron/fuses），本工具只是把它做成零依赖版本。
 *
 * 用法：
 *   node workbuddy-fuse-tool.js            # 查看状态并询问是否关闭
 *   node workbuddy-fuse-tool.js status     # 只看状态，不改
 *   node workbuddy-fuse-tool.js off        # 关闭校验开关
 *   node workbuddy-fuse-tool.js on         # 恢复官方默认（重新开启校验）
 *   node workbuddy-fuse-tool.js restore    # 用备份还原整个 exe
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

// Electron fuse wire v1 的 fuse 顺序
const FUSES = [
  { name: 'RunAsNode', desc: '允许作为普通 Node 进程运行（ELECTRON_RUN_AS_NODE）' },
  { name: 'EnableCookieEncryption', desc: 'Cookie 落盘加密' },
  { name: 'EnableNodeOptionsEnvironmentVariable', desc: '允许 NODE_OPTIONS 环境变量' },
  { name: 'EnableNodeCliInspectArguments', desc: '允许 --inspect 调试参数' },
  { name: 'EnableEmbeddedAsarIntegrityValidation', desc: '★ app.asar 完整性校验（本工具要关的就是它）' },
  { name: 'OnlyLoadAppFromAsar', desc: '只从 asar 加载应用' },
  { name: 'LoadBrowserProcessSpecificV8Snapshot', desc: '加载专用 V8 快照' },
  { name: 'GrantFileProtocolExtraPrivileges', desc: 'file:// 协议额外权限' },
];

const ASAR_INTEGRITY_INDEX = 4;

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a); }));
}

// ---------- 定位 WorkBuddy.exe ----------
function findExe() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cands = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'));
    cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Tencent CodeBuddy', 'CodeBuddy.exe'));
  }
  cands.push(path.join(home, 'AppData', 'Local', 'Programs', 'WorkBuddy', 'WorkBuddy.exe'));
  if (process.platform === 'darwin') {
    cands.push('/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy');
    cands.push(path.join(home, 'Applications', 'WorkBuddy.app/Contents/MacOS/WorkBuddy'));
  }
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

// ---------- 找到 fuse wire ----------
function findFuseWire(exePath) {
  const fd = fs.openSync(exePath, 'r');
  const size = fs.statSync(exePath).size;
  const CHUNK = 8 * 1024 * 1024;
  const target = Buffer.from(SENTINEL, 'ascii');
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

function readFuses(exePath, wireOffset) {
  const fd = fs.openSync(exePath, 'r');
  try {
    const meta = Buffer.alloc(2);
    fs.readSync(fd, meta, 0, 2, wireOffset + SENTINEL.length);
    const dataLen = meta[1];
    const data = Buffer.alloc(dataLen);
    fs.readSync(fd, data, 0, dataLen, wireOffset + SENTINEL.length + 2);
    return { version: meta[0], data };
  } finally { fs.closeSync(fd); }
}

function fuseState(ch) {
  if (ch === '1') return '启用';
  if (ch === '0') return '禁用';
  if (ch === 'r') return '已移除';
  return '未知(' + ch + ')';
}

// ---------- 主流程 ----------
(async () => {
  const arg = (process.argv[2] || '').toLowerCase();

  const exe = findExe();
  if (!exe) {
    console.error('✗ 没找到 WorkBuddy.exe，请确认 WorkBuddy 已安装。');
    process.exit(1);
  }
  const backup = exe + '.backup';

  console.log('WorkBuddy 校验开关工具');
  console.log('----------------------------------------');
  console.log('程序文件: ' + exe);
  console.log('文件大小: ' + (fs.statSync(exe).size / 1048576).toFixed(1) + ' MB');

  const wire = findFuseWire(exe);
  if (wire < 0) {
    console.log('\n✅ 该版本未使用 fuse wire —— 不存在 asar 完整性校验，无需处理。');
    process.exit(0);
  }

  const { version, data } = readFuses(exe, wire);
  const dataOff = wire + SENTINEL.length + 2;

  console.log('fuse wire: 偏移 ' + wire + '，版本 ' + version);
  console.log('\n===== 开关状态 =====');
  for (let i = 0; i < data.length && i < FUSES.length; i++) {
    const st = fuseState(String.fromCharCode(data[i]));
    const mark = FUSES[i].name === 'EnableEmbeddedAsarIntegrityValidation' ? '★ ' : '  ';
    console.log(mark + (i + 1) + '. ' + FUSES[i].name.padEnd(38) + st);
  }

  const curCh = String.fromCharCode(data[ASAR_INTEGRITY_INDEX]);
  const isOn = curCh === '1';
  console.log('----------------------------------------');
  console.log('asar 完整性校验: ' + (isOn
    ? '已启用 → 改 app.asar 会导致 WorkBuddy 无法启动'
    : '已关闭 → 可以安全修改 app.asar（换字体/换配色）'));

  // ---------- restore ----------
  if (arg === 'restore') {
    if (!fs.existsSync(backup)) { console.error('\n✗ 没有找到 exe 备份：' + backup); process.exit(1); }
    const ok = await ask('\n确定用备份还原 WorkBuddy.exe 吗？(y/n)：');
    if (!ok || !ok.toLowerCase().startsWith('y')) { console.log('已取消。'); process.exit(0); }
    fs.copyFileSync(backup, exe);
    console.log('✓ 已还原 WorkBuddy.exe。请重新打开 WorkBuddy。');
    process.exit(0);
  }

  // ---------- status ----------
  if (arg === 'status') {
    console.log('\nexe 备份: ' + (fs.existsSync(backup) ? '✅ 存在（' + (fs.statSync(backup).size / 1048576).toFixed(1) + ' MB）' : '❌ 不存在'));
    process.exit(0);
  }

  // ---------- 决定要设置成什么 ----------
  let want; // '0' 或 '1'
  if (arg === 'off') want = '0';
  else if (arg === 'on') want = '1';
  else {
    if (isOn) {
      const a = await ask('\n是否关闭 asar 完整性校验（这样就可以改字体和配色了）？(y/n，默认 y)：');
      if (a && a.toLowerCase().startsWith('n')) { console.log('已取消，未做任何修改。'); process.exit(0); }
      want = '0';
    } else {
      const a = await ask('\n校验已经是关闭状态。是否恢复官方默认（重新开启校验）？(y/n，默认 n)：');
      if (!a || !a.toLowerCase().startsWith('y')) { console.log('未做任何修改。'); process.exit(0); }
      want = '1';
    }
  }

  if (String.fromCharCode(data[ASAR_INTEGRITY_INDEX]) === want) {
    console.log('\n已经是目标状态，无需修改。');
    process.exit(0);
  }

  // ---------- 备份 exe ----------
  if (!fs.existsSync(backup)) {
    console.log('\n正在备份 WorkBuddy.exe（约 195 MB，请稍候）...');
    fs.copyFileSync(exe, backup);
    console.log('✓ 已备份 → ' + backup);
  } else {
    console.log('\n· exe 备份已存在，跳过备份。');
  }

  // ---------- 写入 ----------
  const targetOff = dataOff + ASAR_INTEGRITY_INDEX;
  try {
    const rw = fs.openSync(exe, 'r+');
    try {
      fs.writeSync(rw, Buffer.from([want.charCodeAt(0)]), 0, 1, targetOff);
    } finally { fs.closeSync(rw); }
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      console.error('\n✗ 写入失败：WorkBuddy.exe 正在被占用。');
      console.error('  请【完全退出 WorkBuddy】（右下角托盘图标右键 → 退出，不是关窗口），然后重新运行。');
      process.exit(1);
    }
    throw e;
  }

  // ---------- 回读确认 ----------
  const { data: after } = readFuses(exe, wire);
  const newCh = String.fromCharCode(after[ASAR_INTEGRITY_INDEX]);

  console.log('\n----------------------------------------');
  if (newCh === want) {
    if (want === '0') {
      console.log('✓ 已关闭 asar 完整性校验。');
      console.log('\n请重新打开 WorkBuddy，确认能正常启动。');
      console.log('确认没问题后，再运行「改字体.bat」换字体和配色。');
      console.log('\n如需恢复官方默认（重新开启校验）：运行 node workbuddy-fuse-tool.js on');
    } else {
      console.log('✓ 已恢复官方默认（重新开启 asar 完整性校验）。');
      console.log('  注意：如果此时 app.asar 已被改过，WorkBuddy 将无法启动，请先还原 app.asar。');
    }
  } else {
    console.error('✗ 写入后回读不一致（期望 ' + want + '，实际 ' + newCh + '），请检查。');
    process.exit(1);
  }
})().catch(e => { console.error('✗ 出错了：', e); process.exit(1); });
