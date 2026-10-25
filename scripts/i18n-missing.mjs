#!/usr/bin/env node
// Lists zh-Hant text nodes / translatable attributes in built pages that have no entry in data/i18n/<lang>.json.
//   node scripts/i18n-missing.mjs [page.html ...]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dict = Object.fromEntries(['zh-Hans', 'en'].map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'data/i18n', `${l}.json`), 'utf8'))]));
const pages = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const hasCjk = (s) => /[㐀-鿿]/.test(s);
const missing = new Map();

for (const f of pages) {
  const html = readFileSync(join(ROOT, f), 'utf8')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '')
    .replace(/<div class="language-switcher"[\s\S]*?<\/div>/, '');
  const found = new Set();
  for (const m of html.matchAll(/>([^<>]+)</g)) {
    const text = decode(m[1]).trim();
    if (text && hasCjk(text)) found.add(text);
  }
  for (const m of html.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"]*)"/g)) {
    const text = decode(m[1]).trim();
    if (text && hasCjk(text)) found.add(text);
  }
  for (const text of found) {
    for (const lang of Object.keys(dict)) {
      if (!(text in dict[lang])) {
        const key = `${lang}\t${text}`;
        missing.set(key, [...(missing.get(key) ?? []), f]);
      }
    }
  }
}
for (const [key, files] of missing) console.log(`${key}\t(${files.slice(0, 2).join(', ')}${files.length > 2 ? '…' : ''})`);
console.log(`${missing.size} missing entries`);
