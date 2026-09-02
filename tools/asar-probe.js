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
const logFile = path.join(path.dirname(dir), 'debug.log');
if (fs.existsSync(logFile)) {
  const log = fs.readFileSync(logFile, 'utf8');
  const bad = /asar|integrity|corrupt/i.test(log);
  console.log('  启动日志 asar 校验: ' + (bad ? '⚠ 发现相关字眼，需人工确认' : '✅ 无校验/自愈痕迹（改 asar 安全）'));
} else {
  console.log('  启动日志: 未找到 debug.log');
}

console.log('\n' + ''.padEnd(64, '='));
console.log('提示：把上面【2】的结果与补丁脚本里的挂载点判断规则对照，');
console.log('      若 token 文件名变了 → 说明脚本硬编码了文件名，需改为内容特征识别。');
fs.closeSync(h.fd);
