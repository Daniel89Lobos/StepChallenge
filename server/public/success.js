const orderStatus = document.getElementById("orderStatus");
const orderSummary = document.getElementById("orderSummary");

function parseAddress(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function showOrderStatus(message, type = "") {
  if (!orderStatus) {
    return;
  }

  orderStatus.hidden = false;
  orderStatus.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  orderStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCustomerOrderStatus(status) {
  if (status === "paid") {
    return {
      label: "Processing",
      detail: "We have your payment and are preparing your order now.",
    };
  }

  if (status === "packed") {
    return {
      label: "Packed",
      detail: "Your order is packed and nearly ready to leave the shop.",
    };
  }

  if (status === "fulfilled") {
    return {
      label: "Sent",
      detail: "Your order has been sent and is on the way.",
    };
  }

  if (status === "delivered") {
    return {
      label: "Delivered",
      detail: "Your order has been marked as delivered.",
    };
  }

  if (status === "inventory_issue") {
    return {
      label: "Needs attention",
      detail: "We are reviewing stock for this order and will update you soon.",
    };
  }

  if (status === "cancelled") {
    return {
      label: "Cancelled",
      detail: "This order has been cancelled.",
    };
  }

  return {
    label: String(status || "Order update"),
    detail: "We will keep your order status updated here.",
  };
}

function getCustomerPaymentLabel(status) {
  if (status === "paid") {
    return "Payment received";
  }

  return String(status || "-").replace(/_/g, " ");
}

function renderOrder(order) {
  if (!orderSummary) {
    return;
  }

  const address = parseAddress(order.shippingAddress);
  const customerStatus = getCustomerOrderStatus(order.fulfillmentStatus);
  const addressLines = [
    address?.name,
    address?.address?.line1,
    address?.address?.line2,
    [address?.address?.postal_code, address?.address?.city].filter(Boolean).join(" "),
    address?.address?.country,
  ].filter(Boolean);

  orderSummary.innerHTML = `
    <section class="order-card">
      <h2>Order #${order.id}</h2>
      <p class="muted">Payment: ${getCustomerPaymentLabel(order.paymentStatus)}</p>
      <p class="muted">Status: ${customerStatus.label}</p>
      <p class="muted">${customerStatus.detail}</p>
      ${order.customerNote ? `<p><strong>Message from Lobos Shop:</strong> ${escapeHtml(order.customerNote)}</p>` : ""}
      <p class="muted">Email: ${order.customerEmail || "Captured in Stripe"}</p>
      <div class="order-list">
        ${order.items
          .map(
            (item) => `
              <div class="order-list-item">
                <span>${item.productName} x ${item.quantity}</span>
                <strong>${window.LobosCart.formatMoney(item.lineTotal)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="summary-row"><span>Subtotal</span><strong>${window.LobosCart.formatMoney(order.subtotalAmount)}</strong></div>
      <div class="summary-row"><span>Shipping</span><strong>${window.LobosCart.formatMoney(order.shippingAmount)}</strong></div>
      <div class="summary-row"><span>Tax</span><strong>${window.LobosCart.formatMoney(order.taxAmount)}</strong></div>
      <div class="summary-row total"><span>Total</span><strong>${window.LobosCart.formatMoney(order.totalAmount)}</strong></div>
      <p class="muted">${addressLines.length > 0 ? `Shipping to: ${addressLines.join(", ")}` : "Shipping address captured in Stripe Checkout."}</p>
    </section>
  `;
}

async function loadOrderSummary(attempt = 0) {
  const sessionId = new URLSearchParams(window.location.search).get("session_id");

  if (!sessionId) {
    showOrderStatus("Missing checkout session id. Return to the shop and try again.", "error");
    return;
  }

  try {
    const response = await fetch(`/api/orders/checkout-session/${encodeURIComponent(sessionId)}`);

    if (response.status === 404 && attempt < 4) {
      showOrderStatus("Payment received. Waiting for the order confirmation to finish...", "success");
      setTimeout(() => loadOrderSummary(attempt + 1), 1500);
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load order summary");
    }

    showOrderStatus("Payment confirmed. Your order is now in the system.", "success");
    renderOrder(data.order);
    await window.LobosCart.clear();
  } catch (error) {
    showOrderStatus(error.message, "error");
  }
}

if (orderSummary) {
  loadOrderSummary();
}
