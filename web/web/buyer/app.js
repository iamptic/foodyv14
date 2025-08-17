const API = "https://foodyback-production.up.railway.app";

document.addEventListener("DOMContentLoaded", () => {
  loadOffers();
});

async function loadOffers() {
  const container = document.getElementById("offers");
  container.innerHTML = "<p class='loading'>Загрузка предложений...</p>";

  try {
    const res = await fetch(`${API}/api/v1/public/offers`);
    if (!res.ok) throw new Error("Ошибка загрузки");

    const offers = await res.json();
    renderOffers(offers);
  } catch (err) {
    console.error("Ошибка загрузки офферов:", err);
    container.innerHTML =
      "<p class='error'>Не удалось загрузить офферы. Попробуйте обновить страницу.</p>";
  }
}

function renderOffers(offers) {
  const container = document.getElementById("offers");
  container.innerHTML = "";

  if (!offers || offers.length === 0) {
    container.innerHTML = "<p>Пока нет доступных предложений</p>";
    return;
  }

  offers.forEach((offer) => {
    const card = document.createElement("div");
    card.className = "offer-card";

    // рассчитываем скидку, если передано discount_steps или discount
    let discountLabel = "";
    if (offer.discount) {
      discountLabel = `<span class="discount">-${offer.discount}%</span>`;
    }

    card.innerHTML = `
      <div class="offer-photo">
        <img src="${offer.photo_url}" alt="Фото оффера" loading="lazy"/>
        ${discountLabel}
      </div>
      <div class="offer-info">
        <h3>${offer.title}</h3>
        <p class="desc">${offer.description || ""}</p>
        <p class="price">${offer.price} ₽</p>
        <p class="expires">
          Действительно до: ${new Date(offer.expires_at).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <button class="reserve-btn" data-id="${offer.id}">Забронировать</button>
      </div>
    `;

    container.appendChild(card);
  });

  bindReserve();
}

function bindReserve() {
  document.querySelectorAll(".reserve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      e.target.disabled = true;
      e.target.textContent = "Бронирование...";

      try {
        const res = await fetch(`${API}/api/v1/public/reserve/${id}`, {
          method: "POST",
        });

        if (!res.ok) throw new Error("Ошибка бронирования");

        const data = await res.json();
        alert("Забронировано! Ваш код: " + data.code);
      } catch (err) {
        console.error("Ошибка бронирования:", err);
        alert("Не удалось забронировать. Попробуйте ещё раз.");
      } finally {
        e.target.disabled = false;
        e.target.textContent = "Забронировать";
      }
    });
  });
}
