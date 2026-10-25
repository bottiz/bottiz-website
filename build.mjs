#!/usr/bin/env node
// Static site builder (zero dependencies).
//   src/pages/*.html     page body + JSON front matter  ->  ./<slug>.html
//   src/layouts/*.html   page shell
//   src/partials/*.html  shared components, included with {{> name}}
//   data/*.json          content & config, exposed to templates by file name
//
// Template syntax: {{path}} raw, {{path|e}} HTML-escaped, {{> partial}},
// {{#if path}}..{{else}}..{{/if}}, {{#each path}}..{{/each}}, {{#with path}}..{{/with}}.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
// OUT_DIR lets you build a throw-away copy (e.g. with a test FORM_ENDPOINT) without touching the repo root.
const OUT = process.env.OUT_DIR || ROOT;
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

const site = data.site;
// Shared copy placeholders inside data strings, e.g. footer "{{tagline.zh}}".
site.footer = site.footer.replace(/\{\{\s*tagline\.(\w+)\s*\}\}/g, (_, k) => site.tagline[k]);

// Environment overrides (deployment-specific values stay out of the repo).
if (process.env.FORM_ENDPOINT) site.form.endpoint = process.env.FORM_ENDPOINT;
if (process.env.PRIVACY_URL) site.form.privacyUrl = process.env.PRIVACY_URL;
if (process.env.ANALYTICS_ID) Object.assign(site.analytics, { enabled: true, measurementId: process.env.ANALYTICS_ID });
const isBlank = (v) => !v || !String(v).trim();
site.form.endpointConfigured = !isBlank(site.form.endpoint);
site.form.format = /^https:\/\/formsubmit\.co\//.test(site.form.endpoint) ? 'formsubmit' : 'json';
site.form.privacyConfigured = !isBlank(site.form.privacyUrl);
site.analytics.enabled = Boolean(site.analytics.enabled) && !isBlank(site.analytics.measurementId);

// Form variants: expand base/overrides, flag control type for the template.
function resolveForms(raw) {
  const out = {};
  for (const [key, def] of Object.entries(raw)) {
    const base = def.base ? raw[def.base] : null;
    let fields = JSON.parse(JSON.stringify(def.fields || base.fields));
    for (const [fieldKey, patch] of Object.entries(def.overrides || {})) {
      const f = fields.find((x) => x.key === fieldKey);
      if (!f) throw new Error(`forms.${key}: unknown field "${fieldKey}"`);
      Object.assign(f, patch);
    }
    fields = fields.map((f) => ({ ...f, [`is_${f.control}`]: true }));
    out[key] = { key, formId: 'inquiryForm', whatsapp: true, title: base?.title, submitLabel: base?.submitLabel, ...def, fields };
    delete out[key].base;
    delete out[key].overrides;
  }
  return out;
}
data.forms = resolveForms(data.forms);
for (const item of Object.values(data.downloads || {})) item.ready = !isBlank(item.file);
for (const form of Object.values(data.forms)) form.download = form.downloadKey && data.downloads[form.downloadKey].ready ? data.downloads[form.downloadKey].file : '';
data.productList = Object.entries(data.products).map(([key, p]) => ({ key, ...p, categories: p.industries.join(' ') }));
// WhatsApp deep links: number lives in data/site.json, per-page messages in data/whatsapp.json.
site.contact.whatsappUrl = `https://wa.me/${site.contact.whatsapp}`;
const waLink = (text) => `${site.contact.whatsappUrl}?text=${encodeURIComponent(text)}`;
const waProduct = (name) => waLink(data.whatsapp.product.replace('{name}', name));
for (const item of data.productList) item.whatsappUrl = waProduct(item.name);
const absUrl = (u) => (/^https?:/.test(u) ? u : `${site.url}/${u}`);
// JSON for <script type="application/ld+json">: keep "<" from closing the tag.
const ldJson = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

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
      case 'with': {
        const v = lookup(n.path, scopes);
        if (v) out += renderNodes(n.children, [{ ...v, this: v }, ...scopes], ctxName);
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

function organizationLd() {
  const { name, url, logo, description, contact, organization: o } = site;
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: `${url}/`,
    logo: absUrl(logo.mark),
    description,
    email: contact.email,
    telephone: contact.phoneDisplay,
    address: {
      '@type': 'PostalAddress',
      streetAddress: o.streetAddress,
      addressLocality: o.addressLocality,
      addressCountry: o.addressCountry,
    },
    sameAs: o.sameAs,
  };
}

// FAQPage markup is generated from the same data the page renders (page.faq).
function faqLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

// ---- image helpers -------------------------------------------------------
// Reads intrinsic size from PNG / JPEG / WebP headers so every <img> can carry
// width/height (prevents layout shift) without a manual step.
const sizeCache = new Map();
function imageSize(rel) {
  if (sizeCache.has(rel)) return sizeCache.get(rel);
  let size = null;
  try {
    const b = readFileSync(join(ROOT, rel));
    if (b.toString('ascii', 1, 4) === 'PNG') size = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    else if (b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8 ') size = { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      else if (kind === 'VP8L') {
        const v = b.readUInt32LE(21);
        size = { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
      } else if (kind === 'VP8X') size = { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
    } else if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) break;
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          size = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
          break;
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* missing file is reported by check.mjs */
  }
  sizeCache.set(rel, size);
  return size;
}

// Adds width/height to local images lacking them, and lazy-loading to everything
// after the first two images (header logo + first visual).
function optimizeImages(html) {
  let index = 0;
  return html.replace(/<img\b([^>]*?)(\/?)>/g, (tag, attrs, close) => {
    const i = index++;
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    let out = attrs;
    if (src && !/^https?:|^data:/.test(src) && !/\bwidth="/.test(out)) {
      const dim = imageSize(src);
      if (dim) out += ` width="${dim.w}" height="${dim.h}"`;
    }
    if (i > 1 && !/\bloading="/.test(out)) out += ' loading="lazy" decoding="async"';
    return `<img${out}${close}>`;
  });
}

// ---- page content blocks (data/page-<name>.json, referenced by front matter "content") ----
function decorateBlock(block, name) {
  const b = { ...block, [`is_${block.type}`]: true };
  if (b.type === 'models') {
    b.items = b.models.map(({ key, from }) => modelCard(key, from || b.industry, name));
  }
  return b;
}

// Compact model card used on industry and listing pages: fit text for the industry, else the product summary.
function modelCard(key, industry, where) {
  const p = data.products[key];
  if (!p) throw new Error(`${where}: unknown product "${key}"`);
  const fit = p.fit?.[industry];
  return { name: p.name, page: p.page, image: p.cardImage, alt: p.cardImageAlt, tag: fit?.tag ?? p.subtitle, blurb: fit?.blurb ?? p.summary };
}

function resolveBlocks(name) {
  const content = data[name];
  if (!content) throw new Error(`Unknown content file "${name}"`);
  const blocks = content.blocks.map((block) => decorateBlock(block, name));
  const faq = (content.faq || []).filter((f) => !isBlank(f.a));
  return { blocks, faq };
}

// ---- industry pages: data/industry-<key>.json rendered by partials/industry.html ----
function resolveIndustry(key) {
  const file = `industry-${key}`;
  const d = structuredClone(data[file]);
  if (!d) throw new Error(`Unknown industry "${key}"`);
  const pad = (i) => String(i + 1).padStart(2, '0');
  const product = (k) => {
    if (!data.products[k]) throw new Error(`${file}: unknown product "${k}"`);
    return data.products[k];
  };
  d.pains.items = d.pains.items.map((it, i) => ({ ...it, no: pad(i), icon: data.icons[d.pains.icons[i]] }));
  d.scenes.items = d.scenes.items.map((it) => {
    const models = (it.models || []).map((k) => ({ name: product(k).name, page: product(k).page }));
    const lead = it.models?.[0] && product(it.models[0]);
    return { ...it, models, image: it.image || (lead && { src: lead.cardImage, alt: lead.cardImageAlt, width: 539, height: 538, cls: 'scene-image-product' }) };
  });
  d.values.items = d.values.items.map((it, i) => ({ ...it, no: pad(i) }));
  if (d.models || d.scenes.items.some((s) => s.models.length)) {
    // models: those in scenes first (grouped by task), then any other model listed for this industry
    const keys = [...new Set([...d.scenes.items.flatMap((s, i) => data[file].scenes.items[i].models || []), ...Object.keys(data.products).filter((k) => data.products[k].fit?.[key])])];
    if (d.models) d.models.items = keys.map((k) => modelCard(k, key, file));
  }
  d.cases = data.cases.filter((c) => c.industries.includes(key));
  d.others = data.industries.filter((i) => i.key !== key);
  d.extras = (d.extras || []).map((x) => decorateBlock(x, file));
  d.closing = (d.closing || []).map((x) => decorateBlock(x, file));
  d.stats = d.stats || [];
  return {
    ind: d,
    title: d.seo.title,
    description: d.seo.description,
    keywords: d.seo.keywords,
    ogDescription: d.seo.ogDescription,
    ogImage: d.seo.ogImage,
    nav: d.nav,
    whatsapp: d.whatsapp,
    industry: key,
    navCta: d.navCta ? { label: d.navCta } : undefined,
    footer: d.footer,
    form: d.form,
    formInline: d.formInline,
    faq: d.faq,
    priority: '0.8',
  };
}

// ---- product pages: data/products.json -> page meta + detail template ----
function resolveProduct(key) {
  const p = data.products[key];
  if (!p) throw new Error(`Unknown product "${key}"`);
  const productData = {
    ...p,
    key,
    industryLinks: p.industries.map((k) => data.industries.find((i) => i.key === k)).filter(Boolean),
    whatsappUrl: waProduct(p.name),
    backHref: `products.html#${p.industries[0]}`,
    scenarios: p.scenarios.map((s, i) => ({ ...s, no: String(i + 1).padStart(2, '0') })),
    siteSpecs: p.specs.filter((s) => /最小|爬坡|越障|爬樓梯/.test(s.label)),
    whatsappInfoUrl: waLink(data.whatsapp.productInfo.replace('{name}', p.name)),
  };
  return {
    productData,
    title: `${p.name} ${p.subtitle}｜BottiZ 產品中心`,
    description: p.summary,
    ogTitle: p.seo.ogTitle,
    ogType: 'product',
    keywords: p.seo.keywords,
    nav: 'products',
    priority: '0.6',
  };
}

// ---- build ----------------------------------------------------------------
const FRONT = /^<!--page\n([\s\S]*?)\n-->\n?/;
let count = 0;
const built = [];
for (const file of listHtml('src/pages')) {
  const raw = read('src/pages', file);
  const fm = raw.match(FRONT);
  if (!fm) throw new Error(`${file}: missing <!--page ... --> front matter`);
  // Front matter strings may use {{site.tagline.zh}} etc., resolved against the data files.
  const page = JSON.parse(fm[1], (_, v) => (typeof v === 'string' && v.includes('{{') ? renderNodes(parseWithElse(v).children, [data], file) : v));
  page.slug = page.slug || file;
  if (page.content) Object.assign(page, resolveBlocks(page.content));
  if (page.product) Object.assign(page, resolveProduct(page.product));
  if (page.industryPage) Object.assign(page, resolveIndustry(page.industryPage));
  // Derived, template-friendly fields.
  page.navCta = { ...data.site.navCta, ...page.navCta };
  page.footer = page.footer || data.site.footer;
  page.ogType = page.ogType || 'website';
  page.industry = page.industry || '';
  page.canonical = absUrl(page.slug === 'index.html' ? '' : page.slug);
  page.ogTitle = page.ogTitle || page.title;
  page.ogDescription = page.ogDescription || page.description;
  page.keywords = page.keywords || data.site.defaultKeywords;
  page.ogImage = absUrl(page.ogImage || data.site.ogImage);
  page.ogImageAlt = page.ogImageAlt || page.ogTitle;
  page.orgLd = ldJson(organizationLd());
  // data/<name>.json exposed to client scripts as <script type="application/json"> via page.embed.
  page.embedJson = Object.fromEntries((page.embed || []).map((name) => [name, ldJson(data[name])]));
  if (page.faq?.length) page.faqLd = ldJson(faqLd(page.faq));
  if (page.form !== false) {
    page.formData = data.forms[page.form || 'default'];
    if (!page.formData) throw new Error(`${file}: unknown form variant "${page.form}"`);
    page.formModal = !page.formInline;
  }
  page.whatsappUrl = page.productData ? page.productData.whatsappUrl : waLink(data.whatsapp.pages[page.whatsapp || 'default'] ?? data.whatsapp.pages.default);
  const navItems = data.site.nav.map((n) => ({ ...n, active: n.key === page.nav }));
  const scopes = [{ page, navItems, whatsappUrl: page.whatsappUrl, contactSource: 'inline' }, data];
  const content = renderNodes(getAst('page:' + file, raw.slice(fm[0].length)).children, scopes, file);
  const layoutName = page.layout || 'base';
  const html = renderNodes(getAst('layout:' + layoutName, layouts[layoutName]).children, [{ content }, ...scopes], layoutName);
  writeFileSync(join(OUT, page.slug), optimizeImages(html));
  built.push(page);
  count++;
}

// ---- translations: data/i18n/<lang>.json -> assets/i18n/<lang>.json (loaded on demand)
mkdirSync(join(OUT, 'assets/i18n'), { recursive: true });
for (const lang of ['zh-Hans', 'en']) {
  writeFileSync(join(OUT, `assets/i18n/${lang}.json`), JSON.stringify(JSON.parse(read('data/i18n', `${lang}.json`))));
}

// ---- sitemap.xml & robots.txt ----------------------------------------------
function lastModified(slug) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', `src/pages/${slug}`], { cwd: ROOT }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}
const urlEntries = built
  .filter((p) => p.sitemap !== false)
  .map((p) => {
    const lastmod = lastModified(p.slug);
    return `  <url>\n    <loc>${p.canonical}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <priority>${p.priority ?? '0.6'}</priority>\n  </url>`;
  })
  .join('\n');
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`,
);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);

if (missing.size) {
  console.warn('Warning: unresolved template variables:\n  ' + [...missing].join('\n  '));
}
console.log(`Built ${count} pages.`);
