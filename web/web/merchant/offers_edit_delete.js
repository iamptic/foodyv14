/* Foody Merchant: Offers list + Edit/Delete (2025-08-18)
   Works with index.html that includes #offerList table and #offerEditModal modal
*/
/* global window, localStorage */
(function(){
  const API = (window.foodyApi || window.FOODY_API || "https://foodyback-production.up.railway.app").replace(/\/+$/,"");
  const $ = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

  const listEl = document.getElementById("offerList");
  if (!listEl) return;

  // Toast helper (uses #toast container from index.html)
  function toast(text, type="info"){
    let root = document.getElementById("toast");
    if (!root) {
      root = document.createElement("div");
      root.id = "toast";
      document.body.appendChild(root);
    }
    const el = document.createElement("div");
    el.className = "toast" + (type==="ok" ? "" : "");
    el.textContent = text;
    root.appendChild(el);
    setTimeout(()=>{
      el.style.opacity = "0";
      setTimeout(()=>el.remove(), 300);
    }, 2200);
  }

  function authHeaders(){
    const token = localStorage.getItem("authToken") || localStorage.getItem("token") || "";
    return token ? { "Authorization": "Bearer " + token } : {};
  }

  async function http(url, {method="GET", headers={}, body, timeout=12000}={}){
    const ctl = new AbortController();
    const t = setTimeout(()=>ctl.abort(new DOMException("Timeout","AbortError")), timeout);
    try{
      const res = await fetch(url, { method, headers, body, signal: ctl.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
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

  // Render skeleton and header
  function renderSkeleton(){
    listEl.innerHTML = `
      <div class="row head">
        <div>Название</div>
        <div>Старая</div>
        <div>Цена</div>
        <div>Кол-во</div>
        <div>Действует до</div>
        <div class="nowrap" style="text-align:right">Действия</div>
      </div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>`;
  }

  function renderRows(items){
    const head = `
      <div class="row head">
        <div>Название</div>
        <div>Старая</div>
        <div>Цена</div>
        <div>Кол-во</div>
        <div>Действует до</div>
        <div class="nowrap" style="text-align:right">Действия</div>
      </div>`;

    const rows = items.map(o => {
      const id = o.id;
      const title = (o.title || "Оффер");
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

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

  // Load list
  async function loadList(){
    renderSkeleton();
    try{
      const res = await http(`${API}/api/v1/merchant/offers`, { headers: { "Accept":"application/json", ...authHeaders() } });
      if (res.status === 401){
        listEl.innerHTML = `<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div></div></div>
          <div class="row"><div class="nowrap" style="grid-column: 1 / -1; color:var(--subtext)">Требуется вход. Перейдите во вкладку «Профиль».</div></div>`;
        return;
      }
      if (!res.ok){ throw new Error(`HTTP ${res.status}`); }
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data && data.items) || [];
      renderRows(items);
    }catch(err){
      console.error("[offers] list error:", err);
      listEl.innerHTML = `<div class="row head"><div>Название</div><div>Старая</div><div>Цена</div><div>Кол-во</div><div>Действует до</div><div></div></div>
        <div class="row"><div class="nowrap" style="grid-column: 1 / -1; color:#f99">Не удалось загрузить список офферов.</div></div>`;
    }
  }

  // Edit flow: open modal, prefill, submit
  const editModal = document.getElementById("offerEditModal");
  const editForm  = document.getElementById("offerEditForm");
  const btnCancel = document.getElementById("offerEditCancel");
  const inputMap = {
    id:        document.getElementById("editId"),
    title:     document.getElementById("editTitle"),
    old:       document.getElementById("editOld"),
    price:     document.getElementById("editPrice"),
    qty:       document.getElementById("editQty"),
    expires:   document.getElementById("editExpires"),
    category:  document.getElementById("editCategory"),
    desc:      document.getElementById("editDesc"),
  };

  function showEditModal(show=true){
    if (!editModal) return;
    editModal.style.display = show ? "block" : "none";
    document.body.style.overflow = show ? "hidden" : "";
  }

  async function openEdit(id){
    try{
      const res = await http(`${API}/api/v1/merchant/offers/${id}`, { headers: { "Accept":"application/json", ...authHeaders() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const o = await res.json();
      inputMap.id.value    = o.id;
      inputMap.title.value = o.title || "";
      inputMap.old.value   = o.original_price ?? "";
      inputMap.price.value = o.price ?? "";
      inputMap.qty.value   = (o.qty_total ?? o.stock) ?? "";
      inputMap.category.value = o.category || "other";
      inputMap.desc.value  = o.description || "";
      try{
        inputMap.expires.value = o.expires_at ? new Date(o.expires_at).toISOString().slice(0,16) : "";
      }catch{ inputMap.expires.value = ""; }
      showEditModal(true);
    }catch(e){
      console.error("[offer] open edit error:", e);
      toast("Не удалось открыть оффер для редактирования", "err");
    }
  }

  editForm && editForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const id = inputMap.id.value;
    const payload = {
      title: inputMap.title.value.trim(),
      original_price: inputMap.old.value ? Number(inputMap.old.value) : null,
      price: inputMap.price.value ? Number(inputMap.price.value) : null,
      qty_total: inputMap.qty.value ? Number(inputMap.qty.value) : null,
      category: inputMap.category.value || "other",
      description: inputMap.desc.value.trim() || null,
      expires_at: inputMap.expires.value ? new Date(inputMap.expires.value).toISOString() : null,
    };
    const submitBtn = editForm.querySelector('button[type="submit"]');
    if (submitBtn){ submitBtn.disabled = True = true; submitBtn.textContent = "Сохраняем…"; }
    try{
      const res = await fetch(`${API}/api/v1/merchant/offers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok){
        let t = "";
        try{ t = await res.text(); }catch{}
        throw new Error(t || `Ошибка ${res.status}`);
      }
      toast("Оффер обновлён", "ok");
      showEditModal(false);
      loadList();
    }catch(err){
      console.error("[offer] save error:", err);
      toast(err.message || "Не удалось сохранить оффер", "err");
    }finally{
      if (submitBtn){ submitBtn.disabled = false; submitBtn.textContent = "Сохранить"; }
    }
  });

  btnCancel && btnCancel.addEventListener("click", ()=>showEditModal(false));
  editModal && editModal.addEventListener("click", (e)=>{
    if (e.target.classList.contains("modal-dim")) showEditModal(false);
  });

  // Delete
  async function doDelete(id){
    if (!confirm("Удалить оффер #" + id + "? Это действие необратимо.")) return;
    try{
      const res = await fetch(`${API}/api/v1/merchant/offers/${id}`, {
        method: "DELETE",
        headers: { ...authHeaders() }
      });
      if (!res.ok){
        let t = "";
        try{ t = await res.text(); }catch{}
        throw new Error(t || `Ошибка ${res.status}`);
      }
      toast("Оффер удалён", "ok");
      loadList();
    }catch(err){
      console.error("[offer] delete error:", err);
      toast(err.message || "Не удалось удалить оффер", "err");
    }
  }

  // Delegated clicks on actions
  listEl.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "edit") return openEdit(id);
    if (action === "delete") return doDelete(id);
  });

  // First load
  loadList();
})();