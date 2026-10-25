#!/usr/bin/env node
// Append translations: node scripts/add-i18n.mjs rows.json   (rows: [[zhHant, zhHans, en], ...]); existing keys are kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [lang, index] of [['zh-Hans', 1], ['en', 2]]) {
  const file = join(ROOT, 'data/i18n', `${lang}.json`);
  const dict = JSON.parse(readFileSync(file, 'utf8'));
  let added = 0;
  for (const row of rows) if (!(row[0] in dict)) { dict[row[0]] = row[index]; added++; }
  writeFileSync(file, JSON.stringify(dict, null, 1) + '\n');
  console.log(`${lang}: +${added}`);
}
