
/*! foody.validate.js — micro-validation + summary (v2, safer & idempotent) */
(function(){
  window.__FOODY_ENH_VERSION = 'mini2';
  const onReady=(fn)=>{ if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); };
  onReady(init); window.addEventListener('load', init);

  function init(){
    const form = document.querySelector('#create #offerForm, #create form');
    if (!form) return;

    const base  = form.querySelector('#offerOldPrice,[name="original_price"]');
    const final = form.querySelector('#offerPrice,[name="price"]');
    const qty   = form.querySelector('[name="qty_total"]');
    const ex    = form.querySelector('#expires_at,[name="expires_at"]');
    const bb    = form.querySelector('#best_before,#bestBefore');
    const err   = form.querySelector('#offerError');
    const chipsWrap = form.querySelector('#discountPresets');
    const chips = chipsWrap ? Array.from(chipsWrap.querySelectorAll('.chip')) : [];
    const disc  = form.querySelector('#discountPercent'); // может отсутствовать

    // description counter (max 160)
    const desc = form.querySelector('textarea[name="description"]');
    if (desc && !desc._foodyCounter){
      const cnt = document.createElement('div'); cnt.className='muted small'; cnt.style.textAlign='right';
      desc.insertAdjacentElement('afterend', cnt);
      const upd=()=>{ const n=(desc.value||'').length; cnt.textContent = `${n}/160`; cnt.style.color = (n>160)?'#ff7b7b':''; };
      desc.addEventListener('input', upd); upd(); desc._foodyCounter=cnt;
    }

    // remove stray +1/+2 chips if any (leave only "К закрытию")
    const expWrap = form.querySelector('#expirePresets');
    if (expWrap){
      expWrap.querySelectorAll('.chip').forEach(ch=>{
        if (ch.dataset.exp && /^\+\d+$/.test(ch.dataset.exp)) ch.remove();
      });
    }

    // summary line
    let summary = form.querySelector('#foodySummary');
    if (!summary){ summary = document.createElement('div'); summary.id='foodySummary'; summary.className='muted'; summary.style.marginTop='6px'; summary.style.fontWeight='600'; form.appendChild(summary); }

    const money = v => { if(v==null) return NaN; const s=String(v).replace(/\s+/g,'').replace(',','.').replace(/[^\d.]/g,''); return parseFloat(s); };
    const clamp = (n,min,max)=> Math.min(max, Math.max(min,n));
    const parseDate = val => { if(!val) return null; if(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(val)) return new Date(val.replace(' ','T')); if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val)) return new Date(val); const d=new Date(val); return isNaN(d)?null:d; };

    function markChip(val){ chips.forEach(x=> x.classList.toggle('active', parseInt(x.dataset.discount,10)===parseInt(val,10))); }

    function recalcFromDiscount(dVal){
      if (!base || !final) return;
      const b = money(base.value);
      const d = dVal!=null ? parseInt(dVal,10) : (disc ? parseInt(disc.value||'0',10) : NaN);
      if (isFinite(b) && isFinite(d)){
        final.value = String(Math.round(b * (1 - clamp(d,0,99)/100)));
      }
      if (disc && isFinite(d)) disc.value = String(clamp(d,0,99));
      markChip(d);
      updateSummary();
    }
    function recalcFromFinal(){
      if (!base || !final) return;
      const b = money(base.value), f = money(final.value);
      if (disc && isFinite(b) && isFinite(f) && b>0){
        const d = Math.round((1 - f/b)*100);
        disc.value = String(clamp(d,0,99));
        markChip(disc.value);
      }
      updateSummary();
    }
    function updateSummary(){
      const b = money(base && base.value), f = money(final && final.value), q = parseInt(qty && qty.value || '0',10) || 0;
      const d = (isFinite(b)&&isFinite(f)&&b>0)? Math.round((1 - f/b)*100) : null;
      if (isFinite(f) && q>0){
        const total = Math.round(f)*q;
        summary.textContent = `Итог: ${Math.round(f)} ₽ × ${q} шт = ${total} ₽` + (d!=null?` (скидка ${d}%)`:'');
      } else { summary.textContent = ''; }
    }

    // Bindings (idempotent)
    if (disc && !disc._bound){ disc.addEventListener('input', ()=>recalcFromDiscount()); disc.addEventListener('change', ()=>recalcFromDiscount()); disc._bound=true; }
    if (base && !base._bound){ base.addEventListener('input', ()=>recalcFromDiscount()); base.addEventListener('change', ()=>recalcFromDiscount()); base._bound=true; }
    if (final && !final._bound){ final.addEventListener('input', recalcFromFinal); final.addEventListener('change', recalcFromFinal); final._bound=true; }
    chips.forEach(ch=> !ch._bound && (ch._bound=true, ch.addEventListener('click', e=>{
      e.preventDefault(); const d=parseInt(ch.dataset.discount,10);
      if(!isFinite(d)) return;
      recalcFromDiscount(d);
    })));
    if (qty && !qty._bound){ qty.addEventListener('input', updateSummary); qty._bound=true; }

    // initial compute
    recalcFromDiscount();

    // Submit guard
    const formSubmit = (e)=>{
      if (err) err.classList.add('hidden');
      const issues=[];
      const b = money(base && base.value), f = money(final && final.value), q = parseInt(qty && qty.value || '0',10)||0;
      if (!(isFinite(b) && isFinite(f) && f < b)) issues.push('Новая цена должна быть меньше обычной.');
      if (!(q>0)) issues.push('Количество должно быть больше 0.');
      const now = new Date();
      const exDt = parseDate(ex && ex.value);
      if (!exDt || exDt <= now) issues.push('Срок действия оффера должен быть в будущем.');
      const bbDt = parseDate(bb && bb.value);
      if (exDt && bbDt && exDt > bbDt) issues.push('«Срок действия оффера» не может быть позже «Срока годности».');
      if (desc && desc.value && desc.value.length > 160) issues.push('Описание: максимум 160 символов.');
      if (issues.length){
        e.preventDefault();
        if (err){ err.textContent = issues[0]; err.classList.remove('hidden'); }
      }
    };
    if (!form._foodySubmitBound){ form.addEventListener('submit', formSubmit); form._foodySubmitBound=true; }
  }
})();
