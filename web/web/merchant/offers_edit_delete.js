
/*! Foody Offers — render list with Edit/Delete and call backend */
(function(){
  function ready(fn){ if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); }
  function apiBase(){ return (window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || ''; }
  function rid(){ try { return localStorage.getItem('foody_restaurant_id') || ''; } catch(_){ return ''; } }
  function key(){ try { return localStorage.getItem('foody_key') || ''; } catch(_){ return ''; } }
  function qs(s,r=document){ return r.querySelector(s); }
  function qsa(s,r=document){ return Array.from(r.querySelectorAll(s)); }
  function fmtDate(v){ if(!v) return '—'; try{ const d=new Date(v); return isNaN(d)?'—':d.toLocaleString('ru-RU'); }catch(_){ return '—'; } }

  async function fetchOffers(){
    const base = apiBase(); const rID = rid(); const k = key();
    if(!base || !rID || !k) return [];
    const res = await fetch(base.replace(/\/+$/,'') + '/api/v1/merchant/offers?restaurant_id=' + encodeURIComponent(rID), {
      headers: { 'X-Foody-Key': k }
    });
    if(!res.ok) return [];
    return await res.json();
  }

  function render(items){
    const root = qs('#offerList'); if(!root) return;
    if(!Array.isArray(items) || !items.length){ root.innerHTML = '<div class="hint">Пока нет офферов</div>'; return; }
    const rows = items.map(o => {
      const price = o.price_cents!=null ? o.price_cents/100 : (o.price!=null ? Number(o.price) : 0);
      const old   = o.original_price_cents!=null ? o.original_price_cents/100 : (o.original_price!=null ? Number(o.original_price) : 0);
      const disc  = old>0 ? Math.round((1 - price/old)*100) : 0;
      return `<div class="row" data-offer-id="${o.id}">
        <div>${o.title || '—'}</div>
        <div>${price.toFixed(2)}</div>
        <div>${disc?`-${disc}%`:'—'}</div>
        <div>${o.qty_left ?? '—'} / ${o.qty_total ?? '—'}</div>
        <div>${fmtDate(o.expires_at)}</div>
        <div class="actions">
          <button class="btn btn-ghost" data-action="edit-offer">Редактировать</button>
          <button class="btn btn-danger" data-action="delete-offer">Удалить</button>
        </div>
      </div>`;
    }).join('');
    // header
    root.innerHTML = `<div class="row head">
      <div>Название</div><div>Цена</div><div>Скидка</div><div>Остаток</div><div>Истекает</div><div></div>
    </div>` + rows;
  }

  function openEdit(o){
    const modal = qs('#offerEditModal'); if(!modal) return;
    modal.style.display='block';
    qs('#editId').value = o.id;
    qs('#editTitle').value = o.title || '';
    qs('#editOld').value = (o.original_price_cents!=null ? (o.original_price_cents/100) : (o.original_price ?? '')) || '';
    qs('#editPrice').value = (o.price_cents!=null ? (o.price_cents/100) : (o.price ?? '')) || '';
    qs('#editQty').value = o.qty_total ?? '';
    qs('#editExpires').value = o.expires_at ? o.expires_at.replace('T',' ').slice(0,16) : '';
    qs('#editCategory').value = o.category || 'ready_meal';
    qs('#editDesc').value = o.description || '';
    bindEditDiscounts();
    bindEditDateGuard();
  }
  function closeEdit(){ const m = qs('#offerEditModal'); if(m) m.style.display='none'; }

  function bindActions(items){
    const root = qs('#offerList'); if(!root) return;
    root.addEventListener('click', async function(e){
      const row = e.target.closest('.row'); if(!row) return;
      const id = row.getAttribute('data-offer-id');
      const act = e.target.getAttribute('data-action');
      if(!act || !id) return;

      const item = items.find(x => String(x.id) === String(id));
      if(act==='edit-offer'){ openEdit(item); }
      if(act==='delete-offer'){
        if(!confirm('Удалить оффер «'+(item.title||'')+'»?')) return;
        try{
          let __ok=false, __err=null;
async function updateOfferChain(list){
  for (const opt of list){
    try{
      const r = await fetch(opt.url, opt.init);
      if (r.ok) { __ok = true; return r; }
      __err = r; if (r.status===404 || r.status===405) continue; // попробуем следующую схему
      return r; // другие ошибки — выходим
    }catch(e){ __err=e; }
  }
  if (__err) throw __err; throw new Error('update failed');
}
const __base = apiBase().replace(/\/+$/,''); const __rid = encodeURIComponent(rid());
const res = await updateOfferChain([
  { url: `${__base}/api/v1/merchant/offers/${id}?restaurant_id=${__rid}`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers/${id}`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers/${id}?restaurant_id=${__rid}`, init: { method:'PATCH', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify({ id, ...payload }) } }
]);
            method:'DELETE', headers:{ 'X-Foody-Key': key() }
          });
          if(!res.ok) throw new Error('HTTP '+res.status);
          await load(); // reload
        }catch(err){ alert('Не удалось удалить: ' + err.message); }
      }
    });

    // modal form
    const form = qs('#offerEditForm');
    const cancel = qs('#offerEditCancel');
    if(cancel) cancel.addEventListener('click', function(ev){ ev.preventDefault(); closeEdit(); });
    if(form) form.addEventListener('submit', async function(ev){
      ev.preventDefault();
      const id = qs('#editId').value;
      const payload = {
        title: qs('#editTitle').value || null,
        original_price: qs('#editOld').value ? Number(qs('#editOld').value) : null,
        price: qs('#editPrice').value ? Number(qs('#editPrice').value) : null,
        qty_total: qs('#editQty').value ? Number(qs('#editQty').value) : null,
        expires_at: (dtLocalToIso(qs('#editExpires').value) || qs('#editExpires').value || null),
        category: qs('#editCategory').value || null,
        description: qs('#editDesc').value || null,
      };
      try{
        let __ok=false, __err=null;
async function updateOfferChain(list){
  for (const opt of list){
    try{
      const r = await fetch(opt.url, opt.init);
      if (r.ok) { __ok = true; return r; }
      __err = r; if (r.status===404 || r.status===405) continue; // попробуем следующую схему
      return r; // другие ошибки — выходим
    }catch(e){ __err=e; }
  }
  if (__err) throw __err; throw new Error('update failed');
}
const __base = apiBase().replace(/\/+$/,''); const __rid = encodeURIComponent(rid());
const res = await updateOfferChain([
  { url: `${__base}/api/v1/merchant/offers/${id}?restaurant_id=${__rid}`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers/${id}`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers/${id}?restaurant_id=${__rid}`, init: { method:'PATCH', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify(payload) } },
  { url: `${__base}/api/v1/merchant/offers`, init: { method:'PUT', headers:{ 'Content-Type':'application/json', 'X-Foody-Key': key() }, body: JSON.stringify({ id, ...payload }) } }
]);
          method:'PUT',
          headers: { 'Content-Type':'application/json', 'X-Foody-Key': key() },
          body: JSON.stringify(payload)
        });
        if(!res.ok) throw new Error('HTTP '+res.status);
        closeEdit();
        await load();
      }catch(err){ alert('Не удалось сохранить: ' + err.message); }
    });
  }

  
  function dtLocalToIso(v){
    if (!v) return null;
    try {
      var parts = v.includes('T') ? v.split('T') : v.split(' ');
      var d = parts[0].split('-'); var t = (parts[1]||'00:00').split(':');
      var Y = parseInt(d[0],10), M = parseInt(d[1],10)-1, D = parseInt(d[2],10);
      var h = parseInt(t[0],10)||0, m = parseInt(t[1],10)||0;
      var dt = new Date(Y,M,D,h,m);
      return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16)+':00Z';
    } catch(_) { return null; }
  }
async function load(){
    try {
      const items = await fetchOffers();
      render(items);
      bindActions(items);
    } catch(e) {}
  }

  function hookTab(){
    document.addEventListener('click', function(e){
      if (e.target.closest('[data-tab="offers"]')) { setTimeout(load, 50); }
    }, true);
  }


  /* --- Bind discount controls in Edit modal (same as Create) --- */
  function bindEditDiscounts(){
    const base = qs('#editOld');
    const final = qs('#editPrice');
    const disc = qs('#editDiscountPercent');
    const chipsWrap = qs('#editDiscountPresets');
    const chips = chipsWrap ? Array.from(chipsWrap.querySelectorAll('.chip')) : [];
    const money = v => { if(v==null) return NaN; const s=String(v).replace(/\s+/g,'').replace(',', '.').replace(/[^\d.]/g,''); return parseFloat(s); };
    const clamp = (n,min,max)=> Math.min(max, Math.max(min, n));
    function markChip(d){
      chips.forEach(c => c.classList.toggle('active', String(c.dataset.discount) === String(d)));
    }
    function recalcFromDiscount(){
      const b = money(base && base.value);
      const d = parseInt(disc && disc.value, 10);
      if (isFinite(b) && isFinite(d)){
        const f = Math.round(b * (1 - d/100));
        if (final) final.value = String(f);
        markChip(d);
      }
    }
    function recalcFromFinal(){
      const b = money(base && base.value), f = money(final && final.value);
      if (isFinite(b) && isFinite(f) && b>0){
        const d = Math.round((1 - f/b)*100);
        if (disc) disc.value = String(clamp(d,0,99));
        markChip(d);
      }
    }
    if (disc && !disc._edBound){ disc.addEventListener('input', recalcFromDiscount); disc.addEventListener('change', recalcFromDiscount); disc._edBound = true; }
    if (base && !base._edBound){ base.addEventListener('input', recalcFromDiscount); base.addEventListener('change', recalcFromDiscount); base._edBound = true; }
    if (final && !final._edBound){ final.addEventListener('input', recalcFromFinal); final.addEventListener('change', recalcFromFinal); final._edBound = true; }
    chips.forEach(ch => { if (!ch._edBound){ ch._edBound = true; ch.addEventListener('click', (e)=>{ e.preventDefault(); const d = parseInt(ch.dataset.discount,10); if (!isFinite(d)) return; if (disc) disc.value = String(d); recalcFromDiscount(); }); } });
  }

  /* --- Validate: editExpires must not exceed editBestBefore --- */
  function bindEditDateGuard(){
    const ex = qs('#editExpires');
    const bb = qs('#editBestBefore');
    if (!ex) return;
    function parseLocal(s){
      if (!s) return null;
      try {
        const parts = s.includes('T') ? s.split('T') : s.split(' ');
        const [Y,M,D] = parts[0].split('-').map(x=>parseInt(x,10));
        const [h,m] = (parts[1]||'00:00').split(':').map(x=>parseInt(x,10));
        return new Date(Y, (M-1), D, h||0, m||0, 0, 0);
      } catch(_){ return null; }
    }
    function guard(){
      const dEx = parseLocal(ex.value);
      const dBb = parseLocal(bb && bb.value);
      if (dEx && dBb && dEx.getTime() > dBb.getTime()){
        // clamp to best-before
        const y=dBb.getFullYear(), mo=String(dBb.getMonth()+1).padStart(2,'0'), da=String(dBb.getDate()).padStart(2,'0');
        const hh=String(dBb.getHours()).padStart(2,'0'), mi=String(dBb.getMinutes()).padStart(2,'0');
        ex.value = `${y}-${mo}-${da} ${hh}:${mi}`;
      }
    }
    ['input','change','blur'].forEach(ev => { ex.addEventListener(ev, guard); if (bb) bb.addEventListener(ev, guard); });
  }

  // auto-run if offers list is visible now
  function visible(el){ if(!el) return false; const st = window.getComputedStyle(el); return st.display!=='none' && el.offsetParent!==null; }

  ready(function(){
    hookTab();
    const root = qs('#offerList');
    if (visible(root)) load();
    // observe to re-apply after app.js renders skeleton then content
    try { new MutationObserver(function(){ if(visible(qs('#offerList'))) load(); }).observe(document.body, {childList:true, subtree:true}); }catch(_){}
  });
})();
