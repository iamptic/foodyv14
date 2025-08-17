
/*! Foody — Offer Create Logic (minimal/safe) — 2025-08-17 */
(function(){
  const onReady = (fn)=>{
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 0);
    else document.addEventListener('DOMContentLoaded', fn);
  };

  onReady(init);

  function init(){
    // Form detection
    const form = document.querySelector('#offerForm') ||
                 Array.from(document.querySelectorAll('form')).find(f => /offers?/i.test(f.action||'') || f.id==='createOffer' || f.dataset.role==='offer-create') ||
                 null;
    if (!form) return;

    const $ = sel => form.querySelector(sel);
    const firstNonNull = (arr)=> arr.find(Boolean) || null;

    // Fields (robust selectors)
    const title = firstNonNull([
      $('[name="title"]'), $('#offerTitle'), $('[name*="name"]')
    ]);
    const priceBase = firstNonNull([
      $('[name="price"]'), $('#offerPrice'), $('[name*="base"]'), $('[name*="истин"]'), $('[name*="price_base"]')
    ]);
    const discountPct = firstNonNull([
      $('[name="discount_percent"]'), $('#offerDiscount'), $('[name*="discount"]'), $('[name*="скид"]')
    ]);
    const priceFinal = firstNonNull([
      $('[name="final_price"]'), $('#offerFinalPrice'), $('[name*="after"]'), $('[name*="final"]')
    ]);
    const quantity = firstNonNull([
      $('[name="quantity"]'), $('#offerQuantity'), $('[name*="qty"]')
    ]);
    const bestBefore = firstNonNull([
      $('[name="best_before"]'), $('#offerBestBefore'), $('[name*="годн"]'), $('[name*="shelf"]'), $('[name*="fresh"]')
    ]);
    const expiresAt = firstNonNull([
      $('[name="expires_at"]'), $('#offerExpiresAt'), $('[name*="valid"]'), $('[name*="действ"]')
    ]);
    const description = firstNonNull([
      $('[name="description"]'), $('#offerDescription'), $('[name*="desc"]')
    ]);

    // Add rounder UI near priceFinal if present
    let roundStep = 1; // default 1 ₽
    if (priceFinal){
      const wrap = document.createElement('div');
      wrap.className = 'foody-offer-inline foody-span-2';
      wrap.innerHTML = `
        <label class="foody-rounder" title="Округлять итоговую цену">
          Округлять до:
          <label><input type="radio" name="foody-round" value="1" checked>1 ₽</label>
          <label><input type="radio" name="foody-round" value="5">5 ₽</label>
        </label>
        <span class="foody-note">Правишь скидку — считаем цену. Правишь цену — пересчитываем скидку.</span>
        <div class="foody-summary" id="foodySummary" style="margin-left:auto;"></div>
      `;
      // insert after final price field's container if possible
      const container = priceFinal.closest('.field, .row, .form-row, .grid, div') || priceFinal.parentElement;
      if (container && container.parentElement) container.parentElement.insertBefore(wrap, container.nextSibling);
      else form.appendChild(wrap);

      Array.from(wrap.querySelectorAll('input[name="foody-round"]')).forEach(r=>{
        r.addEventListener('change', ()=>{
          roundStep = parseInt(r.value,10) || 1;
          // reapply rounding based on last edit
          lastChanged === 'final' ? recalcFromFinal() : recalcFromDiscount();
        });
      });
    }

    // Summary and warn holders
    const summaryEl = form.querySelector('#foodySummary') || createBelow(form, priceFinal || discountPct, '<div class="foody-summary" id="foodySummary"></div>');
    const warnEl = createBelow(form, expiresAt || bestBefore, '<div class="foody-warn" id="foodyWarn" hidden></div>');

    // Helpers
    const parseMoney = (v)=>{
      if (v == null) return NaN;
      const s = String(v).replace(/\s+/g,'').replace(',', '.').replace(/[^\d.]/g,'');
      return parseFloat(s);
    };
    const fmtMoney = (n)=>{
      if (!isFinite(n)) return '';
      const val = (Math.round(n / roundStep) * roundStep);
      return String(val.toFixed(0));
    };
    const clamp = (n, min, max)=> Math.min(max, Math.max(min, n));

    let lock = false;
    let lastChanged = 'discount'; // initial

    function recalcFromDiscount(){
      if (lock) return;
      if (!priceBase || !discountPct || !priceFinal) return;
      lock = true;
      const base = parseMoney(priceBase.value);
      const d = parseMoney(discountPct.value);
      if (isFinite(base) && isFinite(d)){
        const final = base * (1 - clamp(d,0,99.9)/100);
        priceFinal.value = fmtMoney(final);
      }
      lock = false;
      updateSummary();
    }

    function recalcFromFinal(){
      if (lock) return;
      if (!priceBase || !discountPct || !priceFinal) return;
      lock = true;
      const base = parseMoney(priceBase.value);
      const fin = parseMoney(priceFinal.value);
      if (isFinite(base) && isFinite(fin) && base>0){
        const d = (1 - fin/base) * 100;
        discountPct.value = String(Math.round(clamp(d,0,99.9)));
      }
      lock = false;
      updateSummary();
    }

    function updateSummary(){
      if (!summaryEl) return;
      const base = priceBase ? parseMoney(priceBase.value) : NaN;
      const d = discountPct ? parseMoney(discountPct.value) : NaN;
      const fin = priceFinal ? parseMoney(priceFinal.value) : (isFinite(base)&&isFinite(d) ? base*(1-d/100) : NaN);
      const qty = quantity ? parseInt(quantity.value,10) || 0 : 0;
      if (isFinite(fin) && qty>0){
        const total = fin * qty;
        const dshow = isFinite(d) ? ` (скидка ${Math.round(d)}%)` : '';
        summaryEl.textContent = `Итог: ${Math.round(fin)} ₽ × ${qty} шт = ${Math.round(total)} ₽${dshow}`;
      } else {
        summaryEl.textContent = '';
      }
    }

    function dateValue(el){
      if (!el || !el.value) return null;
      // support both date and datetime-local
      const val = el.value.trim();
      // If only date
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val + 'T23:59:00');
      // If datetime-local
      const d = new Date(val);
      return isNaN(d) ? null : d;
    }

    function ensureValidityWindow(){
      if (!bestBefore || !expiresAt) return;
      const bb = dateValue(bestBefore);
      const ea = dateValue(expiresAt);
      if (bb && ea && ea > bb){
        // cut expiresAt to bestBefore
        const y = bb.getFullYear();
        const m = String(bb.getMonth()+1).padStart(2,'0');
        const d = String(bb.getDate()).padStart(2,'0');
        const hh = String(bb.getHours()).padStart(2,'0');
        const mm = String(bb.getMinutes()).padStart(2,'0');
        const val = `${y}-${m}-${d}T${hh}:${mm}`;
        expiresAt.value = val;
        if (warnEl){
          warnEl.hidden = false;
          warnEl.textContent = 'Срок действия оффера не может быть позже срока годности — поправили автоматически.';
          setTimeout(()=>{ warnEl.hidden = true; }, 3000);
        }
      }
    }

    // Listeners
    if (discountPct) ['input','change'].forEach(ev => discountPct.addEventListener(ev, ()=>{ lastChanged='discount'; recalcFromDiscount(); }));
    if (priceFinal) ['input','change'].forEach(ev => priceFinal.addEventListener(ev, ()=>{ lastChanged='final'; recalcFromFinal(); }));
    if (priceBase) ['input','change'].forEach(ev => priceBase.addEventListener(ev, ()=>{ lastChanged==='final' ? recalcFromFinal() : recalcFromDiscount(); }));
    if (quantity) ['input','change'].forEach(ev => quantity.addEventListener(ev, updateSummary));
    if (bestBefore) ['change','blur'].forEach(ev => bestBefore.addEventListener(ev, ensureValidityWindow));
    if (expiresAt) ['change','blur'].forEach(ev => expiresAt.addEventListener(ev, ensureValidityWindow));

    // Initial compute
    recalcFromDiscount();
    updateSummary();
    ensureValidityWindow();
  }

  function createBelow(form, anchorEl, html){
    try{
      if (!anchorEl) return null;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const node = tmp.firstElementChild;
      const container = anchorEl.closest('.field, .row, .form-row, .grid, div') || anchorEl.parentElement;
      if (container && container.parentElement) container.parentElement.insertBefore(node, container.nextSibling);
      else form.appendChild(node);
      return node;
    }catch(_){ return null; }
  }
})();
