#!/usr/bin/env node
/**
 * Electron asar 打包应用的 UI 主题诊断器
 * 用于排查"界面字体/配色补丁在应用升级后失效"这类问题。
 *
 * 用法：
 *   node asar-probe.js <asar路径> [--auto]
 *   例：node asar-probe.js "C:/Users/94493/AppData/Local/Programs/WorkBuddy/resources/app.asar"
 *
 * 不传路径时，自动探测常见 Electron 应用（WorkBuddy / CodeBuddy）的 app.asar。
 *
 * 输出：
 *   1. asar 概况（体积、文件数、unpacked 数）
 *   2. 设计 token 主文件定位（配色挂载点）
 *   3. 字体变量定义位置
 *   4. 主题选择器与 CSS 加载顺序
 *   5. 补丁状态检测
 *
 * 只读，不修改任何文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 自动探测 app.asar ----------
function findAppAsar() {
  const c = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      for (const app of ['WorkBuddy', 'Tencent CodeBuddy']) {
        c.push(path.join(process.env.LOCALAPPDATA, 'Programs', app, 'resources', 'app.asar'));
      }
    }
    for (const app of ['WorkBuddy', 'Tencent CodeBuddy']) {
      c.push(path.join(home, 'AppData', 'Local', 'Programs', app, 'resources', 'app.asar'));
    }
  } else if (process.platform === 'darwin') {
    for (const app of ['WorkBuddy', 'Tencent CodeBuddy']) {
      c.push('/Applications/' + app + '.app/Contents/Resources/app.asar');
      c.push(path.join(home, 'Applications', app + '.app', 'Contents', 'Resources', 'app.asar'));
    }
  } else {
    c.push('/opt/WorkBuddy/resources/app.asar');
    c.push(path.join(home, '.config', 'WorkBuddy', 'resources', 'app.asar'));
  }
  return c.find(p => p && fs.existsSync(p)) || null;
}

// ---------- asar 读取（零依赖）----------
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

// ---------- 主流程 ----------
const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : findAppAsar();
if (!target || !fs.existsSync(target)) {
  console.error('✗ 找不到 app.asar。请手动指定路径：');
  console.error('  node asar-probe.js "C:/path/to/app.asar"');
  process.exit(1);
}

const size = fs.statSync(target).size;
console.log('asar: ' + target);
console.log('体积: ' + (size / 1048576).toFixed(1) + ' MB');
console.log(''.padEnd(64, '='));

const h = openAsar(target);
const entries = listEntries(h);
const cache = {};
const gc = fp => {
  if (!(fp in cache)) {
    const e = entries.find(x => x.path === fp);
    const b = e ? readEntry(h, e.node) : null;
    cache[fp] = b ? b.toString('utf8') : '';
  }
  return cache[fp];
};

console.log('【1】概况');
const unpacked = entries.filter(e => e.node.unpacked).length;
console.log('  文件总数   : ' + entries.length + '（unpacked ' + unpacked + '）');
const uiFiles = entries.filter(e => /^renderer\/.*\.(css|html)$/.test(e.path));
console.log('  UI 样式文件: ' + uiFiles.length + ' 个（renderer/*.css + *.html）');

console.log('\n【2】设计 token 主文件（配色挂载点）');
const tokenFiles = [];
for (const e of uiFiles) {
  if (!/\.css$/.test(e.path)) continue;
  if (/--wb-palette-brand-8\s*:/.test(gc(e.path))) tokenFiles.push(e.path);
}
if (tokenFiles.length) {
  tokenFiles.forEach(p => console.log('  ✅ ' + p + '  (' + (entries.find(x => x.path === p).node.size / 1024).toFixed(1) + ' KB)'));
} else {
  console.log('  ❌ 未找到（配色补丁会失效！）');
  console.log('     → 官方可能改了 token 变量名。试试搜已知变量名：');
  const probes = ['--wb-palette-brand-8', '--wb-palette-white-100', 'data-vscode-theme-name'];
  for (const pv of probes) {
    const hit = uiFiles.filter(e => gc(e.path).includes(pv)).map(e => e.path);
    console.log('       ' + pv + ' → ' + (hit.length ? hit.slice(0, 3).join(', ') : '无任何文件包含'));
  }
}

console.log('\n【3】字体变量定义位置');
for (const e of uiFiles) {
  const s = gc(e.path);
  for (const m of s.match(/--(?:default|vscode)-font-family\s*:\s*[^;}]{0,110}/g) || []) {
    console.log('  ★ ' + e.path);
    console.log('      ' + m.trim());
  }
}

console.log('\n【4】CSS 加载顺序（决定覆盖优先级）');
const idxEntry = entries.find(e => /^renderer\/index\.html$/.test(e.path));
if (idxEntry) {
  const ih = gc('renderer/index.html');
  const links = [...ih.matchAll(/href="([^"]*\.css)"/g)].map(m => m[1]);
  if (links.length) {
    links.slice(-6).forEach((l, i) => console.log('  ' + (links.length - 5 + i) + '. ' + l));
    console.log('  （共 ' + links.length + ' 个，以上为最后 6 个 —— 越靠后优先级越高）');
  } else console.log('  index.html 里没有外链 CSS');
  console.log('  内联 <style> 块数: ' + (ih.match(/<style/g) || []).length);
} else {
  console.log('  ❌ 未找到 renderer/index.html');
}

console.log('\n【5】主题选择器');
const sel = { 'data-vscode-theme-name': 0, 'IDE Light': 0, 'IDE Night/vscode-dark': 0 };
for (const e of uiFiles) {
  const s = gc(e.path);
  if (s.includes('data-vscode-theme-name')) sel['data-vscode-theme-name']++;
  if (s.includes('IDE Light')) sel['IDE Light']++;
  if (/IDE Night|vscode-dark/.test(s)) sel['IDE Night/vscode-dark']++;
}
for (const [k, v] of Object.entries(sel)) console.log('  含 ' + k.padEnd(24) + ' 的文件: ' + v);

console.log('\n【6】补丁状态');
const marks = [
  ['字体补丁 wb-font-patched', 'wb-font-patched'],
  ['配色补丁 wb-claude-theme', 'wb-claude-theme'],
];
for (const [label, mark] of marks) {
  const hit = uiFiles.filter(e => gc(e.path).includes(mark));
  console.log('  ' + label.padEnd(28) + ': ' + (hit.length ? '✅ 已打 → ' + hit.length + ' 个文件' : '— 未打（官方原版）'));
}

console.log('\n【7】配套检查');
const dir = path.dirname(target);
const backup = target + '.backup';
console.log('  备份文件: ' + (fs.existsSync(backup) ? '✅ 存在 (' + (fs.statSync(backup).size / 1048576).toFixed(1) + ' MB)' : '❌ 不存在'));
// 检测 exe 的 fuse 开关 —— 这才是在新版上决定「改 asar 会不会导致打不开」的关键。
// 千万不要靠 debug.log 来判断：完整性校验在日志系统初始化之前就拒绝启动，
// 日志里看不到任何痕迹，据此判断会得出完全相反的结论。
const exe = path.join(path.dirname(dir), process.platform === 'win32' ? 'WorkBuddy.exe' : 'WorkBuddy');
console.log('  exe 备份  : ' + (fs.existsSync(exe + '.backup') ? '✅ 存在' : '❌ 不存在'));
if (fs.existsSync(exe)) {
  try {
    const st = fs.statSync(exe);
    const fdE = fs.openSync(exe, 'r');
    const needle = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'ascii');
    const CHUNK = 8 * 1024 * 1024;
    let found = -1, pos = 0;
    while (pos < st.size) {
      const len = Math.min(CHUNK + needle.length, st.size - pos);
      const b = Buffer.alloc(len);
      fs.readSync(fdE, b, 0, len, pos);
      const i = b.indexOf(needle);
      if (i >= 0) { found = pos + i; break; }
      pos += CHUNK;
    }
    if (found < 0) {
      console.log('  asar 校验开关: 未找到 fuse sentinel（较老版本，通常无需处理）');
    } else {
      const meta = Buffer.alloc(2);
      fs.readSync(fdE, meta, 0, 2, found + needle.length);
      const dataLen = meta[1];
      const data = Buffer.alloc(dataLen);
      fs.readSync(fdE, data, 0, dataLen, found + needle.length + 2);
      // fuse wire v1 第 5 项 (index 4) = EnableEmbeddedAsarIntegrityValidation
      const IDX = 4;
      const c = dataLen > IDX ? String.fromCharCode(data[IDX]) : '?';
      if (c === '1') {
        console.log('  asar 校验开关: ❌ 开启中 → 改界面会导致打不开（补丁脚本会先自动关闭）');
      } else if (c === '0') {
        console.log('  asar 校验开关: ✅ 已关闭 → 可安全修改界面');
      } else {
        console.log('  asar 校验开关: ⚠ 状态异常 (' + c + ')，用 fuse-check.js 详查');
      }
    }
    fs.closeSync(fdE);
  } catch (e) {
    console.log('  asar 校验开关: ⚠ 检测失败 → ' + e.message);
  }
} else {
  console.log('  asar 校验开关: 未找到可执行文件，跳过');
}

console.log('\n' + ''.padEnd(64, '='));
console.log('提示：把上面【2】的结果与补丁脚本里的挂载点判断规则对照，');
console.log('      若 token 文件名变了 → 说明脚本硬编码了文件名，需改为内容特征识别。');
fs.closeSync(h.fd);
