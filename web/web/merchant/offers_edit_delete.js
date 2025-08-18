/* Foody Merchant: Offers list + Edit/Delete with modal (2025-08-18) */
/* global window, localStorage */
(function(){
  const API = (window.foodyApi || window.FOODY_API || "https://foodyback-production.up.railway.app").replace(/\/+$/,"");
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  const listEl = document.getElementById("offerList") || document.getElementById("my-offers-list");
  if (!listEl) return;

  // Toast helper: supports #toast container, otherwise creates it
  function ensureToastRoot(){
    let root = document.getElementById("toast");
    if (!root){
      root = document.createElement("div");
      root.id = "toast";
      document.body.appendChild(root);
    }
    return root;
  }
  function toast(text, type="info"){
    const root = ensureToastRoot();
    const el = document.createElement("div");
    el.className = "toast" + (type==="ok" ? " toast--ok" : (type==="err" ? " toast--err" : ""));
    el.textContent = text;
    root.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 320); }, 2200);
  }

  function authHeaders(){
    const token = localStorage.getItem("authToken") || localStorage.getItem("token") || "";
    return token ? { "Authorization": "Bearer " + token } : {};
  }

  async function http(url, {method="GET", headers={}, body, timeout=12000}={}){
    const ctl = new AbortController();
    const t = setTimeout(()=>ctl.abort(new DOMException("Timeout","AbortError")), timeout);
    try{ return await fetch(url, { method, headers, body, signal: ctl.signal }); }
    finally{ clearTimeout(t); }
  }

  function fmtDate(iso){
    if (!iso) return "—";
    try{
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", {day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"});
    }catch{ return iso; }
  }
  function fmtMoney(n){
    if (n==null || n==="") return "—";
    try{ return new Intl.NumberFormat("ru-RU").format(Number(n)); } catch { return String(n); }
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

  // Render
  function renderSkeleton(){
    listEl.innerHTML = `
      <div class="row head">
        <div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div class="nowrap" style="text-align:right">Действия</div>
      </div>
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  }
  function renderRows(items){
    const head = `
      <div class="row head">
        <div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div class="nowrap" style="text-align:right">Действия</div>
      </div>`;
    const rows = items.map(o=>{
      const id = o.id;
      const title = o.title || "Оффер";
      const old = (o.original_price!=null ? fmtMoney(o.original_price) + " ₽" : "—");
      const price = (o.price!=null ? fmtMoney(o.price) + " ₽" : "—");
      const qty = (o.qty_total!=null ? o.qty_total : (o.stock!=null ? o.stock : "—"));
      const exp = fmtDate(o.expires_at);
      return `
        <div class="row" data-id="${id}">
          <div class="nowrap">${escapeHtml(title)}</div>
          <div class="num">${old}</div>
          <div class="num">${price}</div>
          <div class="num">${qty}</div>
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
    renderSkeleton();
    try{
      const res = await http(`${API}/api/v1/merchant/offers`, { headers: { "Accept":"application/json", ...authHeaders() } });
      if (res.status === 401){
        listEl.innerHTML = `<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div></div></div>
          <div class="row"><div class="nowrap" style="grid-column:1/-1;color:var(--muted)">Требуется вход.</div></div>`;
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data && data.items) || [];
      renderRows(items);
    }catch(e){
      console.error("[offers] list error:", e);
      listEl.innerHTML = `<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div></div></div>
        <div class="row"><div class="nowrap" style="grid-column:1/-1;color:#e5484d">Не удалось загрузить список офферов.</div></div>`;
    }
  }

  // Edit: prefill create-offer form
  function openCreateTab(){
    const btn = document.querySelector('[data-tab-target="#create-offer"]') || document.querySelector('[data-tab="create-offer"]');
    if (btn) { btn.click(); return; }
    const sec = document.getElementById("create-offer");
    if (sec) sec.scrollIntoView({behavior:"smooth"});
  }
  function setValue(sel, val){ const el=$(sel); if (el) try{ el.value = val; }catch{} }
  async function openEdit(id){
    try{
      const res = await http(`${API}/api/v1/merchant/offers/${id}`, { headers: { "Accept":"application/json", ...authHeaders() } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const o = await res.json();
      openCreateTab();
      setValue("#offerId", o.id);
      setValue("#title", o.title || "");
      setValue("#description", o.description || "");
      setValue("#price", o.price ?? "");
      setValue("#stock", (o.qty_total ?? o.stock) ?? "");
      setValue("#photo_url", o.photo_url || "");
      try{ setValue("#expires_at", o.expires_at ? new Date(o.expires_at).toISOString().slice(0,16) : ""); }catch{}
      const prev = document.getElementById("photoPreview");
      if (prev && o.photo_url){ prev.src = o.photo_url; prev.style.display = "block"; }
      const saveBtn = document.getElementById("saveOffer");
      if (saveBtn) saveBtn.textContent = "Сохранить изменения";
      toast("Режим редактирования — внесите изменения и сохраните", "ok");
    }catch(e){
      console.error("[offer] edit error:", e);
      toast("Не удалось загрузить оффер для редактирования", "err");
    }
  }

  // Delete with modal
  const del = {
    modal: document.getElementById("delete-modal"),
    idSpan: document.getElementById("delete-offer-id"),
    confirm: document.getElementById("delete-confirm"),
  };
  function ensureDeleteModal(){
    if (del.modal) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<div id="delete-modal" class="modal" aria-hidden="true" role="dialog" aria-modal="true">
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
    document.body.appendChild(wrapper.firstElementChild);
    del.modal = document.getElementById("delete-modal");
    del.idSpan = document.getElementById("delete-offer-id");
    del.confirm = document.getElementById("delete-confirm");
  }
  function openDeleteModal(id){
    ensureDeleteModal();
    del.modal.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
    if (del.idSpan) del.idSpan.textContent = id;
    del.confirm.onclick = () => doDelete(id);
  }
  function closeDeleteModal(){
    if (!del.modal) return;
    del.modal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
    if (del.confirm) del.confirm.onclick = null;
  }
  document.addEventListener("click", (e)=>{
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-close-delete")) closeDeleteModal();
  });
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") closeDeleteModal();
  });

  async function doDelete(id){
    const btn = del.confirm;
    if (btn){ btn.disabled = true; btn.textContent = "Удаляем…"; }
    try{
      const res = await fetch(`${API}/api/v1/merchant/offers/${id}`, {
        method: "DELETE", headers: { ...authHeaders() }
      });
      if (!res.ok){
        let txt = "";
        try{ txt = await res.text(); }catch{}
        throw new Error(txt || `Ошибка ${res.status}`);
      }
      closeDeleteModal();
      toast("Оффер удалён", "ok");
      loadList();
    }catch(err){
      console.error("[offer] delete error:", err);
      toast(err.message || "Не удалось удалить оффер", "err");
    }finally{
      if (btn){ btn.disabled = false; btn.textContent = "Удалить"; }
    }
  }

  // Delegation
  listEl.addEventListener("click", (e)=>{
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    const id = b.getAttribute("data-id");
    const action = b.getAttribute("data-action");
    if (action === "edit") return openEdit(id);
    if (action === "delete") return openDeleteModal(id);
  });

  // Go!
  loadList();
})();