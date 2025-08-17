
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
          const res = await fetch(apiBase().replace(/\/+$/,'') + '/api/v1/merchant/offers/'+id, {
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
        expires_at: qs('#editExpires').value || null,
        category: qs('#editCategory').value || null,
        description: qs('#editDesc').value || null,
      };
      try{
        const res = await fetch(apiBase().replace(/\/+$/,'') + '/api/v1/merchant/offers/'+id, {
          method:'PATCH',
          headers: { 'Content-Type':'application/json', 'X-Foody-Key': key() },
          body: JSON.stringify(payload)
        });
        if(!res.ok) throw new Error('HTTP '+res.status);
        closeEdit();
        await load();
      }catch(err){ alert('Не удалось сохранить: ' + err.message); }
    });
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
