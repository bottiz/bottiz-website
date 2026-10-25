/* Enquiry form (one shared component, rendered from src/partials/form.html).
 *
 *  - Validates on the client, with per-field messages (aria-invalid + aria-describedby).
 *  - POSTs JSON to the endpoint in data-endpoint (set in data/site.json or FORM_ENDPOINT).
 *    Until an endpoint is configured it falls back to opening the visitor's email client.
 *  - Honeypot field "website": bots fill it, humans never see it.
 *  - Always sends where the enquiry came from: page, industry, CTA, utm_* and referrer.
 *  - WhatsApp stays available as an alternative channel.
 */
(() => {
  const t = (text) => window.BottizI18n?.t(text) ?? text;
  const TIMEOUT_MS = 15000;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE = /^\+?[\d\s-]{8,16}$/;

  document.querySelectorAll('form[data-enquiry]').forEach(initForm);

  function initForm(form) {
    const track = (name, extra = {}) => window.BottizTrack?.(name, { form: form.dataset.form, industry: form.dataset.industry, ...extra });
    const statusEl = form.querySelector('.form-status');
    let statusKey = '';
    let lastCta = '';

    // ---- status line (re-translated when the language changes) -----------
    function setStatus(key, tone = 'info') {
      statusKey = key;
      statusEl.hidden = !key;
      statusEl.dataset.tone = tone;
      statusEl.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      statusEl.textContent = key ? t(key) : '';
    }
    document.addEventListener('bottiz:lang', () => { if (statusKey) statusEl.textContent = t(statusKey); });

    // ---- validation ------------------------------------------------------
    function errorFor(control) {
      const value = control.value.trim();
      if (control.type === 'checkbox') return control.required && !control.checked ? '請剔選同意，方可提交。' : '';
      if (control.required && !value) return '請填寫此欄。';
      if (control.type === 'email' && value && !EMAIL.test(value)) return '請輸入有效的電郵地址。';
      if (control.type === 'tel' && value && !PHONE.test(value)) return '請輸入有效的電話號碼。';
      return '';
    }

    function showError(control, message) {
      const box = document.getElementById(`${form.id}-e-${control.name}`);
      if (!box) return;
      box.textContent = message ? t(message) : '';
      box.hidden = !message;
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }

    function validate({ skipConsent = false } = {}) {
      let firstInvalid = null;
      form.querySelectorAll('input:not([type=hidden]):not([name=website]), textarea').forEach((control) => {
        if (skipConsent && control.name === 'consent') return;
        const message = errorFor(control);
        showError(control, message);
        if (message && !firstInvalid) firstInvalid = control;
      });
      firstInvalid?.focus();
      return !firstInvalid;
    }

    form.addEventListener('input', (event) => {
      if (event.target.hasAttribute('aria-invalid')) showError(event.target, errorFor(event.target));
    });
    form.addEventListener('change', (event) => {
      if (event.target.type === 'checkbox') showError(event.target, errorFor(event.target));
    });

    // ---- payload ---------------------------------------------------------
    const field = (name) => form.elements[name]?.value.trim() ?? '';

    function buildPayload() {
      const { utm, referrer, landingPath } = window.BottizTrack?.attribution?.() ?? {};
      return {
        form: form.dataset.form,
        name: field('name'),
        company: field('company'),
        email: field('email'),
        phone: field('phone'),
        inquiryType: field('inquiryType'),
        interest: field('interest'),
        message: field('message'),
        consent: Boolean(form.elements.consent?.checked),
        source: {
          pagePath: location.pathname,
          pageTitle: form.dataset.pageTitle,
          industry: form.dataset.industry || '',
          cta: lastCta,
          utm: utm || {},
          referrer: referrer || '',
          landingPath: landingPath || '',
          language: window.BottizI18n?.lang ?? 'zh-Hant',
        },
        submittedAt: new Date().toISOString(),
      };
    }

    // ---- submission ------------------------------------------------------
    function setBusy(busy) {
      form.dataset.state = busy ? 'submitting' : 'idle';
      form.setAttribute('aria-busy', String(busy));
      form.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    }

    // FormSubmit.co (email relay) wants flat fields; it emails them to the address in the endpoint URL.
    function toFormSubmit(payload) {
      const { source, ...fields } = payload;
      const flat = { ...fields, pagePath: source.pagePath, pageTitle: source.pageTitle, industry: source.industry, cta: source.cta, referrer: source.referrer, landingPath: source.landingPath, language: source.language, ...source.utm };
      return { ...flat, _subject: `BottiZ 網站查詢｜${payload.name}｜${form.dataset.pageTitle}`, _template: 'table', _captcha: 'false', _honey: '' };
    }

    async function postJson(payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(form.dataset.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(form.dataset.format === 'formsubmit' ? toFormSubmit(payload) : payload),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // FormSubmit answers 200 with {"success":"false"} when the address is not yet activated.
        const result = await response.json().catch(() => ({}));
        if (String(result.success) === 'false') throw new Error(result.message || 'Rejected by form service');
      } finally {
        clearTimeout(timer);
      }
    }

    function summaryLines(payload) {
      const label = (key) => form.querySelector(`label[for="${form.id}-${key}"]`)?.textContent.replace('*', '').trim() ?? key;
      return ['name', 'company', 'email', 'phone', 'inquiryType', 'interest', 'message']
        .filter((key) => payload[key])
        .map((key) => `${label(key)}：${payload[key]}`);
    }

    function openMailClient(payload) {
      const subject = `BottiZ 查詢｜${payload.name}`;
      const body = ['BottiZ 團隊您好：', '', ...summaryLines(payload)].join('\n');
      window.location.href = `mailto:${form.dataset.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.state === 'submitting') return;
      if (!validate()) return track('form_validation_error');

      if (form.elements.website.value) {   // honeypot tripped: pretend it worked, send nothing
        setStatus('已收到您的查詢，我們會盡快與您聯絡。', 'success');
        return form.reset();
      }

      const payload = buildPayload();
      track('form_submit', { status: 'attempt' });
      setStatus('提交中⋯⋯');
      setBusy(true);
      try {
        if (form.dataset.endpointReady === 'true') {
          await postJson(payload);
          setStatus('已收到您的查詢，我們會盡快與您聯絡。', 'success');
          form.reset();
          form.querySelector('.form-wa-hint')?.removeAttribute('hidden');
          if (form.dataset.download) startDownload(form.dataset.download);
        } else {
          openMailClient(payload);
          setStatus('已開啟電郵應用，請確認內容後按「傳送」。', 'success');
        }
        track('form_submit_success');
      } catch (error) {
        console.error('Enquiry submit failed', error);
        setStatus('提交未成功，請稍後再試，或改用 WhatsApp 與我們聯絡。', 'error');
        track('form_submit_error');
      } finally {
        setBusy(false);
      }
    });

    form.querySelector('[data-whatsapp-submit]')?.addEventListener('click', () => {
      if (!validate({ skipConsent: true })) return;
      const payload = buildPayload();
      const text = [t('BottiZ 團隊您好：'), '', ...summaryLines(payload)].join('\n');
      window.trackContactClick?.('form');
      window.open(`https://wa.me/${form.dataset.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      setStatus('已開啟 WhatsApp，請確認內容後按「傳送」。', 'success');
    });

    function startDownload(url) {
      const link = Object.assign(document.createElement('a'), { href: url, download: '' });
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    form.addEventListener('bottiz:form-open', (event) => {
      lastCta = event.detail.cta;
      setStatus('');
      form.querySelector('.form-wa-hint')?.setAttribute('hidden', '');
      track('form_open', { cta: lastCta });
    });
  }
})();
