/* Shared page behaviour: mobile nav, enquiry modal, product filters, WhatsApp button. */
(() => {
  const WHATSAPP_URL =
    'https://api.whatsapp.com/send/?phone=85295335639&text=%E4%BD%A0%E5%A5%BD%20BottiZ%EF%BC%81%E6%88%91%E6%83%B3%E6%9F%A5%E8%A9%A2%E6%A9%9F%E6%A2%B0%E4%BA%BA%E6%96%B9%E6%A1%88%E4%BB%A5%E5%8F%8A%E9%A0%90%E7%B4%84Demo';
  const WHATSAPP_ICON =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L0 24l6.5-1.7a11.8 11.8 0 0 0 5.6 1.4h.1C18.7 23.7 24 18.4 24 11.9a11.8 11.8 0 0 0-3.5-8.4zM12.2 21.7h-.1a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 1 1 8.5 4.7zm5.4-7.3c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.7.1-1.9-.9-3.2-1.7-4.5-3.8-.3-.6.3-.5.9-1.7.1-.2.1-.4 0-.6l-.9-2.2c-.2-.5-.5-.4-.7-.4h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.4 1.4 3.6c.2.2 2.4 3.7 5.9 5.2.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4z"></path></svg>';

  // ---- mobile navigation -----------------------------------------------
  function toggleNav(button) {
    const open = document.getElementById('navLinks')?.classList.toggle('open');
    button.setAttribute('aria-expanded', String(Boolean(open)));
  }

  // ---- enquiry modal / inline form -------------------------------------
  let lastFocus = null;
  const modal = () => document.getElementById('contactModal');

  function openForm(interest, trigger) {
    const form = document.getElementById('inquiryForm');
    if (!form) return;
    if (interest && form.elements.interest) form.elements.interest.value = interest;
    form.dispatchEvent(new CustomEvent('bottiz:form-open', { detail: { cta: trigger?.dataset.track || '' } }));
    const dialog = modal();
    if (dialog) {
      lastFocus = document.activeElement;
      dialog.classList.add('open');
      document.body.style.overflow = 'hidden';
      dialog.querySelector('input:not([type=hidden]), select, textarea')?.focus();
    } else {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.querySelector('input:not([type=hidden])')?.focus({ preventScroll: true });
    }
  }

  function closeModal() {
    const dialog = modal();
    if (!dialog?.classList.contains('open')) return;
    dialog.classList.remove('open');
    document.body.style.overflow = '';
    lastFocus?.focus();
  }

  function trapFocus(event) {
    const dialog = modal();
    if (event.key !== 'Tab' || !dialog?.classList.contains('open')) return;
    const items = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea')]
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav-toggle]');
    if (nav) return toggleNav(nav);
    const open = event.target.closest('[data-open-form]');
    if (open) return openForm(open.dataset.openForm, open);
    if (event.target.closest('[data-close-modal]') || event.target === modal()) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
    trapFocus(event);
  });

  // ---- product filters (products.html, insights.html) ------------------
  function applyFilter(filter) {
    document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
    document.querySelectorAll('.card').forEach((card) => {
      const categories = (card.dataset.category || '').split(/\s+/);
      card.style.display = filter === 'all' || categories.includes(filter) ? '' : 'none';
    });
  }
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => applyFilter(button.dataset.filter)));
  const hashFilter = location.hash.slice(1);
  if (hashFilter && document.querySelector(`.filter[data-filter="${hashFilter}"]`)) {
    applyFilter(hashFilter);
    document.getElementById('products')?.scrollIntoView({ block: 'start' });
  }

  // ---- floating WhatsApp button (shown on tablet/mobile via CSS) -------
  const whatsapp = document.createElement('a');
  whatsapp.className = 'whatsapp-float';
  whatsapp.href = WHATSAPP_URL;
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener';
  whatsapp.setAttribute('aria-label', 'WhatsApp 查詢');
  whatsapp.dataset.track = 'whatsapp_float_click';
  whatsapp.innerHTML = WHATSAPP_ICON;
  document.body.appendChild(whatsapp);
})();
