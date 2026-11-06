const $ = (selector) => document.querySelector(selector);
let selectedSide = "buy";
let recentEvents = [];

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function renderBook(book) {
  const bid = book.best_bid;
  const ask = book.best_ask;
  $("#best-bid").textContent = bid ? formatNumber(bid.price) : "—";
  $("#bid-size").textContent = bid ? `${formatNumber(bid.quantity)} units available` : "No bids";
  $("#best-ask").textContent = ask ? formatNumber(ask.price) : "—";
  $("#ask-size").textContent = ask ? `${formatNumber(ask.quantity)} units available` : "No asks";
  const spread = bid && ask ? ask.price - bid.price : null;
  $("#spread").textContent = spread === null ? "—" : formatNumber(spread);
  $("#spread-inline").textContent = spread === null ? "—" : formatNumber(spread);

  const maxQuantity = Math.max(1, ...book.bids.map((level) => level.quantity), ...book.asks.map((level) => level.quantity));
  const row = (level, side) => `<div class="book-row" style="--depth:${Math.max(8, (level.quantity / maxQuantity) * 100)}%;--depth-color:${side === "bid" ? "#1e7a5633" : "#963b4833"}"><span class="price">${formatNumber(level.price)}</span><span class="size">${formatNumber(level.quantity)}</span><span class="depth-value">${((level.quantity / maxQuantity) * 100).toFixed(0)}%</span></div>`;
  $("#asks").innerHTML = [...book.asks].reverse().map((level) => row(level, "ask")).join("");
  $("#bids").innerHTML = book.bids.map((level) => row(level, "bid")).join("");
}

function renderEvents() {
  $("#event-count").textContent = `${recentEvents.length} event${recentEvents.length === 1 ? "" : "s"}`;
  if (!recentEvents.length) {
    $("#events").innerHTML = '<div class="empty-events"><span>↳</span><p>Order acknowledgements, fills, cancels, and rejects will appear here.</p></div>';
    return;
  }
  $("#events").innerHTML = recentEvents.map((event) => {
    const label = event.type;
    const detail = event.type === "fill"
      ? `${formatNumber(event.quantity)} @ ${formatNumber(event.price)} · vs #${event.counterparty}`
      : event.type === "reject"
        ? `order #${event.order_id} · ${event.reason}`
        : event.type === "cancel"
          ? `order #${event.order_id} · ${formatNumber(event.quantity)} left`
          : `order #${event.order_id} · ${formatNumber(event.quantity)} resting`;
    const cancelButton = event.type === "ack" ? `<button class="cancel-event" data-order-id="${event.order_id}" type="button">Cancel</button>` : "";
    return `<div class="event-row"><span class="event-main"><span class="event-tag ${label}">${label}</span>${detail}</span><span class="event-actions">${cancelButton}<span class="event-detail">#${event.order_id}</span></span></div>`;
  }).join("");
  document.querySelectorAll(".cancel-event").forEach((button) => {
    button.addEventListener("click", () => cancelOrder(Number(button.dataset.orderId)));
  });
}

async function cancelOrder(orderId) {
  try {
    const response = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "Cancel request failed.");
    recentEvents = [...payload.events, ...recentEvents].slice(0, 12);
    renderEvents();
    renderBook(payload.book);
  } catch (error) {
    recentEvents = [{ type: "reject", order_id: "API", reason: error.message, quantity: 0, price: 0 }, ...recentEvents].slice(0, 12);
    renderEvents();
  }
}

async function refreshBook() {
  try {
    const response = await fetch("/api/book?depth=10");
    if (!response.ok) throw new Error("Book request failed");
    renderBook(await response.json());
    $("#connection").textContent = "Engine connected";
    $(".live-dot").classList.remove("offline");
  } catch {
    $("#connection").textContent = "Engine unavailable";
    $(".live-dot").classList.add("offline");
  }
}

document.querySelectorAll(".side-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedSide = button.dataset.side;
    document.querySelectorAll(".side-button").forEach((item) => item.classList.remove("active-buy", "active-sell"));
    button.classList.add(selectedSide === "buy" ? "active-buy" : "active-sell");
    const submit = $("#submit-order");
    submit.classList.toggle("sell-submit", selectedSide === "sell");
    submit.innerHTML = `Submit ${selectedSide} order <span>→</span>`;
  });
});

$("#order-type").addEventListener("change", (event) => {
  const market = event.target.value === "market";
  $("#price").disabled = market;
  $("#price-field").style.opacity = market ? ".45" : "1";
  if (market) $("#tif").value = "ioc";
});

$("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#submit-order");
  const type = $("#order-type").value;
  button.disabled = true;
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        side: selectedSide,
        type,
        tif: type === "market" ? "ioc" : $("#tif").value,
        price: type === "market" ? 0 : Number($("#price").value),
        quantity: Number($("#quantity").value),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail?.[0]?.msg || payload.detail || "Order was rejected by the API.");
    recentEvents = [...payload.events, ...recentEvents].slice(0, 12);
    renderEvents();
    renderBook(payload.book);
  } catch (error) {
    recentEvents = [{ type: "reject", order_id: "API", reason: error.message, quantity: 0, price: 0 }, ...recentEvents].slice(0, 12);
    renderEvents();
  } finally {
    button.disabled = false;
  }
});

refreshBook();
