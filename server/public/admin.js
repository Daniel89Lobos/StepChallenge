const adminNotice = document.getElementById("adminNotice");
const adminTotalUsers = document.getElementById("adminTotalUsers");
const adminAdminUsers = document.getElementById("adminAdminUsers");
const adminPendingOrders = document.getElementById("adminPendingOrders");
const adminTotalOrders = document.getElementById("adminTotalOrders");
const adminOrders = document.getElementById("adminOrders");
const adminUsers = document.getElementById("adminUsers");
const refreshOrdersButton = document.getElementById("refreshOrdersButton");
const refreshUsersButton = document.getElementById("refreshUsersButton");

function showAdminNotice(message, type = "error") {
  if (!adminNotice) {
    return;
  }

  adminNotice.hidden = false;
  adminNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  adminNotice.textContent = message;
}

function clearAdminNotice() {
  if (!adminNotice) {
    return;
  }

  adminNotice.hidden = true;
  adminNotice.className = "page-status";
  adminNotice.textContent = "";
}

async function fetchAdminJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Admin request failed");
  }

  return data;
}

function renderStats(stats) {
  adminTotalUsers.textContent = String(stats.totalUsers || 0);
  adminAdminUsers.textContent = String(stats.adminUsers || 0);
  adminPendingOrders.textContent = String(stats.pendingOrders || 0);
  adminTotalOrders.textContent = String(stats.totalOrders || 0);
}

function renderOrders(orders) {
  if (!adminOrders) {
    return;
  }

  if (!orders || orders.length === 0) {
    adminOrders.innerHTML = `
      <article class="empty-state">
        <h3>No pending orders</h3>
        <p>Everything is either fulfilled or cancelled right now.</p>
      </article>
    `;
    return;
  }

  adminOrders.innerHTML = orders
    .map(
      (order) => `
        <article class="admin-card">
          <div class="admin-card-header">
            <div>
              <h3>Order #${order.id}</h3>
              <p class="muted">${order.customer_name || order.customer_email || "Guest checkout"}</p>
            </div>
            <span class="status-pill ${order.fulfillment_status === "fulfilled" ? "in-stock" : "out-of-stock"}">${order.fulfillment_status.replace(/_/g, " ")}</span>
          </div>
          <div class="admin-meta-grid">
            <p><strong>Payment:</strong> ${order.payment_status}</p>
            <p><strong>Items:</strong> ${order.item_count}</p>
            <p><strong>Total:</strong> ${window.LobosCart.formatMoney(order.total_amount)}</p>
            <p><strong>Created:</strong> ${new Date(order.created_at).toLocaleString("sv-SE")}</p>
          </div>
          <form class="admin-inline-form" data-order-form data-order-id="${order.id}">
            <label>
              Fulfillment status
              <select name="fulfillmentStatus">
                ${["paid", "fulfilled", "inventory_issue", "cancelled"]
                  .map(
                    (status) => `<option value="${status}"${status === order.fulfillment_status ? " selected" : ""}>${status.replace(/_/g, " ")}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <button class="btn btn-secondary" type="submit">Update order</button>
          </form>
        </article>
      `,
    )
    .join("");
}

function renderUsers(users) {
  if (!adminUsers) {
    return;
  }

  if (!users || users.length === 0) {
    adminUsers.innerHTML = `
      <article class="empty-state">
        <h3>No accounts yet</h3>
        <p>Created users will appear here.</p>
      </article>
    `;
    return;
  }

  adminUsers.innerHTML = users
    .map(
      (user) => `
        <article class="admin-card">
          <div class="admin-card-header">
            <div>
              <h3>${user.username}</h3>
              <p class="muted">Created ${new Date(user.created_at).toLocaleString("sv-SE")}</p>
            </div>
            <span class="status-pill ${user.is_admin ? "in-stock" : ""}">${user.is_admin ? "Admin" : "Customer"}</span>
          </div>
          <form class="admin-inline-form" data-user-form data-user-id="${user.id}">
            <label>
              Username
              <input name="username" type="text" value="${user.username}" required />
            </label>
            <label>
              New password <span class="muted">(optional)</span>
              <input name="newPassword" type="password" autocomplete="new-password" />
            </label>
            <label class="checkbox-row">
              <input name="isAdmin" type="checkbox" ${user.is_admin ? "checked" : ""} />
              <span>Admin access</span>
            </label>
            <button class="btn btn-secondary" type="submit">Save account</button>
          </form>
        </article>
      `,
    )
    .join("");
}

async function loadAdminSummary() {
  const data = await fetchAdminJson("/api/admin/summary");
  renderStats(data.stats || {});
}

async function loadAdminOrders() {
  const data = await fetchAdminJson("/api/admin/orders?status=pending");
  renderOrders(data.orders || []);
}

async function loadAdminUsers() {
  const data = await fetchAdminJson("/api/admin/users");
  renderUsers(data.users || []);
}

async function loadAdminPage() {
  clearAdminNotice();

  try {
    await window.LobosAuth.refresh();
    const user = window.LobosAuth.getUser();

    if (!user) {
      showAdminNotice("Log in with an admin account to use this page.");
      if (adminOrders) {
        adminOrders.innerHTML = "";
      }
      if (adminUsers) {
        adminUsers.innerHTML = "";
      }
      return;
    }

    if (!user.isAdmin) {
      showAdminNotice("This account does not have admin access.");
      if (adminOrders) {
        adminOrders.innerHTML = "";
      }
      if (adminUsers) {
        adminUsers.innerHTML = "";
      }
      return;
    }

    await Promise.all([loadAdminSummary(), loadAdminOrders(), loadAdminUsers()]);
  } catch (error) {
    showAdminNotice(error.message || "Could not load the admin dashboard.");
  }
}

if (adminOrders && adminUsers) {
  loadAdminPage();

  refreshOrdersButton?.addEventListener("click", () => {
    loadAdminOrders().catch((error) => showAdminNotice(error.message));
  });

  refreshUsersButton?.addEventListener("click", () => {
    loadAdminUsers().catch((error) => showAdminNotice(error.message));
  });

  adminOrders.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-order-form]");

    if (!form) {
      return;
    }

    event.preventDefault();

    try {
      const formData = new FormData(form);
      const orderId = form.dataset.orderId;
      const button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
      }

      await fetchAdminJson(`/api/admin/orders/${orderId}`, {
        method: "PUT",
        body: JSON.stringify({
          fulfillmentStatus: String(formData.get("fulfillmentStatus") || ""),
        }),
      });

      showAdminNotice(`Order #${orderId} updated.`, "success");
      await Promise.all([loadAdminSummary(), loadAdminOrders()]);
    } catch (error) {
      showAdminNotice(error.message || "Could not update this order.");
    } finally {
      const button = form.querySelector('button[type="submit"]');
      if (button && form.isConnected) {
        button.disabled = false;
      }
    }
  });

  adminUsers.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-user-form]");

    if (!form) {
      return;
    }

    event.preventDefault();

    try {
      const formData = new FormData(form);
      const userId = form.dataset.userId;
      const button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
      }

      await fetchAdminJson(`/api/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          newPassword: String(formData.get("newPassword") || ""),
          isAdmin: formData.get("isAdmin") === "on",
        }),
      });

      showAdminNotice("Account updated.", "success");
      await Promise.all([window.LobosAuth.refresh(), loadAdminSummary(), loadAdminUsers()]);
    } catch (error) {
      showAdminNotice(error.message || "Could not update this account.");
    } finally {
      const button = form.querySelector('button[type="submit"]');
      if (button && form.isConnected) {
        button.disabled = false;
      }
    }
  });
}
