/* Shared page behaviour: mobile nav, enquiry modal, product filters. */
(() => {

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

})();
