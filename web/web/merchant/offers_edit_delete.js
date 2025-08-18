/*! Foody Merchant Hotfix: Edit/Delete (global delegation, X-Foody-Key) — 2025-08-18 */
(function(){
  'use strict';

  const API = ((window.__FOODY__ && window.__FOODY__.FOODY_API) || window.foodyApi || "https://foodyback-production.up.railway.app").replace(/\/+$/,"");

  const $ = (s, r=document)=>r.querySelector(s);

  function toast(msg, type){
    let root = document.getElementById("toast");
    if (!root){ root = document.createElement("div"); root.id = "toast"; document.body.appendChild(root); }
    const el = document.createElement("div");
    el.className = "toast " + (type ? ("toast--" + type) : "");
    el.textContent = msg;
    if (!getComputedStyle(el).backgroundColor || getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)"){
      el.style.background = (type==="err" ? "#e5484d" : (type==="ok" ? "#12a150" : "#14161a"));
      el.style.color = "#fff"; el.style.padding = "10px 14px"; el.style.borderRadius = "12px";
      el.style.boxShadow = "0 8px 24px rgba(0,0,0,.2)"; el.style.fontWeight = "600"; el.style.marginTop = "8px";
    }
    root.appendChild(el); setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .3s"; setTimeout(()=>el.remove(), 320); }, 2200);
  }

  function headers(){ return { "X-Foody-Key": (localStorage.getItem("foody_key")||""), "Content-Type":"application/json" }; }
  function rid(){ return (localStorage.getItem("foody_restaurant_id")||""); }

  async function http(url, init){ const r = await fetch(url, init); return r; }

  function ensureDeleteModal(){
    let modal = document.getElementById("delete-modal");
    if (!modal){
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div id="delete-modal" class="modal" aria-hidden="true" role="dialog" aria-modal="true">
        <div class="modal__backdrop" data-close-delete></div>
        <div class="modal__sheet" role="document">
          <button class="modal__close" type="button" title="Закрыть" data-close-delete>✕</button>
          <h3 class="modal__title">Удалить оффер?</h3>
          <p>Действие необратимо. Оффер #<span id="delete-offer-id">—</span> будет удалён.</p>
          <div class="modal__actions">
            <button class="btn btn-danger" id="delete-confirm">Удалить</button>
            <button class="btn btn-secondary" data-close-delete>Отмена</button>
          </div>
        </div>
      </div>`;
      document.body.appendChild(wrap.firstElementChild);
      modal = document.getElementById("delete-modal");
      modal.addEventListener("click", (e)=>{ if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-close-delete")) closeDelete(); });
      document.addEventListener("keydown", (e)=>{ if (e.key==="Escape") closeDelete(); });
    }
    return modal;
  }
  function openDelete(id, onConfirm){
    const m = ensureDeleteModal();
    const span = document.getElementById("delete-offer-id");
    const btn = document.getElementById("delete-confirm");
    if (span) span.textContent = id;
    if (btn){ btn.onclick = () => onConfirm(id); btn.disabled = false; btn.textContent = "Удалить"; }
    m.setAttribute("aria-hidden","false"); document.body.style.overflow = "hidden";
  }
  function closeDelete(){
    const m = document.getElementById("delete-modal"); if (!m) return;
    m.setAttribute("aria-hidden","true"); document.body.style.overflow = "";
    const btn = document.getElementById("delete-confirm"); if (btn) btn.onclick = null;
  }

  function findOfferId(btn){
    if (!btn) return "";
    if (btn.dataset && (btn.dataset.id || btn.dataset.offerId)) return btn.dataset.id || btn.dataset.offerId;
    const row = btn.closest("[data-offer-id], [data-id], tr, .row, .offer-row");
    if (row){
      return row.getAttribute("data-offer-id") || row.getAttribute("data-id") || (row.querySelector('input[name="id"]')?.value) || "";
    }
    return btn.getAttribute("data-offer-id") || btn.getAttribute("data-id") || "";
  }

  async function doEdit(id){
    try{
      const r = await http(`${API}/api/v1/merchant/offers/${id}?restaurant_id=${encodeURIComponent(rid())}`, { headers: headers() });
      const o = r.ok ? await r.json() : null;
      if (!o) throw new Error("HTTP " + r.status);
      // Fill form in "create" tab
      const goto = document.querySelector('[data-tab="create"]') || document.querySelector('[data-tab-target="#create"]'); if (goto) goto.click();
      const set = (sel,val)=>{ const el=$(sel); if (el) try{ el.value = val; }catch{} };
      set("#offerId", o.id);
      set("#title", o.title || "");
      set("#description", o.description || "");
      set("#price", o.price ?? "");
      set("#stock", (o.qty_total ?? o.stock) ?? "");
      set("#photo_url", o.photo_url || "");
      try{ set("#expires_at", o.expires_at ? new Date(o.expires_at).toISOString().slice(0,16) : ""); }catch{}
      const prev = document.getElementById("photoPreview");
      if (prev && o.photo_url){ prev.src = o.photo_url; prev.style.display = "block"; }
      const saveBtn = document.getElementById("saveOffer"); if (saveBtn) saveBtn.textContent = "Сохранить изменения";
      toast("Режим редактирования — внесите изменения и сохраните", "ok");
    }catch(e){ console.warn(e); toast("Не удалось загрузить оффер для редактирования", "err"); }
  }

  async function doDelete(id){
    const btn = document.getElementById("delete-confirm");
    if (btn){ btn.disabled = true; btn.textContent = "Удаляем…"; }
    try{
      const R = encodeURIComponent(rid());
      const chain = [
        `${API}/api/v1/merchant/offers/${id}?restaurant_id=${R}`,
        `${API}/api/v1/merchant/offers/${id}`
      ];
      let last=null;
      for (const url of chain){
        try{
          const resp = await fetch(url, { method: "DELETE", headers: headers() });
          if (resp.ok) { last = null; break; }
          last = resp.status;
        }catch(e){ last = e.message; }
      }
      if (last) throw new Error(last);
      toast("Оффер удалён", "ok"); closeDelete();
      // refresh if helper exists
      if (typeof window.loadOffers === "function") window.loadOffers();
      else if (typeof window.loadMyOffers === "function") window.loadMyOffers();
    }catch(e){ console.warn(e); toast("Не удалось удалить оффер", "err"); }
    finally{ if (btn){ btn.disabled = false; btn.textContent = "Удалить"; } }
  }

  document.addEventListener("click", (e)=>{
    const b = e.target.closest("button, a"); if (!b) return;
    const action = (b.getAttribute("data-action")||"").toLowerCase();
    const txt = (b.textContent||"").toLowerCase();
    const isEdit = action==="edit" || action==="edit-offer" || /редакт/i.test(txt);
    const isDelete = action==="delete" || action==="delete-offer" || /удал/i.test(txt);
    if (!isEdit && !isDelete) return;
    e.preventDefault();
    const id = findOfferId(b);
    if (!id) return toast("ID оффера не найден", "err");
    if (isEdit) return doEdit(id);
    if (isDelete) return openDelete(id, doDelete);
  }, { capture: true });
})();