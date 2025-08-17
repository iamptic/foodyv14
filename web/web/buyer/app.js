/* global FOODY_API */
const API = (typeof window !== "undefined" && window.FOODY_API) || "https://foodyback-production.up.railway.app";

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  const q = document.getElementById("q");
  const refreshBtn = document.getElementById("refresh");
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
    const badge = disc ? `<span class="badge">-${disc}%</span>` : "";

    const photo = o.photo_url || o.image_url || "";
    const title = escapeHtml(o.title || "Предложение");
    const desc = escapeHtml(o.description || "");
    const price = typeof o.price === "number" ? `${fmtPrice(o.price)} ₽` : (o.price || "");

    card.innerHTML = `
      <div class="photo">
        ${badge}
        ${photo ? `<img src="${photo}" alt="Фото: ${title}" loading="lazy">` : ""}
      </div>
      <div class="info">
        <h3 class="title">${title}</h3>
        ${desc ? `<p class="desc">${desc}</p>` : ""}
        <div class="row">
          <span class="price">${price}</span>
          ${o.expires_at ? `<span class="muted">до ${fmtExpires(o.expires_at)}</span>` : ""}
        </div>
        <div class="actions">
          <button class="btn btn-buy" data-id="${o.id}">Забронировать</button>
        </div>
      </div>
    `;

    // graceful image errors
    const img = card.querySelector("img");
    if (img){
      img.addEventListener("error", () => {
        img.remove();
      }, { once:true });
    }

    frag.appendChild(card);
  }
  grid.appendChild(frag);

  bindReserve();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// ---------- Data flow ----------
let lastOffers = [];

async function loadOffers({ force = false } = {}){
  setStatus(`<span class="muted">Загрузка предложений…</span>`);
  renderSkeleton();
  try{
    const data = await request(`${API}/api/v1/public/offers`, { timeout: 10000 });
    // сохраняем в кеш для поиска
    lastOffers = Array.isArray(data) ? data : (data?.items || []);
    setStatus("");
    renderOffers(lastOffers);
  }catch(err){
    console.error("[offers] load error:", err);
    setStatus(`<div class="alert error">Не удалось загрузить офферы. Проверьте соединение и попробуйте снова.</div>`);
    // оставим скелетон, чтобы не было «прыжка» на пустой экран
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

// ---------- Reserve ----------
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
        alert(code ? `Забронировано!\nВаш код: ${code}` : "Забронировано!");
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
