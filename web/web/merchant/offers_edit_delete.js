/* Foody Merchant v3 — Edit/Delete fix, consistent buttons, pretty modal */
(function(){
  'use strict';
  const API = ((window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || "https://foodyback-production.up.railway.app").replace(/\/+$/,"");
  const $ = (s, r=document)=>r.querySelector(s);

  function headers(){
    const key = localStorage.getItem("foody_key") || "";
    const h = { "Accept":"application/json" };
    if (key) h["X-Foody-Key"] = key;
    return h;
  }
  function toast(text, type){
    let root = $("#toast"); if(!root){ root=document.createElement("div"); root.id="toast"; document.body.appendChild(root); }
    const el = document.createElement("div"); el.textContent = text;
    el.style.cssText = "background:#14161a;color:#fff;padding:10px 14px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.25);font-weight:700;margin:8px 0;";
    if(type==="ok") el.style.background = "#12a150"; if(type==="err") el.style.background = "#e5484d"; root.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .3s"; setTimeout(()=>el.remove(), 320); }, 2200);
  }

  function ensureDeleteModal(){
    let m = document.getElementById("delete-modal"); if (m) return m;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div id="delete-modal" aria-hidden="true">
      <div class="modal__backdrop" data-close-delete></div>
      <div class="modal__sheet" role="dialog" aria-modal="true" aria-labelledby="del-title">
        <button class="modal__close" data-close-delete title="Закрыть">✕</button>
        <div class="modal__head"><div class="modal__icon">🗑</div><div>
          <div id="del-title" class="modal__title">Удалить оффер?</div>
          <p class="modal__text">Оффер <b>#<span id="delete-offer-id">—</span></b> будет удалён безвозвратно.</p>
        </div></div>
        <div class="modal__actions"><button id="delete-confirm" class="btn btn-danger">Удалить</button><button class="btn btn-ghost" data-close-delete>Отмена</button></div>
      </div></div>`;
    document.body.appendChild(wrap.firstElementChild);
    m = document.getElementById("delete-modal");
    m.addEventListener("click", (e)=>{ if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-close-delete")) closeDeleteModal(); });
    document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") closeDeleteModal(); });
    return m;
  }
  function openDeleteModal(id, onConfirm){
    const m = ensureDeleteModal();
    const span = document.getElementById("delete-offer-id"); const btn=document.getElementById("delete-confirm");
    if (span) span.textContent = id; if(btn){ btn.onclick=()=>onConfirm(id); btn.disabled=false; btn.textContent="Удалить"; }
    m.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
  }
  function closeDeleteModal(){ const m=document.getElementById("delete-modal"); if(!m) return; m.setAttribute("aria-hidden","true"); document.body.style.overflow=""; const b=document.getElementById("delete-confirm"); if(b) b.onclick=null; }

  async function http(url, init){ return await fetch(url, init); }
  const listEl = document.getElementById("offerList") || document.getElementById("my-offers-list");

  function renderRows(items){
    if (!listEl) return;
    const head = `<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div style="text-align:right">Действия</div></div>`;
    const nf = (x)=>x==null?'—':new Intl.NumberFormat('ru-RU').format(Number(x));
    const dt = (s)=>{ try{const d=new Date(s); return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '—';} };
    const esc = (t)=>String(t||'').replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
    const rows = items.map(o=>{
      const id=o.id, old=o.original_price!=null?nf(o.original_price)+' ₽':'—', price=o.price!=null?nf(o.price)+' ₽':'—', qty=o.qty_total??o.stock??'—', exp=dt(o.expires_at);
      return `<div class="row" data-id="${id}">
        <div class="nowrap">${esc(o.title)}</div>
        <div class="num">${old}</div><div class="num">${price}</div><div class="num">${qty}</div>
        <div class="nowrap">${exp}</div>
        <div class="actions">
          <button class="btn btn-sm" data-action="edit" data-id="${id}">Редактировать</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${id}">Удалить</button>
        </div>
      </div>`;
    }).join("");
    listEl.innerHTML = head + rows;
  }

  async function loadList(){
    if (!listEl) return;
    listEl.innerHTML = '<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div style="text-align:right">Действия</div></div><div class="skeleton"></div><div class="skeleton"></div>';
    try{
      const r = await http(`${API}/api/v1/merchant/offers`, { headers: headers() });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      renderRows(Array.isArray(data)?data:(data&&data.items)||[]);
    }catch(e){ console.error(e); listEl.innerHTML = '<div style="color:#e5484d">Не удалось загрузить список офферов.</div>'; }
  }

  function setValue(sel,val){ const el=$(sel); if(el) try{ el.value=val; }catch{} }
  async function doEdit(id){
    try{
      const r = await http(`${API}/api/v1/merchant/offers/${id}`, { headers: headers() });
      if (!r.ok) throw new Error('HTTP '+r.status);
      const o = await r.json();
      const goto = document.querySelector('[data-tab="create"]') || document.querySelector('[data-tab-target="#create"]'); if (goto) goto.click();
      setValue("#offerId", o.id); setValue("#title", o.title||""); setValue("#description", o.description||"");
      setValue("#price", o.price??""); setValue("#stock", (o.qty_total??o.stock)??""); setValue("#photo_url", o.photo_url||"");
      try{ setValue("#expires_at", o.expires_at ? new Date(o.expires_at).toISOString().slice(0,16) : ""); }catch{}
      const prev = document.getElementById("photoPreview"); if(prev && o.photo_url){ prev.src=o.photo_url; prev.style.display="block"; }
      const sbtn = document.getElementById("saveOffer"); if(sbtn) sbtn.textContent="Сохранить изменения";
      toast("Режим редактирования — внесите изменения и сохраните","ok");
    }catch(e){ console.error(e); toast("Не удалось загрузить оффер для редактирования","err"); }
  }

  async function doDelete(id){
    const btn = document.getElementById("delete-confirm"); if (btn){ btn.disabled=true; btn.textContent="Удаляем…"; }
    try{
      const rid = localStorage.getItem("foody_restaurant_id") || "";
      const urls = [`${API}/api/v1/merchant/offers/${id}?restaurant_id=${encodeURIComponent(rid)}`, `${API}/api/v1/merchant/offers/${id}`];
      let ok=false,lastErr=""; for(const u of urls){ try{ const resp=await fetch(u,{method:"DELETE",headers:headers()}); if(resp.ok){ ok=true; break; } lastErr=await resp.text(); }catch(e){ lastErr=String(e); } }
      if(!ok) throw new Error(lastErr||"Удаление не выполнено");
      toast("Оффер удалён","ok"); closeDeleteModal(); loadList();
    }catch(e){ console.error(e); toast("Не удалось удалить оффер","err"); }
    finally{ if (btn){ btn.disabled=false; btn.textContent="Удалить"; } }
  }

  document.addEventListener("click", (e)=>{
    const b = e.target.closest("button, a"); if (!b) return;
    const act = (b.getAttribute("data-action")||"").toLowerCase(); const txt=(b.textContent||"").toLowerCase();
    const isEdit = act==='edit' || /редакт/i.test(txt); const isDelete = act==='delete' || /удал/i.test(txt);
    if(!isEdit && !isDelete) return; e.preventDefault();
    let id = b.getAttribute("data-id") || b.getAttribute("data-offer-id") || "";
    if(!id){ const row=b.closest("[data-id],[data-offer-id],.row,tr"); if(row) id=row.getAttribute("data-id")||row.getAttribute("data-offer-id")||""; }
    if(!id){ toast("ID оффера не найден","err"); return; }
    if(isEdit) return doEdit(id);
    if(isDelete) return openDeleteModal(id, doDelete);
  }, { capture:true });

  if (listEl){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', loadList); else loadList(); }
  window.loadMyOffers = loadList;
})();
