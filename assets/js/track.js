/* Tracking hook + first-touch attribution.
 * BottizTrack(name, params) is the single entry point for events. It fans out to
 * dataLayer / gtag when an analytics tag is loaded (see site.analytics in
 * data/site.json) and always emits a "bottiz:track" DOM event for other listeners.
 */
(() => {
  const ATTRIBUTION_KEY = 'bottiz_attribution';

  function track(name, params = {}) {
    const detail = { name, params };
    document.dispatchEvent(new CustomEvent('bottiz:track', { detail }));
    if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: name, ...params });
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  }

  // Remember where the visitor first arrived from (utm_*, click ids, referrer) for this session.
  function attribution() {
    let stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY)); } catch { /* storage unavailable */ }
    if (stored) return stored;
    const utm = {};
    new URLSearchParams(location.search).forEach((value, key) => {
      if (/^(utm_|gclid$|fbclid$)/.test(key)) utm[key] = value.slice(0, 200);
    });
    stored = { utm, referrer: document.referrer.slice(0, 300), landingPath: location.pathname };
    try { sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(stored)); } catch { /* ignore */ }
    return stored;
  }

  // Every WhatsApp / phone contact click goes through here, so analytics can be wired in one place.
  function trackContactClick(source, channel = 'whatsapp') {
    track(`${channel}_click`, { source: source || 'inline', page: location.pathname });
  }

  // Clicks report themselves: an explicit data-track="event_name" wins, otherwise
  // form-opening CTAs, WhatsApp, phone and email links get a standard event.
  function eventFor(el) {
    if (el.dataset.track) return el.dataset.track;
    if (el.hasAttribute('data-open-form')) return 'cta_click';
    const href = el.getAttribute('href') || '';
    if (/wa\.me|whatsapp\.com/.test(href)) return 'whatsapp_click';
    if (href.startsWith('tel:')) return 'phone_click';
    if (href.startsWith('mailto:')) return 'email_click';
    return '';
  }
  document.addEventListener('click', (event) => {
    const contact = event.target.closest('a[href^="https://wa.me/"], a[href^="tel:"]');
    if (contact) return trackContactClick(contact.dataset.contactSource, contact.href.startsWith('tel:') ? 'phone' : 'whatsapp');
    const el = event.target.closest('[data-track], [data-open-form], a[href]');
    const name = el && eventFor(el);
    if (name) track(name, { page: location.pathname, label: (el.textContent || '').trim().slice(0, 40) });
  });

  attribution();
  window.BottizTrack = track;
  window.BottizTrack.attribution = attribution;
  window.trackContactClick = trackContactClick;
})();
