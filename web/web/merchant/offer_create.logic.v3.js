
/*! Foody — Offer Create Logic v3 (label-aware, minimal DOM edits) — 2025-08-17 */
(function(){
  const onReady = (fn)=>{
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 0);
    else document.addEventListener('DOMContentLoaded', fn);
  };
  onReady(initV3);

  function initV3(){
    const section = findSectionByTitle(/создать\s+оффер/i);
    if (!section) return;

    const titleInput = findInputByLabel(section, /названи/i) || findByPlaceholder(section, /набор|названи/i);
    const basePrice  = findInputByLabel(section, /(цена).*(базов)|^цена\b/i) || findByPlaceholder(section, /250/);
    const oldPrice   = findInputByLabel(section, /(старая).*(цен)|до\s*скид/i) || null;
    const qty        = findInputByLabel(section, /(остаток|количеств|шт)/i) || null;
    const expires    = findInputByLabel(section, /(действительно\s*до)/i) || null;
    const chips      = findDiscountChips(section);

    // 1) Перенести "Название" наверх (перед блоком с ценой)
    if (titleInput && basePrice){
      const titleBox = closestField(titleInput);
      const priceBox = closestField(basePrice);
      if (titleBox && priceBox && priceBox.parentElement){
        priceBox.parentElement.insertBefore(titleBox, priceBox); // вставим перед ценами
      }
    }

    // 2) Подпись к базовой цене
    if (basePrice){
      const box = closestField(basePrice);
      if (box){
        let hint = box.querySelector('.foody3-note[data-role="price-hint"]');
        if (!hint){
          hint = document.createElement('div');
          hint.className = 'foody3-note';
          hint.dataset.role = 'price-hint';
          hint.textContent = 'цена после скидки';
          box.appendChild(hint);
        }
      }
    }

    // 3) Поле "Срок годности продукта" перед "Действительно до"
    let bestBefore = null;
    if (expires){
      const expBox = closestField(expires);
      if (expBox && !section.querySelector('#foodyBestBefore')){
        const wrap = document.createElement('div');
        wrap.className = 'field foody3-span-2';
        wrap.innerHTML = `
          <label for="foodyBestBefore">Срок годности продукта</label>
          <input id="foodyBestBefore" type="datetime-local" placeholder="до какого времени продукт ок">
          <div class="foody3-note">Это подсказка для продавца; поле не уходит на сервер.</div>
        `;
        expBox.parentElement.insertBefore(wrap, expBox);
        bestBefore = wrap.querySelector('#foodyBestBefore');
      }
    }

    // 4) Резюме под формой
    const summaryEl = injectAfter(basePrice || oldPrice || qty || expires, `<div class="foody3-summary" id="foody3Summary"></div>`);
    const warnEl = injectAfter(expires || oldPrice || basePrice, `<div class="foody3-warn" id="foody3Warn" hidden></div>`);

    // 5) Синхронизация цен (чипсы −30…−90% и ручной ввод)
    let chosenDiscount = detectSelectedChip(chips) || null;
    let roundStep = 1;
    // маленький переключатель округления
    const roundCtl = injectAfter(basePrice, `<div class="foody3-inline foody3-span-2" id="foody3RoundCtl">
      <label>Округлять до:
        <label style="margin-left:6px;"><input type="radio" name="foody3-round" value="1" checked>1 ₽</label>
        <label style="margin-left:6px;"><input type="radio" name="foody3-round" value="5">5 ₽</label>
      </label>
    </div>`);
    if (roundCtl){
      roundCtl.querySelectorAll('input[name="foody3-round"]').forEach(r=>{
        r.addEventListener('change', ()=>{
          roundStep = parseInt(r.value,10) || 1;
          recalc('auto');
        });
      });
    }

    chips.forEach(ch => {
      ch.addEventListener('click', (e)=>{
        e.preventDefault();
        const d = parseChip(ch);
        if (typeof d === 'number' && oldPrice && basePrice){
          chosenDiscount = d;
          markChipSelected(chips, ch);
          const op = parseMoney(oldPrice.value);
          if (isFinite(op)){
            basePrice.value = fmtMoney(op * (1 - d/100), roundStep);
            updateSummary();
          }
        }
      });
    });

    if (oldPrice) ['input','change'].forEach(ev => oldPrice.addEventListener(ev, ()=>recalc('old')));
    if (basePrice) ['input','change'].forEach(ev => basePrice.addEventListener(ev, ()=>recalc('base')));
    if (qty) ['input','change'].forEach(ev => qty.addEventListener(ev, updateSummary));
    if (expires) ['change','blur'].forEach(ev => expires.addEventListener(ev, ensureValidity));

    if (bestBefore) ['change','blur'].forEach(ev => bestBefore.addEventListener(ev, ensureValidity));

    // safety on submit: подрежем ещё раз (и не трогаем другие обработчики)
    const form = expires ? expires.form : (basePrice && basePrice.form);
    if (form){
      form.addEventListener('submit', ensureValidity);
    }

    recalc('auto'); updateSummary(); ensureValidity();

    // --- helpers ---
    function recalc(source){
      const op = oldPrice ? parseMoney(oldPrice.value) : NaN;
      const bp = basePrice ? parseMoney(basePrice.value) : NaN;
      if (source === 'old' && isFinite(op) && typeof chosenDiscount === 'number' && basePrice){
        basePrice.value = fmtMoney(op * (1 - chosenDiscount/100), roundStep);
      } else if (source === 'base' && isFinite(op) && isFinite(bp)){
        const d = Math.max(0, Math.min(99.9, (1 - bp/op) * 100));
        chosenDiscount = Math.round(d);
        markChipByValue(chips, chosenDiscount);
      } else if (source === 'auto'){
        if (isFinite(op) && isFinite(bp)){
          const d = Math.max(0, Math.min(99.9, (1 - bp/op) * 100));
          chosenDiscount = Math.round(d);
          markChipByValue(chips, chosenDiscount);
        }
      }
    }

    function ensureValidity(e){
      const bb = getDate(bestBefore);
      const ea = getDate(expires);
      if (bb && ea && ea.getTime() > bb.getTime()){
        // clamp
        setDateTime(expires, bb);
        if (warnEl){
          warnEl.hidden = false;
          warnEl.textContent = '«Действительно до» не может быть позже срока годности — подправили автоматически.';
          setTimeout(()=>{ warnEl.hidden = true; }, 2500);
        }
        // не блокируем сабмит, просто правим значение
      }
    }

    function updateSummary(){
      if (!summaryEl) return;
      const op = oldPrice ? parseMoney(oldPrice.value) : NaN;
      const bp = basePrice ? parseMoney(basePrice.value) : NaN;
      const q  = qty ? (parseInt(qty.value,10) || 0) : 0;
      const d  = (isFinite(op) && isFinite(bp) && op>0) ? Math.round((1 - bp/op) * 100) : null;
      if (isFinite(bp) && q>0){
        const total = Math.round(bp) * q;
        const dtxt = (d!=null) ? ` (скидка ${d}%)` : '';
        summaryEl.textContent = `Итог: ${Math.round(bp)} ₽ × ${q} шт = ${total} ₽${dtxt}`;
      } else {
        summaryEl.textContent = '';
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
    return document.body;
  }
  function findInputByLabel(root, re){
    const labels = Array.from(root.querySelectorAll('label'));
    for (const lab of labels){
      const txt = (lab.textContent || '').trim();
      if (re.test(txt)){
        const forId = lab.getAttribute('for');
        if (forId){
          const el = root.querySelector('#'+CSS.escape(forId));
          if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return el;
        }
        const el2 = nextInput(lab);
        if (el2) return el2;
      }
    }
    return null;
  }
  function findByPlaceholder(root, re){
    const inputs = Array.from(root.querySelectorAll('input,textarea'));
    return inputs.find(el => re.test((el.placeholder||'')+'')) || null;
  }
  function nextInput(start){
    let el = start.nextElementSibling;
    while (el && !(el.matches && el.matches('input,textarea,select'))){
      el = el.nextElementSibling;
    }
    return el || null;
  }
  function closestField(el){
    return el.closest('.field, .row, .form-row, .grid, div') || el.parentElement;
  }
  function injectAfter(anchor, html){
    if (!anchor) return null;
    const box = closestField(anchor);
    if (!box || !box.parentElement) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const node = tmp.firstElementChild;
    box.parentElement.insertBefore(node, box.nextSibling);
    return node;
  }
  function findDiscountChips(root){
    const all = Array.from(root.querySelectorAll('button, .chip, .badge, .tag, .btn')).filter(el => /^-\d{2}%$/.test(clean(el.textContent)));
    return all;
  }
  function clean(s){ return (s||'').replace(/\s+/g,'').trim(); }
  function parseChip(el){ const m = clean(el.textContent).match(/^-(\d{2})%$/); return m ? parseInt(m[1],10) : null; }
  function detectSelectedChip(chips){
    const active = chips.find(ch => ch.classList.contains('active') || ch.classList.contains('selected'));
    return active ? parseChip(active) : null;
  }
  function markChipSelected(chips, el){ chips.forEach(c => c.classList.remove('active','selected')); el.classList.add('active'); }
  function markChipByValue(chips, val){
    const el = chips.find(c => parseChip(c) === val);
    if (!el) return chips.forEach(c => c.classList.remove('active','selected'));
    markChipSelected(chips, el);
  }

  // date helpers
  function getDate(el){
    if (!el || !el.value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return new Date(el.value+'T23:59:00');
    const d = new Date(el.value);
    return isNaN(d) ? null : d;
  }
  function setDateTime(el, d){
    if (!el || !d) return;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    el.value = `${y}-${m}-${da}T${hh}:${mm}`;
  }

  // money
  function parseMoney(v){
    if (v == null) return NaN;
    const s = String(v).replace(/\s+/g,'').replace(',', '.').replace(/[^\d.]/g,'');
    return parseFloat(s);
  }
  function fmtMoney(n, step){ const k = Math.max(1, step||1); return String(Math.round((n||0)/k)*k); }
})();
