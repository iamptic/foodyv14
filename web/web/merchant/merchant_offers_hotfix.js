/*! Foody Merchant Hotfix: Edit/Delete actions (global delegation) — 2025-08-18 */
(function(){
  'use strict';

  const API = (window.foodyApi || window.FOODY_API || "https://foodyback-production.up.railway.app").replace(/\/+$/,"");

  // ---- helpers
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  function log(...a){ try{ console.debug("[foody-hotfix]", ...a); }catch{} }

  function authHeaders(){
    const token = localStorage.getItem("authToken") || localStorage.getItem("token") || "";
    return token ? { "Authorization": "Bearer " + token } : {};
  }

  async function http(url, { method="GET", headers={}, body, timeout=12000 }={}){
    const ctl = new AbortController();
    const timer = setTimeout(()=>ctl.abort(new DOMException("Timeout","AbortError")), timeout);
    try{ return await fetch(url, { method, headers, body, signal: ctl.signal }); }
    finally{ clearTimeout(timer); }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
  function fmtDate(iso){
    if (!iso) return "—";
    try{ const d=new Date(iso); return d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
    catch{ return iso; }
  }

  // ---- toast (use existing .toast, or create lightweight one)
  function ensureToastRoot(){
    let root = document.getElementById("toast");
    if (!root){
      root = document.createElement("div");
      root.id = "toast";
      root.style.position = "fixed";
      root.style.left = "50%";
      root.style.bottom = "24px";
      root.style.transform = "translateX(-50%)";
      root.style.zIndex = "2147483647";
      document.body.appendChild(root);
    }
    return root;
  }
  function toast(msg, type){
    const root = ensureToastRoot();
    const el = document.createElement("div");
    el.className = "toast " + (type ? ("toast--" + type) : "");
    el.textContent = msg;
    if (!getComputedStyle(el).backgroundColor || getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)"){
      el.style.background = (type==="err" ? "#e5484d" : (type==="ok" ? "#12a150" : "#14161a"));
      el.style.color = "#fff";
      el.style.padding = "10px 14px";
      el.style.borderRadius = "12px";
      el.style.boxShadow = "0 8px 24px rgba(0,0,0,.2)";
      el.style.fontWeight = "600";
      el.style.marginTop = "8px";
    }
    root.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .3s"; setTimeout(()=>el.remove(), 320); }, 2200);
  }

  // ---- modal delete (re-uses #delete-modal if exists, else creates)
  const del = { modal: null, idSpan: null, confirmBtn: null };
  function ensureDeleteModal(){
    if (del.modal) return;
    del.modal = document.getElementById("delete-modal");
    if (!del.modal){
      const wrap = document.createElement("div");
      wrap.innerHTML = `
<div id="delete-modal" class="modal" aria-hidden="true" role="dialog" aria-modal="true">
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
      del.modal = document.getElementById("delete-modal");
    }
    del.idSpan = document.getElementById("delete-offer-id");
    del.confirmBtn = document.getElementById("delete-confirm");

    del.modal.addEventListener("click", (e)=>{
      if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-close-delete")) closeDeleteModal();
    });
    document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeDeleteModal(); });
  }
  function openDeleteModal(id, onConfirm){
    ensureDeleteModal();
    if (del.idSpan) del.idSpan.textContent = id;
    if (del.confirmBtn){
      del.confirmBtn.onclick = () => onConfirm(id);
      del.confirmBtn.disabled = false;
      del.confirmBtn.textContent = "Удалить";
    }
    del.modal.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
  }
  function closeDeleteModal(){
    if (!del.modal) return;
    del.modal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
    if (del.confirmBtn) del.confirmBtn.onclick = null;
  }

  // ---- robust id detection
  function findOfferIdFrom(el){
    if (!el) return "";
    if (el.dataset && el.dataset.id) return el.dataset.id;
    const row = el.closest("[data-id], [data-offer-id], [data-offer], tr, .row, .offer-row");
    if (row){
      if (row.dataset && row.dataset.id) return row.dataset.id;
      if (row.dataset && row.dataset.offerId) return row.dataset.offerId;
      if (row.dataset && row.dataset.offer) return row.dataset.offer;
      const hidden = row.querySelector('input[name="id"], input[type="hidden"][name="offerId"], [data-offer-id]');
      if (hidden){ return hidden.value || hidden.dataset.offerId || ""; }
    }
    const attr = el.getAttribute && (el.getAttribute("data-offer-id") || el.getAttribute("data-id"));
    if (attr) return attr;
    return "";
  }

  // ---- edit: prefill create-offer form
  function openCreateTab(){
    const t = document.querySelector('[data-tab-target="#create-offer"]') || document.querySelector('[data-tab="create-offer"]');
    if (t) { t.click(); return; }
    const sec = document.getElementById("create-offer");
    if (sec) sec.scrollIntoView({behavior:"smooth", block:"start"});
  }
  function setVal(sel, val){ const el = document.querySelector(sel); if (el) try{ el.value = val; }catch{} }
  async function doOpenEdit(id){
    if (!id){ toast("ID оффера не найден", "err"); return; }
    try{
      const res = await http(`${API}/api/v1/merchant/offers/${id}`, { headers: { "Accept":"application/json", ...authHeaders() } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const o = await res.json();
      openCreateTab();
      setVal("#offerId", o.id);
      setVal("#title", o.title || "");
      setVal("#description", o.description || "");
      setVal("#price", o.price ?? "");
      setVal("#stock", (o.qty_total ?? o.stock) ?? "");
      setVal("#photo_url", o.photo_url || "");
      try{ setVal("#expires_at", o.expires_at ? new Date(o.expires_at).toISOString().slice(0,16) : ""); }catch{}
      const prev = document.getElementById("photoPreview");
      if (prev && o.photo_url){ prev.src = o.photo_url; prev.style.display = "block"; }
      const saveBtn = document.getElementById("saveOffer"); if (saveBtn) saveBtn.textContent = "Сохранить изменения";
      toast("Режим редактирования — внесите изменения и сохраните", "ok");
    }catch(e){
      console.debug(e);
      toast("Не удалось загрузить оффер для редактирования", "err");
    }
  }

  // ---- delete flow
  async function doDelete(id){
    if (!id){ toast("ID оффера не найден", "err"); return; }
    const btn = document.getElementById("delete-confirm");
    if (btn){ btn.disabled = true; btn.textContent = "Удаляем…"; }
    try{
      const res = await fetch(`${API}/api/v1/merchant/offers/${id}`, { method:"DELETE", headers:{ ...authHeaders() } });
      if (!res.ok){
        let t=""; try{ t = await res.text(); }catch{}
        throw new Error(t || `Ошибка ${res.status}`);
      }
      closeDeleteModal();
      toast("Оффер удалён", "ok");
      if (typeof window.loadMyOffers === "function") window.loadMyOffers();
    }catch(e){
      console.debug(e);
      toast("Не удалось удалить оффер", "err");
    }finally{
      if (btn){ btn.disabled = false; btn.textContent = "Удалить"; }
    }
  }

  // ---- GLOBAL DELEGATION
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("button, a");
    if (!btn) return;
    const actionAttr = btn.getAttribute("data-action") || (btn.dataset ? btn.dataset.action : "");
    const txt = (btn.textContent || "").toLowerCase();
    const isEdit = actionAttr === "edit" || /редакт/i.test(txt);
    const isDelete = actionAttr === "delete" || /удал/i.test(txt);
    if (!isEdit && !isDelete) return;
    e.preventDefault();
    const id = findOfferIdFrom(btn);
    if (isEdit) return doOpenEdit(id);
    if (isDelete) return openDeleteModal(id, doDelete);
  }, { capture:true });
})();