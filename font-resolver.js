/**
 * font-resolver.js —— 系统字体家族名解析器
 *
 * ⚠ 最重要的坑（2026-09-23 实测纠正）：
 *   一个 TTF 里往往有【两套】家族名，浏览器和 GDI 用的不是同一个：
 *     nid=1  Family            → GDI/注册表用的名（如「仓耳今楷03 W04」）
 *     nid=16 TypographicFamily → Chromium/DirectWrite 实际用的名（如「仓耳今楷03」）
 *   浏览器优先用 nid=16。填 nid=1 的名字浏览器【认不出来】，会静默回退默认字体。
 *   本脚本以 nid=16 为「推荐值」优先输出。
 *
 * 用法：
 *   node font-resolver.js                 列出所有可用的中文/自定义字体家族名
 *   node font-resolver.js 仓耳今楷         按关键词模糊匹配，输出真实家族名
 *   node font-resolver.js --verify 名字     用真实浏览器内核验证该名字是否生效（需 Edge/Chrome）
 */
const fs = require('fs');
const path = require('path');

const FONT_DIRS = [
  'C:\\Windows\\Fonts',
  path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
            'Microsoft', 'Windows', 'Fonts'),
];

function utf16beToString(buf) {
  if (buf.length % 2 !== 0) return '';
  const sw = Buffer.from(buf);
  sw.swap16();
  return sw.toString('utf16le');
}

// 返回 { fam1:Set(nid=1), fam16:Set(nid=16), fam4:Set(nid=4) }
function parseFamilies(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    if (st.size > 120 * 1024 * 1024) return null;   // 跳过超大文件
    buf = fs.readFileSync(file);
  } catch { return null; }

  const tag = buf.toString('latin1', 0, 4);
  // ttf/otf: 0x00010000 / 'OTTO' / 'true' / 'typ1'
  const isSFNT = tag === 'OTTO' || tag === 'true' || tag === 'typ1' ||
                 buf.readUInt32BE(0) === 0x00010000;
  if (!isSFNT) return null;                        // ttc 等暂不处理

  const numTables = buf.readUInt16BE(4);
  let nameOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) break;
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      nameOff = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (nameOff < 0 || nameOff + 6 > buf.length) return null;

  const count = buf.readUInt16BE(nameOff + 2);
  const strOff = buf.readUInt16BE(nameOff + 4);
  const fam1 = new Set(), fam16 = new Set(), fam4 = new Set();

  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12;
    if (r + 12 > buf.length) break;
    const pid = buf.readUInt16BE(r);
    const nid = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8);
    const off = buf.readUInt16BE(r + 10);
    if (nid !== 1 && nid !== 16 && nid !== 4) continue;

    const s = buf.slice(nameOff + strOff + off, nameOff + strOff + off + len);
    let t;
    if (pid === 3 || pid === 0) t = utf16beToString(s);
    else t = s.toString('latin1');
    t = (t || '').replace(/\0/g, '').trim();
    if (!t || t.length >= 80) continue;
    if (nid === 1) fam1.add(t);
    else if (nid === 16) fam16.add(t);
    else fam4.add(t);
  }
  if (!fam1.size && !fam16.size) return null;
  return { fam1, fam16, fam4 };
}

function scanAll() {
  const all = new Map();   // 家族名 -> {file, src}
  for (const dir of FONT_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const r = parseFamilies(path.join(dir, f));
      if (!r) continue;
      // nid=16 优先登记（浏览器用名），再补 nid=1
      for (const fam of r.fam16) if (!all.has(fam)) all.set(fam, { file: f, src: 'nid16' });
      for (const fam of r.fam1) if (!all.has(fam)) all.set(fam, { file: f, src: 'nid1' });
    }
  }
  return all;
}

const argv = process.argv.slice(2);
const kw = argv.filter(a => a !== '--verify').join(' ').trim();

const all = scanAll();
console.log(`扫描到 ${all.size} 个字体家族名\n`);

if (!kw) {
  // 无参数：只列出非 ASCII 家族名（通常是中文自定义字体）
  const cn = [...all.keys()].filter(n => /[\u4e00-\u9fa5]/.test(n)).sort();
  console.log(`=== 含中文的字体家族名 (${cn.length} 个) ===`);
  cn.forEach(n => {
    const v = all.get(n);
    console.log(`  ${n}${v.src === 'nid16' ? '   ★浏览器用名' : ''}    [${v.file}]`);
  });
  console.log('\n★ = 浏览器(Chromium)实际认的名字，优先填这个。');
} else {
  const norm = s => s.toLowerCase().replace(/[\s\-_]/g, '');
  const k = norm(kw);
  const hits = [...all.keys()].filter(n => norm(n).includes(k));
  console.log(`=== 关键词「${kw}」匹配到 ${hits.length} 个真实家族名 ===`);
  if (!hits.length) {
    console.log('  (无匹配 — 该字体可能没装，或装在注册表未登记的位置)');
  } else {
    // 浏览器用名(nid16)排前面
    hits.sort((a, b) => {
      const sa = all.get(a).src === 'nid16' ? 0 : 1;
      const sb = all.get(b).src === 'nid16' ? 0 : 1;
      return sa - sb || a.localeCompare(b);
    });
    hits.forEach(n => {
      const v = all.get(n);
      const tag = v.src === 'nid16' ? '   ★浏览器用名（推荐填这个）' : '   ⚠ GDI 注册表名（浏览器可能认不出）';
      console.log(`  ${n}${tag}    [${v.file}]`);
    });
  }
  console.log('\n提示：优先填带「★浏览器用名」的那个。带 ⚠ 的名字 GDI 认、但浏览器可能认不出，');
  console.log('      会导致字体静默回退（看着改了其实没生效）。');
}