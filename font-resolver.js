/**
 * font-resolver.js —— 系统字体家族名解析器
 *
 * 解决什么：CSS 里写 font-family: "仓耳今楷03" 但系统真实家族名是 "仓耳今楷03 W04"，
 *           名字对不上 → 浏览器静默回退到默认字体 → 补丁看着打了其实没生效。
 *
 * 用法：
 *   node font-resolver.js                 列出所有可用的中文/自定义字体家族名
 *   node font-resolver.js 仓耳今楷         按关键词模糊匹配，输出真实家族名
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
  const fams = new Set();

  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12;
    if (r + 12 > buf.length) break;
    const pid = buf.readUInt16BE(r);
    const nid = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8);
    const off = buf.readUInt16BE(r + 10);
    if (nid !== 1 && nid !== 16) continue;         // 1=Family 16=Typographic Family

    const s = buf.slice(nameOff + strOff + off, nameOff + strOff + off + len);
    let t;
    if (pid === 3 || pid === 0) t = utf16beToString(s);
    else t = s.toString('latin1');
    t = (t || '').replace(/\0/g, '').trim();
    if (t && t.length < 80) fams.add(t);
  }
  return fams.size ? fams : null;
}

function scanAll() {
  const all = new Map();                            // 家族名 -> 文件名
  for (const dir of FONT_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const fams = parseFamilies(path.join(dir, f));
      if (!fams) continue;
      for (const fam of fams) if (!all.has(fam)) all.set(fam, f);
    }
  }
  return all;
}

const kw = process.argv.slice(2).join(' ').trim();
const all = scanAll();
console.log(`扫描到 ${all.size} 个字体家族名\n`);

if (!kw) {
  // 无参数：只列出非 ASCII 家族名（通常是中文自定义字体）+ 常见西文
  const cn = [...all.keys()].filter(n => /[\u4e00-\u9fa5]/.test(n)).sort();
  console.log(`=== 含中文的字体家族名 (${cn.length} 个) ===`);
  cn.forEach(n => console.log(`  ${n}    [${all.get(n)}]`));
} else {
  const norm = s => s.toLowerCase().replace(/[\s\-_]/g, '');
  const k = norm(kw);
  const hits = [...all.keys()].filter(n => norm(n).includes(k));
  console.log(`=== 关键词「${kw}」匹配到 ${hits.length} 个真实家族名 ===`);
  if (!hits.length) {
    console.log('  (无匹配 — 该字体可能没装，或装在注册表未登记的位置)');
  } else {
    hits.sort().forEach(n => {
      const isDefault = /w0?4$|regular|medium/i.test(n);
      console.log(`  ${n}${isDefault ? '   ← 常规粗细' : ''}    [${all.get(n)}]`);
    });
  }
  console.log('\n提示：把上面任意一个名字（建议带 "← 常规粗细" 的）原样填进配置的 font 字段。');
}