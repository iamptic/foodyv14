
/* offer_create.order.js — аккуратная логика: скидка ↔ новая цена + контроль дат */
(function(){
  const form=document.getElementById('offerForm'); if(!form) return;
  const base = document.getElementById('offerOldPrice');     // обычная
  const final= document.getElementById('offerPrice');        // новая
  const disc = document.getElementById('discountPercent');   // %
  const chips= Array.from(document.querySelectorAll('#discountPresets .chip'));
  const best = document.getElementById('bestBefore');
  const exp  = document.getElementById('expires_at');

  const money = v => { if(v==null) return NaN; const s=String(v).replace(/\s+/g,'').replace(',','.').replace(/[^\d.]/g,''); return parseFloat(s); };
  const clamp = (n,min,max)=> Math.min(max, Math.max(min,n));
  const roundRuble = n => Math.round(n); // Округлять ДО убрали полностью — просто ₽

  function markChip(d){
    chips.forEach(x=>x.classList.toggle('active', parseInt(x.dataset.discount,10)===parseInt(d,10)));
  }

  function fromDisc(){
    const b=money(base.value), d=parseInt(disc.value||'0',10);
    if (isFinite(b) && isFinite(d)){
      final.value = String(roundRuble(b * (1 - clamp(d,0,99)/100)));
      markChip(d);
    }
  }
  function fromFinal(){
    const b=money(base.value), f=money(final.value);
    if (isFinite(b) && isFinite(f) && b>0){
      const d = Math.round((1 - f/b)*100);
      disc.value = String(clamp(d,0,99));
      markChip(disc.value);
    }
  }

  chips.forEach(ch=> ch.addEventListener('click', e=>{
    e.preventDefault(); const d=parseInt(ch.dataset.discount,10);
    if (!isFinite(d)) return;
    disc.value = String(d);
    fromDisc();
  }));
  ['input','change'].forEach(ev=> disc.addEventListener(ev, fromDisc));
  ['input','change'].forEach(ev=> base.addEventListener(ev, fromDisc));
  ['input','change'].forEach(ev=> final.addEventListener(ev, fromFinal));

  function parseDate(val){ if(!val) return null; if(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(val)) return new Date(val.replace(' ','T')); if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return new Date(val); const d=new Date(val); return isNaN(d)?null:d; }
  function fmt(d){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),da=String(d.getDate()).padStart(2,'0'),h=String(d.getHours()).padStart(2,'0'),mi=String(d.getMinutes()).padStart(2,'0'); return `${y}-${m}-${da} ${h}:${mi}`; }

  function guardDates(){
    const ea=parseDate(exp.value), bb=best && parseDate(best.value);
    if (ea && bb && ea.getTime()>bb.getTime()){
      exp.value = fmt(bb); // автообрезка до срока годности
    }
  }
  if (best && exp){
    ['change','blur','input'].forEach(ev=> best.addEventListener(ev, guardDates));
    ['change','blur','input'].forEach(ev=> exp.addEventListener(ev, guardDates));
  }
})();
