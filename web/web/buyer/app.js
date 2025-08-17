/* global FOODY_API, QR_URL_BUILDER */
const API = (typeof window !== "undefined" && window.FOODY_API) || "https://foodyback-production.up.railway.app";
const QR_BUILDER = (typeof window !== "undefined" && window.QR_URL_BUILDER) || (payload =>
  `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`);

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  const q = document.getElementById("q");
  const refreshBtn = document.getElementById("refresh");
  wireModal();
  loadOffers();

  refreshBtn?.addEventListener("click", () => loadOffers({ force: true }));
  q?.addEventListener("input", debounce(() => filterByQuery(), 120));
});

// ---------- helpers ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function fmtPrice(v) { try { return new Intl.NumberFormat("ru-RU").format(v); } catch { return v; } }
function fmtExpires(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}
function debounce(fn, ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
function setStatus(html){ const st = $("#status"); if (st) st.innerHTML = html || ""; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function max0(n){ return n < 0 ? 0 : n; }

// ---------- UI ----------
function renderSkeleton(count = 6){
  const wrap = $("#offers");
  wrap.setAttribute("aria-busy", "true");
  wrap.innerHTML = "";
  for (let i=0;i<count;i++){
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="photo skeleton skel-photo"></div>
      <div class="info">
        <div class="skeleton skel-line" style="width:70%"></div>
        <div class="skeleton skel-line" style="width:90%"></div>
        <div class="skeleton skel-line" style="width:40%"></div>
      </div>`;
    wrap.appendChild(card);
  }
}

function renderOffers(offers){
  const grid = $("#offers");
  grid.innerHTML = "";
  grid.removeAttribute("aria-busy");

  if (!offers?.length){
    setStatus(`<div class="alert">Пока нет доступных предложений рядом.</div>`);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const o of offers){
    const card = document.createElement("article");
    card.className = "card";

    const disc = o.discount ?? o.current_discount ?? null;
    const badgeDisc = disc ? `<span class="badge">-${disc}%</span>` : "";

    const photo = o.photo_url || o.image_url || "";
    const title = escapeHtml(o.title || "Предложение");
    const desc = escapeHtml(o.description || "");
    const price = typeof o.price === "number" ? `${fmtPrice(o.price)} ₽` : (o.price || "");
    const expiresISO = o.expires_at;

    const timerId = `t-${o.id}`;
    const timerBadge = expiresISO ? `<span class="badge badge--timer" id="${timerId}">—:—</span>` : "";

    card.innerHTML = `
      <div class="photo">
        ${badgeDisc}
        ${timerBadge}
        ${photo ? `<img src="${photo}" alt="Фото: ${title}" loading="lazy">` : ""}
      </div>
      <div class="info">
        <h3 class="title">${title}</h3>
        ${desc ? `<p class="desc">${desc}</p>` : ""}
        <div class="row">
          <span class="price">${price}</span>
          ${expiresISO ? `<span class="muted">до ${fmtExpires(expiresISO)}</span>` : ""}
        </div>
        <div class="actions">
          <button class="btn btn-buy" data-id="${o.id}" ${expiresISO && new Date(expiresISO) < new Date() ? "disabled" : ""}>
            ${expiresISO && new Date(expiresISO) < new Date() ? "Истекло" : "Забронировать"}
          </button>
        </div>
      </div>
    `;

    // graceful image errors
    const img = card.querySelector("img");
    if (img) img.addEventListener("error", () => img.remove(), { once:true });

    frag.appendChild(card);

    // live countdown
    if (expiresISO){
      startCountdown(timerId, new Date(expiresISO), () => {
        const btn = card.querySelector(".btn-buy");
        const tEl = document.getElementById(timerId);
        if (btn){ btn.disabled = true; btn.textContent = "Истекло"; }
        if (tEl){ tEl.textContent = "00:00"; }
      });
    }
  }
  grid.appendChild(frag);

  bindReserve();
}

function startCountdown(elId, expiresAt, onExpire){
  const el = document.getElementById(elId);
  if (!el) return;
  function tick(){
    const now = new Date();
    let ms = expiresAt - now;
    if (ms <= 0){
      el.textContent = "00:00";
      clearInterval(int);
      if (onExpire) onExpire();
      return;
    }
    ms = max0(ms);
    const totalSec = Math.floor(ms / 1000);
    const mm = Math.floor(totalSec / 60).toString().padStart(2,"0");
    const ss = (totalSec % 60).toString().padStart(2,"0");
    el.textContent = `${mm}:${ss}`;
  }
  tick();
  const int = setInterval(tick, 1000);
}

// ---------- Data flow ----------
let lastOffers = [];

async function loadOffers({ force = false } = {}){
  setStatus(`<span class="muted">Загрузка предложений…</span>`);
  renderSkeleton();
  try{
    const data = await request(`${API}/api/v1/public/offers`, { timeout: 10000 });
    lastOffers = Array.isArray(data) ? data : (data?.items || []);
    setStatus("");
    renderOffers(lastOffers);
  }catch(err){
    console.error("[offers] load error:", err);
    setStatus(`<div class="alert error">Не удалось загрузить офферы. Проверьте соединение и попробуйте снова.</div>`);
    $("#offers").setAttribute("aria-busy","false");
  }
}

function filterByQuery(){
  const q = ($("#q")?.value || "").trim().toLowerCase();
  if (!q) { renderOffers(lastOffers); return; }
  const filtered = lastOffers.filter(o =>
    (o.title || "").toLowerCase().includes(q) ||
    (o.description || "").toLowerCase().includes(q)
  );
  renderOffers(filtered);
}

// ---------- Reserve + Modal ----------
function bindReserve(){
  $all(".btn-buy").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.getAttribute("data-id");
      if (!id) return;
      const el = e.currentTarget;
      const prevText = el.textContent;
      el.disabled = true;
      el.textContent = "Бронирование…";
      try{
        const res = await request(`${API}/api/v1/public/reserve/${id}`, { method: "POST", timeout: 10000 });
        const code = res?.code || res?.reservation_code || "";
        const expiresAt = (res?.expires_at) || (lastOffers.find(x=>String(x.id)===String(id))?.expires_at) || null;
        openReservationModal({ code, offerId:id, expiresAt });
      }catch(err){
        console.error("[reserve] error:", err);
        alert("Не удалось забронировать. Попробуйте ещё раз.");
      }finally{
        el.disabled = false;
        el.textContent = prevText;
      }
    });
  });
}

// ---------- Modal logic ----------
let modalEl, qrImgEl, qrFallbackEl, mOfferIdEl, mExpiresEl, copyBtnEl;
function wireModal(){
  modalEl = $("#modal");
  qrImgEl = $("#qrImg");
  qrFallbackEl = $("#qrFallback");
  mOfferIdEl = $("#mOfferId");
  mExpiresEl = $("#mExpires");
  copyBtnEl = $("#copyBtn");
  modalEl?.addEventListener("click", (e)=>{
    if (e.target?.hasAttribute?.("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl?.getAttribute("aria-hidden")==="false") closeModal();
  });
  copyBtnEl?.addEventListener("click", async () => {
    const code = qrFallbackEl?.dataset?.code || "";
    if (!code) return;
    try { await navigator.clipboard.writeText(code); copyBtnEl.textContent = "Скопировано"; setTimeout(()=>copyBtnEl.textContent="Скопировать код", 1200); }
    catch { /* no-op */ }
  });
}

function openReservationModal({ code="", offerId="—", expiresAt=null } = {}){
  const payload = `FOODY|${offerId}|${code}`;
  const qrUrl = code ? QR_BUILDER(payload) : "";

  if (qrUrl){
    qrImgEl.src = qrUrl;
    qrImgEl.style.display = "block";
    qrFallbackEl.style.display = "none";
  } else {
    qrImgEl.removeAttribute("src");
    qrImgEl.style.display = "none";
    qrFallbackEl.style.display = "block";
    qrFallbackEl.textContent = code || "—";
  }

  qrFallbackEl.dataset.code = code || "";
  mOfferIdEl.textContent = offerId || "—";
  mExpiresEl.textContent = expiresAt ? fmtExpires(expiresAt) : "—";

  modalEl.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}

function closeModal(){
  modalEl.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

// ---------- fetch with timeout ----------
async function request(url, { method="GET", headers={}, body, timeout=12000 } = {}){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new DOMException("Timeout","AbortError")), timeout);
  try{
    const res = await fetch(url, { method, headers, body, signal: ctl.signal, credentials: "omit" });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}
async function safeText(res){ try { return await res.text(); } catch{ return ""; } }
