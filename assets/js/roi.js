/* ROI estimator. calculateRoi() is a pure function (no DOM) so the formulas can be
 * tested or changed on their own; everything below it only reads inputs and paints results.
 * Inputs, results and assumptions come from data/roi.json (embedded as #roi-config).
 */
(() => {
  const form = document.getElementById('roiForm');
  const configNode = document.getElementById('roi-config');
  if (!form || !configNode) return;

  const config = JSON.parse(configNode.textContent);
  const t = (text) => window.BottizI18n?.t(text) ?? text;

  function calculateRoi(values, { assumptions }) {
    const { headcount, monthlySalary, hoursPerDay, replaceShare, investment, monthlyRunningCost, workingDays } = values;
    if ([headcount, monthlySalary, replaceShare].some((v) => v === null)) return null;
    const share = replaceShare / 100;
    const days = workingDays || assumptions.fallbackWorkingDays;
    const labourCost = headcount * monthlySalary;
    const netMonthlySaving = labourCost * share - (monthlyRunningCost || 0);
    return {
      labourCost,
      coveredHours: hoursPerDay === null ? null : headcount * hoursPerDay * days * share,
      netMonthlySaving,
      annualSaving: netMonthlySaving * assumptions.monthsPerYear,
      paybackMonths: investment > 0 && netMonthlySaving > 0 ? investment / netMonthlySaving : null,
    };
  }

  const formatters = {
    currency: new Intl.NumberFormat('zh-HK', { style: 'currency', currency: 'HKD', maximumFractionDigits: 0 }),
    number: new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 1 }),
  };
  const format = { currency: (v) => formatters.currency.format(v), hours: (v) => formatters.number.format(v), months: (v) => formatters.number.format(v) };

  const readInput = (input) => {
    const raw = form.elements[input.key].value.trim();
    if (raw === '') return null;
    const number = Number(raw);
    const outOfRange = !Number.isFinite(number) || number < (input.min ?? -Infinity) || number > (input.max ?? Infinity);
    form.elements[input.key].toggleAttribute('aria-invalid', outOfRange);
    return outOfRange ? null : number;
  };

  const noteEl = document.getElementById('roiNote');
  let noteKey = '';
  const setNote = (key) => { noteKey = key; noteEl.textContent = key ? t(key) : ''; };
  document.addEventListener('bottiz:lang', () => setNote(noteKey));

  let reported = false;
  function update() {
    const values = Object.fromEntries(config.inputs.map((input) => [input.key, readInput(input)]));
    const result = calculateRoi(values, config);
    config.results.forEach(({ key, format: kind }) => {
      const target = document.querySelector(`[data-result="${key}"]`);
      const value = result?.[key];
      target.textContent = value === null || value === undefined ? '—' : format[kind](value);
    });
    if (!result) setNote('請先填寫現有人手數目、平均月薪及分擔比例，以計算估算結果。');
    else if (result.paybackMonths === null) setNote(values.investment ? '按目前輸入，每月節省未能覆蓋成本，未能計算回本期。' : '未填寫預計投資，未能計算回本期。');
    else setNote('');
    if (result && !reported) { reported = true; window.BottizTrack?.('roi_calculate'); }
  }

  form.addEventListener('input', update);
  form.addEventListener('submit', (event) => event.preventDefault());
  update();
  window.BottizRoi = { calculateRoi };
})();
