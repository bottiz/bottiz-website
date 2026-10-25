#!/usr/bin/env node
// Static site builder (zero dependencies).
//   src/pages/*.html     page body + JSON front matter  ->  ./<slug>.html
//   src/layouts/*.html   page shell
//   src/partials/*.html  shared components, included with {{> name}}
//   data/*.json          content & config, exposed to templates by file name
//
// Template syntax: {{path}} raw, {{path|e}} HTML-escaped, {{> partial}},
// {{#if path}}..{{else}}..{{/if}}, {{#each path}}..{{/each}} (@index, this).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const listHtml = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.html'));

const escapeHtml = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- data -----------------------------------------------------------------
const data = {};
if (existsSync(join(ROOT, 'data'))) {
  for (const f of readdirSync(join(ROOT, 'data')).filter((n) => n.endsWith('.json'))) {
    data[basename(f, '.json')] = JSON.parse(read('data', f));
  }
}

// ---- templates ------------------------------------------------------------
const partials = {};
for (const f of listHtml('src/partials')) partials[basename(f, '.html')] = read('src/partials', f);
const layouts = {};
for (const f of listHtml('src/layouts')) layouts[basename(f, '.html')] = read('src/layouts', f);

const TOKEN = /\{\{\s*([#/>]?)\s*([^}]*?)\s*\}\}/g;

function parse(tpl) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(tpl))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push({ type: 'text', value: tpl.slice(last, m.index) });
    last = TOKEN.lastIndex;
    const [, sigil, body] = m;
    if (sigil === '>') top.children.push({ type: 'partial', name: body });
    else if (sigil === '#') {
      const [kind, ...rest] = body.split(/\s+/);
      const node = { type: kind, path: rest.join(' '), children: [], alt: null };
      top.children.push(node);
      stack.push(node);
    } else if (sigil === '/') stack.pop();
    else {
      const [path, filter] = body.split('|');
      top.children.push({ type: 'var', path: path.trim(), escape: filter?.trim() === 'e' });
    }
  }
  if (last < tpl.length) stack[stack.length - 1].children.push({ type: 'text', value: tpl.slice(last) });
  return root;
}

// {{else}}: rewritten to a sentinel variable, then split out of each block's children.
function parseWithElse(tpl) {
  const marked = tpl.replace(/\{\{\s*else\s*\}\}/g, '{{ __else__ }}');
  const ast = parse(marked);
  (function split(node) {
    if (!node.children) return;
    node.children.forEach(split);
    const i = node.children.findIndex((c) => c.type === 'var' && c.path === '__else__');
    if (i >= 0) {
      node.alt = node.children.slice(i + 1);
      node.children = node.children.slice(0, i);
    }
  })(ast);
  return ast;
}

const missing = new Set();
function lookup(path, scopes) {
  if (path === 'this') return scopes[0].this;
  const parts = path.split('.');
  for (const scope of scopes) {
    if (scope && Object.prototype.hasOwnProperty.call(scope, parts[0])) {
      let v = scope;
      for (const p of parts) {
        if (v == null) return undefined;
        v = v[p];
      }
      return v;
    }
  }
  return undefined;
}

function renderNodes(nodes, scopes, ctxName) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += n.value;
        break;
      case 'var': {
        const v = lookup(n.path, scopes);
        if (v === undefined || v === null) {
          missing.add(`${ctxName}: {{${n.path}}}`);
          break;
        }
        out += n.escape ? escapeHtml(v) : String(v);
        break;
      }
      case 'partial': {
        if (!(n.name in partials)) throw new Error(`Unknown partial "${n.name}" in ${ctxName}`);
        out += renderNodes(getAst('partial:' + n.name, partials[n.name]).children, scopes, `partial ${n.name}`);
        break;
      }
      case 'if': {
        const v = lookup(n.path, scopes);
        const truthy = Array.isArray(v) ? v.length > 0 : Boolean(v);
        out += renderNodes(truthy ? n.children : n.alt || [], scopes, ctxName);
        break;
      }
      case 'each': {
        const list = lookup(n.path, scopes) || [];
        list.forEach((item, index) => {
          const scope = typeof item === 'object' && item !== null ? { ...item, this: item } : { this: item };
          scope['@index'] = index;
          out += renderNodes(n.children, [scope, ...scopes], ctxName);
        });
        break;
      }
    }
  }
  return out;
}

const astCache = new Map();
function getAst(key, tpl) {
  if (!astCache.has(key)) astCache.set(key, parseWithElse(tpl));
  return astCache.get(key);
}

// ---- build ----------------------------------------------------------------
const FRONT = /^<!--page\n([\s\S]*?)\n-->\n?/;
let count = 0;
for (const file of listHtml('src/pages')) {
  const raw = read('src/pages', file);
  const fm = raw.match(FRONT);
  if (!fm) throw new Error(`${file}: missing <!--page ... --> front matter`);
  const page = JSON.parse(fm[1]);
  page.slug = page.slug || file;
  // Derived, template-friendly fields.
  page.navCta = { ...data.site.navCta, ...page.navCta };
  page.footer = page.footer || data.site.footer;
  page.ogType = page.ogType || 'website';
  if (page.jsonld) page.jsonldText = JSON.stringify(page.jsonld, null, 2);
  const navItems = data.site.nav.map((n) => ({ ...n, active: n.key === page.nav }));
  const scopes = [{ page, navItems }, data];
  const content = renderNodes(getAst('page:' + file, raw.slice(fm[0].length)).children, scopes, file);
  const layoutName = page.layout || 'base';
  const html = renderNodes(getAst('layout:' + layoutName, layouts[layoutName]).children, [{ content }, ...scopes], layoutName);
  writeFileSync(join(ROOT, page.slug), html);
  count++;
}

if (missing.size) {
  console.warn('Warning: unresolved template variables:\n  ' + [...missing].join('\n  '));
}
console.log(`Built ${count} pages.`);
