#!/usr/bin/env node
// Site audit (zero dependencies): SEO, heading structure, images, links, forms.
//   node check.mjs            -> prints problems, exit code 1 if any error
//   node check.mjs --todo     -> also lists every 【待填：…】 placeholder
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const src = new Map(pages.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
const errors = [];
const warns = [];
const todo = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warns.push(`${f}: ${m}`);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, attr, name) =>
  decode(html.match(new RegExp(`<meta[^>]*${attr}="${name}"[^>]*content="([^"]*)"`))?.[1] ?? '');

const titles = new Map();
const descs = new Map();
const idsByPage = new Map();

for (const [f, html] of src) {
  const head = html.split('</head>')[0];
  const body = html.split('</head>')[1] || '';

  // --- head / SEO
  const title = decode(head.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  const desc = meta(head, 'name', 'description');
  if (!title) err(f, 'missing <title>');
  if (!desc) err(f, 'missing meta description');
  if (title.length > 40) warn(f, `title long (${title.length} chars)`);
  if (desc && (desc.length < 30 || desc.length > 120)) warn(f, `description length ${desc.length} (aim 30-120)`);
  if (titles.has(title)) err(f, `duplicate title with ${titles.get(title)}`);
  titles.set(title, f);
  if (descs.has(desc)) err(f, `duplicate description with ${descs.get(desc)}`);
  descs.set(desc, f);
  if (!meta(head, 'name', 'keywords')) err(f, 'missing meta keywords');
  const canonical = head.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (!canonical) err(f, 'missing canonical');
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name']) {
    if (!meta(head, 'property', p)) err(f, `missing ${p}`);
  }
  for (const n of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    if (!meta(head, 'name', n)) err(f, `missing ${n}`);
  }
  if (canonical && meta(head, 'property', 'og:url') !== decode(canonical)) err(f, 'og:url differs from canonical');
  const ogImage = meta(head, 'property', 'og:image');
  const ogLocal = ogImage.replace('https://bottiz.com/', '');
  if (ogImage && !existsSync(join(ROOT, ogLocal))) err(f, `og:image file not found: ${ogLocal}`);

  // --- headings
  const headings = [...body.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  const h1 = headings.filter((n) => n === 1).length;
  if (h1 !== 1) err(f, `expected exactly 1 <h1>, found ${h1}`);
  let prev = 0;
  for (const level of headings) {
    if (level > prev + 1 && prev !== 0) {
      err(f, `heading level jumps h${prev} -> h${level}`);
      break;
    }
    prev = level;
  }

  // --- images
  const imgs = [...body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  imgs.forEach((tag, i) => {
    const alt = tag.match(/\balt="([^"]*)"/);
    if (!alt || !alt[1].trim()) err(f, `img without alt: ${tag.slice(0, 90)}`);
    if (!/\bwidth="/.test(tag) || !/\bheight="/.test(tag)) warn(f, `img without width/height: ${tag.match(/src="([^"]*)"/)?.[1]}`);
    if (i > 1 && !/loading="(lazy|eager)"/.test(tag)) warn(f, `img not lazy-loaded: ${tag.match(/src="([^"]*)"/)?.[1]}`);
    const s = tag.match(/src="([^"]*)"/)?.[1];
    if (s && !/^https?:|^data:/.test(s) && !existsSync(join(ROOT, s))) err(f, `img file not found: ${s}`);
  });

  // --- links
  for (const m of body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    const href = decode(m[1]);
    if (/^(https?:|mailto:|tel:|javascript:)/.test(href) || href === '#') continue;
    const [file, hash] = href.split('#');
    const target = file || f;
    if (!src.has(target) && !existsSync(join(ROOT, target))) {
      err(f, `broken link: ${href}`);
      continue;
    }
    // #hash may be an element id or a product filter button (data-filter).
    if (hash && src.has(target) && !new RegExp(`\\b(id|data-filter)="${hash}"`).test(src.get(target))) err(f, `missing anchor: ${href}`);
  }

  // --- forms
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  idsByPage.set(f, ids);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) err(f, `duplicate id: ${[...new Set(dup)].join(', ')}`);
  for (const m of body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    if (/type="(hidden|submit|button|checkbox-hidden)"/.test(attrs)) continue;
    if (/aria-label=|aria-labelledby=/.test(attrs)) continue;
    const id = attrs.match(/\bid="([^"]*)"/)?.[1];
    const wrapped = new RegExp(`<label[^>]*>[^<]*(?:<[^l/][^>]*>[^<]*)*<${m[1]}\\b[^>]*${id ? `id="${id}"` : 'XXXX'}`).test(body);
    const labelled = id && new RegExp(`<label[^>]*for="${id}"`).test(body);
    if (!wrapped && !labelled) err(f, `form control without label: <${m[1]} ${attrs.trim().slice(0, 60)}>`);
  }

  // --- wording
  const zhOnly = body.replace(/<script[\s\S]*?<\/script>/g, '');
  // 「悟空機器人」 is a third-party product name, kept as is.
  const wording = (zhOnly + head).replace(/悟空機器人/g, '');
  if (/機器人/.test(wording)) err(f, `contains「機器人」x${wording.match(/機器人/g).length}`);

  for (const m of html.matchAll(/【待填：[^】]*】/g)) todo.push(`${f}\t${m[0]}`);
}

if (process.argv.includes('--todo')) console.log('=== 待填清單 ===\n' + [...new Set(todo)].join('\n'));
if (warns.length) console.log('--- warnings (' + warns.length + ') ---\n' + warns.join('\n'));
if (errors.length) console.log('--- errors (' + errors.length + ') ---\n' + errors.join('\n'));
console.log(`Checked ${pages.length} pages: ${errors.length} errors, ${warns.length} warnings, ${new Set(todo).size} distinct placeholders.`);
process.exit(errors.length ? 1 : 0);
