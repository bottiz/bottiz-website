#!/usr/bin/env node
// Lists every 【待填：…】 placeholder in the editable sources, with the file and (for JSON) the path to edit.
//   node scripts/todo-list.mjs > deliverables/待填清單.md
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];
const walk = (node, path, file) => {
  if (typeof node === 'string') { if (node.includes('【待填')) rows.push({ file, where: path.join('.'), text: node }); }
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, [...path, i], file));
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => walk(v, [...path, k], file));
};
for (const f of readdirSync(join(ROOT, 'data')).filter((n) => n.endsWith('.json'))) {
  walk(JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8')), [], `data/${f}`);
}
for (const dir of ['src/pages', 'src/partials']) {
  for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.html'))) {
    readFileSync(join(ROOT, dir, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/【待填：[^】]*】/g)) rows.push({ file: `${dir}/${f}`, where: `line ${i + 1}`, text: m[0] });
    });
  }
}
const byFile = new Map();
for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
console.log('# BottiZ 網站待填清單\n\n由 `node scripts/todo-list.mjs` 產生。每項為網頁上顯示的【待填】佔位；填寫後執行 `node build.mjs` 重新生成頁面。\n');
for (const [file, list] of byFile) {
  console.log(`## ${file}（${list.length}）\n`);
  for (const r of list) console.log(`- \`${r.where}\`：${r.text}`);
  console.log('');
}
console.error(`${rows.length} placeholders in ${byFile.size} files`);
