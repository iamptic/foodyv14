
/*! Foody — Offer Create Logic v2 (label-aware) — 2025-08-17 */
(function(){
  const onReady = (fn)=>{
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 0);
    else document.addEventListener('DOMContentLoaded', fn);
  };

  onReady(initV2);

  function initV2(){
    // Найдём контейнер секции "Создать оффер" по заголовку
    const section = findSectionByTitle(/создать\s+оффер/i);
    if (!section) return;

    // Найдём поля по текстам лейблов
    const basePrice = findInputByLabel(section, /(цена).*(базов)|^цена\b/i) || null;        // "Цена (₽) — базовая"
    const oldPrice  = findInputByLabel(section, /(старая).*(цен)|до\s*скид/i) || null;     // "Старая цена (до скидки)"
    const qty       = findInputByLabel(section, /(остаток|количеств)/i) || null;           // "Остаток / Количество, шт"
    const expires   = findInputByLabel(section, /(действительно\s*до)/i) || null;          // "Действительно до"
    const chips     = findDiscountChips(section);                                          // [-30% ... -90%]

    if (!basePrice && !oldPrice) return; // нечего синхронизировать

    // Вставим контрол округления и резюме
    const ui = buildUI(section);
    let roundStep = 1; // 1 ₽ по умолчанию
    ui.rounders.forEach(r => r.addEventListener('change', ()=>{
      roundStep = parseInt(r.value, 10) || 1;
      // пересчитать с текущим состоянием
      recalcFrom('auto');
    }));

    let chosenDiscount = detectSelectedChip(chips) || null; // число в процентах

    // Слушатели на чипсы
    chips.forEach(ch => {
      ch.addEventListener('click', (e) => {
        e.preventDefault();
        const d = parseChip(ch);
        if (typeof d === 'number' && oldPrice){
          chosenDiscount = d;
          markChipSelected(chips, ch);
          // Пересчёт базовой цены
          const op = parseMoney(oldPrice.value);
          if (isFinite(op)){
            basePrice.value = fmtMoney(op * (1 - d/100), roundStep);
          }
          updateSummary();
        }
      });
    });

    // Слушатели на цены
    if (oldPrice) ['input','change'].forEach(ev => oldPrice.addEventListener(ev, ()=>{
      recalcFrom('old');
    }));
    if (basePrice) ['input','change'].forEach(ev => basePrice.addEventListener(ev, ()=>{
      recalcFrom('base');
    }));

    // Количество / срок действия → резюме/валидация
    if (qty) ['input','change'].forEach(ev => qty.addEventListener(ev, updateSummary));
    if (expires) ['change','blur'].forEach(ev => expires.addEventListener(ev, checkExpiresFuture));

    // Первичный запуск
    recalcFrom('auto');
    updateSummary();
    checkExpiresFuture();

    // --- helpers ---
    function recalcFrom(source){
      const op = oldPrice ? parseMoney(oldPrice.value) : NaN;
      const bp = basePrice ? parseMoney(basePrice.value) : NaN;

      if (source === 'old' && isFinite(op) && typeof chosenDiscount === 'number' && basePrice){
        basePrice.value = fmtMoney(op * (1 - chosenDiscount/100), roundStep);
      } else if (source === 'base' && isFinite(op) && isFinite(bp)){
        // вычислить скидку из цен
        const d = Math.max(0, Math.min(99.9, (1 - bp/op) * 100));
        chosenDiscount = Math.round(d);
        markChipByValue(chips, chosenDiscount); // если попадает в набор чипсов — подсветим
      } else if (source === 'auto'){
        // если обе цены заданы — вычислим скидку
        if (isFinite(op) && isFinite(bp)){
          const d = Math.max(0, Math.min(99.9, (1 - bp/op) * 100));
          chosenDiscount = Math.round(d);
          markChipByValue(chips, chosenDiscount);
        }
      }
      updateSummary();
    }

    function updateSummary(){
      if (!ui.summary) return;
      const op = oldPrice ? parseMoney(oldPrice.value) : NaN;
      const bp = basePrice ? parseMoney(basePrice.value) : NaN;
      const q  = qty ? (parseInt(qty.value,10) || 0) : 0;
      const d  = (isFinite(op) && isFinite(bp) && op>0) ? Math.round((1 - bp/op) * 100) : null;

      if (isFinite(bp) && q>0){
        const total = Math.round(bp) * q;
        const dtxt = (d!=null) ? ` (скидка ${d}%)` : '';
        ui.summary.textContent = `Итог: ${Math.round(bp)} ₽ × ${q} шт = ${total} ₽${dtxt}`;
      } else {
        ui.summary.textContent = '';
      }
    }

    function checkExpiresFuture(){
      if (!expires || !ui.warn) return;
      const t = parseDateTime(expires.value);
      if (!t || t.getTime() < Date.now()){
        ui.warn.hidden = false;
        ui.warn.textContent = 'Проверьте «Действительно до»: дата/время в прошлом.';
      } else {
        ui.warn.hidden = true;
        ui.warn.textContent = '';
      }
    }
  }

  // ==== DOM helpers ====
  function findSectionByTitle(reTitle){
    const all = Array.from(document.querySelectorAll('section, .section, .card, main, div'));
    for (const node of all){
      const titleEl = node.querySelector('h1,h2,h3,.card-title,.title,.section-title');
      const t = (titleEl && (titleEl.textContent||'').trim()) || '';
      if (reTitle.test(t)) return node;
    }
    // fallback: search globally
    return document.body;
  }

  function findInputByLabel(root, reLabel){
    // prefer label[for] mapping
    const labels = Array.from(root.querySelectorAll('label'));
    for (const lab of labels){
      const txt = (lab.textContent || '').trim();
      if (reLabel.test(txt)){
        const forId = lab.getAttribute('for');
        if (forId){
          const el = root.querySelector('#'+CSS.escape(forId));
          if (el && (el.tagName==='INPUT' || el.tagName==='TEXTAREA' || el.tagName==='SELECT')) return el;
        }
        // fallback: next input in DOM
        const el2 = nextInput(lab);
        if (el2) return el2;
      }
    }
    // fallback: scan inputs whose placeholder/title matches
    const inputs = Array.from(root.querySelectorAll('input, textarea, select'));
    for (const el of inputs){
      const s = ((el.placeholder || el.title || '')+'').trim();
      if (reLabel.test(s)) return el;
    }
    return null;
  }

  function nextInput(start){
    let el = start.nextElementSibling;
    while (el && !(el.matches && el.matches('input,textarea,select'))){
      el = el.nextElementSibling;
    }
    return el || null;
  }

  function findDiscountChips(root){
    const all = Array.from(root.querySelectorAll('button, .chip, .badge, .tag, .btn'));

    return all.filter(el => /^-\d{2}%$/.test(clean(el.textContent)));
  }
  function clean(s){ return (s||'').replace(/\s+/g,'').trim(); }
  function parseChip(el){
    const m = clean(el.textContent).match(/^-(\d{2})%$/);
    return m ? parseInt(m[1],10) : null;
  }
  function detectSelectedChip(chips){
    // если уже подсвечен классом active/selected
    const active = chips.find(ch => ch.classList.contains('active') || ch.classList.contains('selected'));
    if (active) return parseChip(active);
    return null;
  }
  function markChipSelected(chips, el){
    chips.forEach(c => c.classList.remove('active','selected'));
    el.classList.add('active');
  }
  function markChipByValue(chips, val){
    const el = chips.find(c => parseChip(c) === val);
    if (!el) return chips.forEach(c => c.classList.remove('active','selected'));
    markChipSelected(chips, el);
  }

  // parsing & formatting helpers
  function parseMoney(v){
    if (v == null) return NaN;
    const s = String(v).replace(/\s+/g,'').replace(',', '.').replace(/[^\d.]/g,'');
    return parseFloat(s);
  }
  function fmtMoney(n, step){
    if (!isFinite(n)) return '';
    const k = Math.max(1, step || 1);
    return String(Math.round(n / k) * k);
  }
  function parseDateTime(val){
    if (!val) return null;
    // support date or datetime-local
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val+'T23:59:00');
    const d = new Date(val);
    return isNaN(d) ? null : d;
  }
})();
