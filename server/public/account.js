const accountNotice = document.getElementById("accountNotice");
const guestAccountPanels = document.getElementById("guestAccountPanels");
const accountProfilePanel = document.getElementById("accountProfilePanel");
const accountProfileHeading = document.getElementById("accountProfileHeading");
const accountProfileUsername = document.getElementById("accountProfileUsername");
const accountOrders = document.getElementById("accountOrders");
const accountLoginForm = document.getElementById("accountLoginForm");
const accountRegisterForm = document.getElementById("accountRegisterForm");
const accountLoginButton = document.getElementById("accountLoginButton");
const accountRegisterButton = document.getElementById("accountRegisterButton");
const accountLogoutButton = document.getElementById("accountLogoutButton");
const accountAdminLink = document.getElementById("accountAdminLink");
const expandedAccountOrderIds = new Set();
let accountOrdersCache = [];

function showAccountNotice(message, type = "error") {
  if (!accountNotice) {
    return;
  }

  accountNotice.hidden = false;
  accountNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  accountNotice.textContent = message;
}

function clearAccountNotice() {
  if (!accountNotice) {
    return;
  }

  accountNotice.hidden = true;
  accountNotice.className = "page-status";
  accountNotice.textContent = "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAccountDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("sv-SE");
}

function getOrderStatusClass(status) {
  if (status === "paid") {
    return "processing";
  }

  if (status === "packed") {
    return "processing";
  }

  if (status === "fulfilled") {
    return "in-stock";
  }

  if (status === "delivered") {
    return "in-stock";
  }

  if (status === "inventory_issue") {
    return "low-stock";
  }

  if (status === "cancelled") {
    return "out-of-stock";
  }

  return "";
}

function getCustomerOrderStatus(status) {
  if (status === "paid") {
    return {
      label: "Processing",
      detail: "We have your payment and are preparing your order now.",
    };
  }

  if (status === "fulfilled") {
    return {
      label: "Sent",
      detail: "Your order has been sent and is on the way.",
    };
  }

  if (status === "packed") {
    return {
      label: "Packed",
      detail: "Your order is packed and nearly ready to leave the shop.",
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

function getAddressLines(order) {
  const shipping = parseAddress(order.shippingAddress);
  const address = shipping?.address || shipping;

  if (!address || typeof address !== "object") {
    return [];
  }

  return [
    shipping?.name,
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(" "),
    address.state,
    address.country,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function renderExpandedOrderDetails(order) {
  const addressLines = getAddressLines(order);

  return `
    <div class="account-order-detail-grid">
      <section>
        <h5>Shipping</h5>
        ${addressLines.length > 0 ? addressLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") : '<p class="muted">Shipping address saved during checkout.</p>'}
      </section>
      <section>
        <h5>Order details</h5>
        <p><strong>Tracking:</strong> ${escapeHtml(order.trackingNumber || "Not assigned yet")}</p>
        ${order.customerNote ? `<p><strong>Message from Lobos Shop:</strong> ${escapeHtml(order.customerNote)}</p>` : '<p class="muted">No new message from Lobos Shop right now.</p>'}
      </section>
    </div>
    <div class="account-order-totals">
      <p><span>Subtotal</span><strong>${window.LobosCart.formatMoney(order.subtotalAmount, order.currency)}</strong></p>
      <p><span>Shipping</span><strong>${window.LobosCart.formatMoney(order.shippingAmount, order.currency)}</strong></p>
      <p><span>Tax</span><strong>${window.LobosCart.formatMoney(order.taxAmount, order.currency)}</strong></p>
    </div>
  `;
}

async function fetchProfile() {
  const response = await fetch("/api/user/profile", {
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(data.error || "Could not load your account");
  }

  return data.user || null;
}

async function fetchUserOrders() {
  const response = await fetch("/api/user/orders", {
    credentials: "include",
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    return [];
  }

  if (!response.ok) {
    throw new Error(data.error || "Could not load your orders");
  }

  return Array.isArray(data.orders) ? data.orders : [];
}

function renderGuestPanels() {
  expandedAccountOrderIds.clear();
  guestAccountPanels.hidden = false;
  accountProfilePanel.hidden = true;
  accountLoginForm?.reset();
  accountRegisterForm?.reset();

  if (accountAdminLink) {
    accountAdminLink.hidden = true;
  }

  if (accountOrders) {
    accountOrdersCache = [];
    accountOrders.innerHTML = "";
  }
}

function renderProfilePanel(user) {
  if (!user) {
    renderGuestPanels();
    return;
  }

  guestAccountPanels.hidden = true;
  accountProfilePanel.hidden = false;
  accountProfileHeading.textContent = `Welcome, ${user.username}`;
  accountProfileUsername.textContent = user.username || "-";

  if (accountAdminLink) {
    accountAdminLink.hidden = !(user.is_admin || user.isAdmin);
  }
}

function renderOrderHistory(orders) {
  if (!accountOrders) {
    return;
  }

  if (!orders || orders.length === 0) {
    accountOrders.innerHTML = `
      <article class="empty-state account-empty-state">
        <h4>No orders yet</h4>
        <p>Orders placed while signed in will appear here with their status and shipping details.</p>
      </article>
    `;
    return;
  }

  accountOrders.innerHTML = orders
    .map((order) => {
      const customerStatus = getCustomerOrderStatus(order.fulfillmentStatus);
      const isExpanded = expandedAccountOrderIds.has(order.id);

      return `
        <article class="account-order-card">
          <div class="account-order-header">
            <div>
              <h4>Order #${order.id}</h4>
              <p class="muted">Placed ${formatAccountDate(order.createdAt)}</p>
              <p class="muted account-order-status-copy">${escapeHtml(customerStatus.detail)}</p>
              ${order.customerNote ? `<p class="account-customer-note"><strong>Message from Lobos Shop:</strong> ${escapeHtml(order.customerNote)}</p>` : ""}
            </div>
            <span class="status-pill ${getOrderStatusClass(order.fulfillmentStatus)}">${escapeHtml(customerStatus.label)}</span>
          </div>
          <div class="account-order-meta">
            <p><strong>Total:</strong> ${window.LobosCart.formatMoney(order.totalAmount, order.currency)}</p>
            <p><strong>Payment:</strong> ${escapeHtml(getCustomerPaymentLabel(order.paymentStatus))}</p>
            <p><strong>Items:</strong> ${order.items.length}</p>
            <p><strong>Tracking:</strong> ${escapeHtml(order.trackingNumber || "Not assigned yet")}</p>
          </div>
          <section class="account-order-items">
            ${order.items
              .map(
                (item) => `
                  <div class="account-order-item">
                    <div>
                      <strong>${escapeHtml(item.productName)}</strong>
                      <p class="muted">${item.quantity} x ${window.LobosCart.formatMoney(item.unitAmount, order.currency)}</p>
                    </div>
                    <strong>${window.LobosCart.formatMoney(item.lineTotal, order.currency)}</strong>
                  </div>
                `,
              )
              .join("")}
          </section>
          <div class="account-order-actions">
            <button class="btn btn-secondary" type="button" data-account-order-toggle="${order.id}">${isExpanded ? "Hide details" : "View details"}</button>
          </div>
          <div class="account-order-detail"${isExpanded ? "" : " hidden"}>
            ${isExpanded ? renderExpandedOrderDetails(order) : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function setAccountLoading(button, isLoading, idleText, busyText) {
  if (!button) {
    return;
  }

  button.disabled = isLoading;
  button.textContent = isLoading ? busyText : idleText;
}

async function refreshAccountPage() {
  if (!guestAccountPanels || !accountProfilePanel) {
    return;
  }

  await window.LobosAuth.refresh();
  const sessionUser = window.LobosAuth.getUser();

  if (!sessionUser) {
    renderGuestPanels();
    return;
  }

  const [profileResult, ordersResult] = await Promise.allSettled([
    fetchProfile(),
    fetchUserOrders(),
  ]);

  const profileUser = profileResult.status === "fulfilled" ? profileResult.value || sessionUser : sessionUser;
  renderProfilePanel(profileUser);

  if (ordersResult.status === "fulfilled") {
    accountOrdersCache = ordersResult.value;
    renderOrderHistory(accountOrdersCache);
  } else {
    accountOrdersCache = [];
    renderOrderHistory([]);
  }

  if (profileResult.status === "rejected") {
    showAccountNotice(profileResult.reason?.message || "Could not load your account.");
  } else if (ordersResult.status === "rejected") {
    showAccountNotice(ordersResult.reason?.message || "Could not load your orders.");
  }
}

if (guestAccountPanels && accountProfilePanel) {
  refreshAccountPage();

  accountOrders?.addEventListener("click", (event) => {
    const toggleButton = event.target.closest("[data-account-order-toggle]");

    if (!toggleButton) {
      return;
    }

    const orderId = Number.parseInt(toggleButton.dataset.accountOrderToggle, 10);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return;
    }

    if (expandedAccountOrderIds.has(orderId)) {
      expandedAccountOrderIds.delete(orderId);
    } else {
      expandedAccountOrderIds.add(orderId);
    }

    renderOrderHistory(accountOrdersCache);
  });

  accountLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAccountNotice();

    const formData = new FormData(accountLoginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      showAccountNotice("Enter both your username and password.");
      return;
    }

    try {
      setAccountLoading(accountLoginButton, true, "Log in", "Logging in...");
      await window.LobosAuth.login(username, password);
      await refreshAccountPage();
      showAccountNotice("You are now logged in.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not log in.");
    } finally {
      setAccountLoading(accountLoginButton, false, "Log in", "Logging in...");
    }
  });

  accountRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAccountNotice();

    const formData = new FormData(accountRegisterForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      showAccountNotice("Choose a username and password to create your account.");
      return;
    }

    try {
      setAccountLoading(accountRegisterButton, true, "Create account", "Creating account...");
      await window.LobosAuth.registerAndLogin({ username, password });
      await refreshAccountPage();
      showAccountNotice("Your account is ready and you are now logged in.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not create your account.");
    } finally {
      setAccountLoading(accountRegisterButton, false, "Create account", "Creating account...");
    }
  });

  accountLogoutButton?.addEventListener("click", async () => {
    clearAccountNotice();

    try {
      setAccountLoading(accountLogoutButton, true, "Log out", "Logging out...");
      await window.LobosAuth.logout();
      await refreshAccountPage();
      showAccountNotice("You are now logged out.", "success");
    } catch (error) {
      showAccountNotice(error.message || "Could not log out.");
    } finally {
      setAccountLoading(accountLogoutButton, false, "Log out", "Logging out...");
    }
  });
}
