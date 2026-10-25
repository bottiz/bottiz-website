/* Language switching.
 * The HTML carries Traditional Chinese (zh-Hant) as source text. Other languages are
 * looked up by exact source string in assets/i18n/<lang>.json, fetched on demand.
 * Elements marked data-i18n-skip are managed by their own script.
 */
(() => {
  const HTML_LANG = { 'zh-Hant': 'zh-Hant-HK', 'zh-Hans': 'zh-Hans', en: 'en' };
  const STORAGE_KEY = 'bottizLanguage';
  const TRANSLATED_ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const dictionaries = {};
  const textRecords = [];
  const attrRecords = [];
  let lang = 'zh-Hant';

  const t = (source, target = lang) =>
    target === 'zh-Hant' ? source : dictionaries[target]?.[source] ?? source;

  function registerContent() {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, .language-switcher, [data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const [, before, original, after] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (original) textRecords.push({ node, before, original, after });
    }
    const selector = TRANSLATED_ATTRS.map((a) => `[${a}]`).join(',');
    document.querySelectorAll(selector).forEach((element) => {
      TRANSLATED_ATTRS.forEach((attribute) => {
        if (element.hasAttribute(attribute)) attrRecords.push({ element, attribute, original: element.getAttribute(attribute) });
      });
    });
  }

  async function load(target) {
    if (target === 'zh-Hant' || dictionaries[target]) return;
    try {
      const response = await fetch(`assets/i18n/${target}.json`);
      dictionaries[target] = await response.json();
    } catch (error) {
      console.warn(`Could not load ${target} translations`, error);
      dictionaries[target] = {};
    }
  }

  function render() {
    document.documentElement.lang = HTML_LANG[lang];
    textRecords.forEach(({ node, before, original, after }) => { node.nodeValue = before + t(original) + after; });
    attrRecords.forEach(({ element, attribute, original }) => element.setAttribute(attribute, t(original)));
    const select = document.getElementById('languageSelect');
    if (select) select.value = lang;
    document.dispatchEvent(new CustomEvent('bottiz:lang', { detail: { lang } }));
  }

  async function setLanguage(next, remember = true) {
    lang = HTML_LANG[next] ? next : 'zh-Hant';
    await load(lang);
    render();
    if (remember) try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }

  function init() {
    registerContent();
    document.getElementById('languageSelect')?.addEventListener('change', (e) => setLanguage(e.target.value));
    let saved = 'zh-Hant';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'zh-Hant'; } catch { /* ignore */ }
    if (saved !== 'zh-Hant') setLanguage(saved, false);
  }

  window.BottizI18n = { t, setLanguage, get lang() { return lang; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
