/*! Foody Merchant — Actions overlay (Edit/Delete) */
(function(){
  function ready(fn){ if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); }
  function qs(s,r=document){ return r.querySelector(s); }
  function qsa(s,r=document){ return Array.from(r.querySelectorAll(s)); }
  function apiBase(){ return (window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || ''; }
  function rid(){ try { return localStorage.getItem('foody_restaurant_id') || ''; } catch(_){ return ''; } }
  function key(){ try { return localStorage.getItem('foody_key') || ''; } catch(_){ return ''; } }
  function isoFromLocal(v){
  if(!v) return null;
  try{
    const s = v.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)){
      const dt = new Date(s);
      return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString();
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }catch(_){ }
  return v;
}
catch(_){ return v; } }

  // Augment table with Actions column if missing
  function ensureActionsUI(){
    const root = qs('#offerList'); if(!root) return;
    const head = root.querySelector('.row.head');
    if (head){
      const last = head.children[head.children.length-1];
      if (!last || last.textContent.trim()===''){
        const dv = document.createElement('div'); dv.textContent = 'Действия'; head.appendChild(dv);
      }
    }
    qsa('.row:not(.head)', root).forEach(row => {
      let cell = row.querySelector('.actions');
      if (!cell){
        cell = document.createElement('div'); cell.className='actions';
        cell.innerHTML = '<button class="btn" data-action="edit-offer">Редактировать</button><button class="btn btn-ghost" data-action="delete-offer">Удалить</button>';
        row.appendChild(cell);
      } else {
        // ensure buttons present
        if (!cell.querySelector('[data-action]')){
          cell.innerHTML = '<button class="btn" data-action="edit-offer">Редактировать</button><button class="btn btn-ghost" data-action="delete-offer">Удалить</button>';
        }
      }
      row.style.gridTemplateColumns = ''; // let CSS handle
    });
  }

  // Modal open/close (expects fields exist in HTML)
  window.openEdit = function(o){
    const m = qs('#offerEditModal'); if(!m) return;
    qs('#editId').value = o?.id ?? '';
    qs('#editTitle').value = o?.title ?? '';
    qs('#editOld').value = (o && o.original_price_cents!=null) ? (o.original_price_cents/100) : (o?.original_price ?? '');
    qs('#editPrice').value = (o && o.price_cents!=null) ? (o.price_cents/100) : (o?.price ?? '');
    qs('#editQty').value = o?.qty_total ?? '';
    qs('#editExpires').value = (o?.expires_at ? String(o.expires_at).slice(0,16) : '');
    qs('#editCategory').value = o?.category ?? '';
    qs('#editDesc').value = o?.description ?? '';
    m.style.display = 'block';
  };
  function closeEdit(){ const m = qs('#offerEditModal'); if(m) m.style.display='none'; }
  window.closeEdit = closeEdit;

  async function updateOffer(id, payload){
    const base = apiBase().replace(/\/+$/,''); const R = encodeURIComponent(rid());
    const headers = { 'X-Foody-Key': key(), 'Content-Type': 'application/json' };
    const body = JSON.stringify(payload);
    const bodyWithId = JSON.stringify({ id, restaurant_id: rid(), ...payload });
    const chain = [
      // Preferred detail routes
      { url: `${base}/api/v1/merchant/offers/${id}?restaurant_id=${R}`, init:{ method:'PUT', headers, body } },
      { url: `${base}/api/v1/merchant/offers/${id}`,                init:{ method:'PUT', headers, body } },
      { url: `${base}/api/v1/merchant/offers`,                      init:{ method:'PUT', headers, body: bodyWithId } },
      { url: `${base}/api/v1/merchant/offers/${id}?restaurant_id=${R}`, init:{ method:'PATCH', headers, body } },
      { url: `${base}/api/v1/merchant/offers`,                      init:{ method:'PATCH', headers, body: bodyWithId } },
      ,{ url: `${base}/api/v1/merchant/offers/update`, init:{ method:'POST', headers, body: bodyWithId } }
  ,{ url: `${base}/api/v1/merchant/offer/update`,  init:{ method:'POST', headers, body: bodyWithId } }
];
    let last=null;
    for (const opt of chain){
      try{ const r = await fetch(opt.url, opt.init); if (r.ok) return; last=r.status; if (r.status===404||r.status===405) continue; throw new Error('HTTP '+r.status); }catch(e){ last=e.message; }
    }
    throw new Error(last||'update failed');
  }

  async function deleteOffer(id){
    const base = apiBase().replace(/\/+$/,''); const R = encodeURIComponent(rid());
    const headers = { 'X-Foody-Key': key(), 'Content-Type': 'application/json' };
    const chain = [
      // Preferred detail routes
      { url: `${base}/api/v1/merchant/offers/${id}?restaurant_id=${R}`, init:{ method:'DELETE', headers } },
      { url: `${base}/api/v1/merchant/offers/${id}`,                init:{ method:'DELETE', headers } },
      { url: `${base}/api/v1/merchant/offers?id=${encodeURIComponent(id)}&restaurant_id=${R}`, init:{ method:'DELETE', headers } },
      { url: `${base}/api/v1/merchant/offers`,                      init:{ method:'DELETE', headers, body: JSON.stringify({ id, restaurant_id: rid() }) } },
      ,{ url: `${base}/api/v1/merchant/offers/update`, init:{ method:'POST', headers, body: bodyWithId } }
  ,{ url: `${base}/api/v1/merchant/offer/update`,  init:{ method:'POST', headers, body: bodyWithId } }
];
    let last=null;
    for (const opt of chain){
      try{ const r = await fetch(opt.url, opt.init); if (r.ok) return; last=r.status; if (r.status===404||r.status===405) continue; throw new Error('HTTP '+r.status); }catch(e){ last=e.message; }
    }
    throw new Error(last||'delete failed');
  }

  function bindActions(){
    const root = qs('#offerList'); if(!root) return;
    if (root.dataset.actionsBound) return;
    root.dataset.actionsBound = '1';
    root.addEventListener('click', async (e)=>{
      const a = e.target.closest('[data-action]'); if(!a) return;
      const row = a.closest('.row'); const id = row?.getAttribute('data-offer-id'); if(!id) return;
      const list = window.__offersCache || [];
      const item = list.find(x => String(x.id)===String(id));
      if (a.dataset.action==='edit-offer' || a.dataset.action==='edit'){ if(item) openEdit(item); return; }
      if (a.dataset.action==='delete-offer' || a.dataset.action==='delete'){
        if(!confirm('Удалить оффер?')) return;
        try{ await deleteOffer(id); row.remove(); try{ window.refreshDashboard && refreshDashboard(); }catch(_){ } }catch(err){ alert('Не удалось удалить: ' + (err?.message||err)); }
      }
    });
  }

  function bindEditForm(){
    const form = qs('#offerEditForm'); if(!form) return;
    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const id = qs('#editId').value;
      const payload = {
        title: (qs('#editTitle').value||null),
        original_price: qs('#editOld').value ? Number(qs('#editOld').value) : null,
        price: qs('#editPrice').value ? Number(qs('#editPrice').value) : null,
        qty_total: qs('#editQty').value ? Number(qs('#editQty').value) : null,
        expires_at: isoFromLocal(qs('#editExpires').value) || null,
        category: qs('#editCategory').value || null,
        description: qs('#editDesc').value || null,
      };
      try{ await updateOffer(id, payload); closeEdit(); if (window.refreshDashboard) { try { await refreshDashboard(); } catch(_){} } else { try { location.reload(); } catch(_){} } try{ await window.load?.(); }catch(_){ } }catch(err){ alert('Не удалось сохранить: '+(err?.message||err)); }
    });
    const cancel = qs('#offerEditCancel'); if (cancel) cancel.addEventListener('click', (e)=>{ e.preventDefault(); closeEdit(); });
  }

  // Re-augment UI after each render() from app.js
  const mo = new MutationObserver(()=>{ ensureActionsUI(); });
  ready(function(){ ensureActionsUI(); bindActions(); bindEditForm(); const list = qs('#offerList'); if (list) mo.observe(list, { childList:true, subtree:true }); });
})();