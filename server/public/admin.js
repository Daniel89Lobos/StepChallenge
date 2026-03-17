const adminView = document.body.dataset.adminView || "dashboard";

const adminNotice = document.getElementById("adminNotice");
const adminTotalUsers = document.getElementById("adminTotalUsers");
const adminAdminUsers = document.getElementById("adminAdminUsers");
const adminPendingOrders = document.getElementById("adminPendingOrders");
const adminTotalOrders = document.getElementById("adminTotalOrders");
const adminTotalProducts = document.getElementById("adminTotalProducts");
const adminLowStockProducts = document.getElementById("adminLowStockProducts");
const adminOrders = document.getElementById("adminOrders");
const adminUsers = document.getElementById("adminUsers");
const adminProducts = document.getElementById("adminProducts");
const refreshOrdersButton = document.getElementById("refreshOrdersButton");
const refreshUsersButton = document.getElementById("refreshUsersButton");
const refreshProductsButton = document.getElementById("refreshProductsButton");
const adminProductCreateForm = document.getElementById("adminProductCreateForm");
const adminProductNameInput = document.getElementById("adminProductName");
const adminProductSlugInput = document.getElementById("adminProductSlug");
const adminProductSearchInput = document.getElementById("adminProductSearch");
const adminProductCategoryFilter = document.getElementById("adminProductCategoryFilter");
const adminProductStatusFilter = document.getElementById("adminProductStatusFilter");
const adminProductResults = document.getElementById("adminProductResults");

const expandedOrderDetails = new Map();

let adminProductMeta = {
  categories: ["books", "calendars", "amigurumi"],
  currency: "SEK",
  lowStockThreshold: 5,
};

const adminProductState = {
  products: [],
  filters: {
    search: "",
    category: "all",
    status: "all",
  },
};

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAdminDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("sv-SE");
}

function slugifyValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\"']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

async function uploadProductImage(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/admin/product-images", {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Could not upload image");
  }

  return data;
}

function clearProtectedRoots() {
  [adminOrders, adminUsers, adminProducts].forEach((root) => {
    if (root) {
      root.innerHTML = "";
    }
  });
}

function renderStats(stats) {
  if (adminTotalUsers) {
    adminTotalUsers.textContent = String(stats.totalUsers || 0);
  }

  if (adminAdminUsers) {
    adminAdminUsers.textContent = String(stats.adminUsers || 0);
  }

  if (adminPendingOrders) {
    adminPendingOrders.textContent = String(stats.pendingOrders || 0);
  }

  if (adminTotalOrders) {
    adminTotalOrders.textContent = String(stats.totalOrders || 0);
  }

  if (adminTotalProducts) {
    adminTotalProducts.textContent = String(stats.totalProducts || 0);
  }

  if (adminLowStockProducts) {
    adminLowStockProducts.textContent = String(stats.lowStockProducts || 0);
  }
}

function getOrderStatusClass(status) {
  if (status === "fulfilled") {
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
              <p class="muted">${escapeHtml(order.customer_name || order.customer_email || "Guest checkout")}</p>
            </div>
            <span class="status-pill ${getOrderStatusClass(order.fulfillment_status)}">${escapeHtml(order.fulfillment_status.replace(/_/g, " "))}</span>
          </div>
          <div class="admin-meta-grid">
            <p><strong>Payment:</strong> ${escapeHtml(order.payment_status)}</p>
            <p><strong>Items:</strong> ${order.item_count}</p>
            <p><strong>Total:</strong> ${window.LobosCart.formatMoney(order.total_amount)}</p>
            <p><strong>Created:</strong> ${formatAdminDate(order.created_at)}</p>
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
            <div class="admin-inline-actions">
              <button class="btn btn-secondary" type="submit">Update order</button>
              <button class="btn btn-secondary" type="button" data-order-toggle data-order-id="${order.id}">${expandedOrderDetails.has(order.id) ? "Hide details" : "View details"}</button>
            </div>
          </form>
          <div class="admin-order-detail" data-order-detail="${order.id}"${expandedOrderDetails.has(order.id) ? "" : " hidden"}>${expandedOrderDetails.get(order.id) || ""}</div>
        </article>
      `,
    )
    .join("");
}

function renderAddressLines(address) {
  if (!address || typeof address !== "object") {
    return ["No shipping address saved."];
  }

  const lines = [
    [address.line1, address.line2].filter(Boolean).join(", "),
    [address.postal_code, address.city].filter(Boolean).join(" "),
    address.state || "",
    address.country || "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : ["No shipping address saved."];
}

function renderOrderDetailMarkup(order) {
  const shipping = order.shippingAddress || {};
  const shippingAddress = shipping.address || shipping;
  const currency = String(order.currency || "SEK").toUpperCase();

  return `
    <div class="admin-detail-grid">
      <section>
        <h4>Customer</h4>
        <p><strong>Name:</strong> ${escapeHtml(order.customerName || shipping.name || "Guest checkout")}</p>
        <p><strong>Email:</strong> ${escapeHtml(order.customerEmail || "-")}</p>
        <p><strong>Phone:</strong> ${escapeHtml(order.phone || shipping.phone || "-")}</p>
      </section>
      <section>
        <h4>Shipping</h4>
        ${renderAddressLines(shippingAddress)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join("")}
      </section>
    </div>
    <section class="admin-order-lines">
      <h4>Items</h4>
      ${order.items
        .map(
          (item) => `
            <div class="admin-order-line">
              <div>
                <strong>${escapeHtml(item.productName)}</strong>
                <p class="muted">${item.quantity} x ${window.LobosCart.formatMoney(item.unitAmount, currency)}</p>
              </div>
              <strong>${window.LobosCart.formatMoney(item.lineTotal, currency)}</strong>
            </div>
          `,
        )
        .join("")}
      <div class="admin-order-totals">
        <p><span>Subtotal</span><strong>${window.LobosCart.formatMoney(order.subtotalAmount, currency)}</strong></p>
        <p><span>Shipping</span><strong>${window.LobosCart.formatMoney(order.shippingAmount, currency)}</strong></p>
        <p><span>Tax</span><strong>${window.LobosCart.formatMoney(order.taxAmount, currency)}</strong></p>
        <p class="admin-order-total"><span>Total</span><strong>${window.LobosCart.formatMoney(order.totalAmount, currency)}</strong></p>
      </div>
    </section>
  `;
}

async function toggleOrderDetails(orderId, toggleButton) {
  const detailContainer = adminOrders?.querySelector(`[data-order-detail="${orderId}"]`);

  if (!detailContainer) {
    return;
  }

  if (expandedOrderDetails.has(orderId)) {
    expandedOrderDetails.delete(orderId);
    detailContainer.hidden = true;
    detailContainer.innerHTML = "";
    toggleButton.textContent = "View details";
    return;
  }

  detailContainer.hidden = false;
  detailContainer.innerHTML = '<p class="muted">Loading order details...</p>';

  try {
    const data = await fetchAdminJson(`/api/admin/orders/${orderId}`);
    const markup = renderOrderDetailMarkup(data.order);
    expandedOrderDetails.set(orderId, markup);
    detailContainer.innerHTML = markup;
    toggleButton.textContent = "Hide details";
  } catch (error) {
    detailContainer.innerHTML = `<p class="page-status is-error">${escapeHtml(error.message || "Could not load order details.")}</p>`;
  }
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
              <h3>${escapeHtml(user.username)}</h3>
              <p class="muted">Created ${formatAdminDate(user.created_at)}</p>
            </div>
            <span class="status-pill ${user.is_admin ? "in-stock" : ""}">${user.is_admin ? "Admin" : "Customer"}</span>
          </div>
          <form class="admin-inline-form" data-user-form data-user-id="${user.id}">
            <label>
              Username
              <input name="username" type="text" value="${escapeHtml(user.username)}" required />
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

function getCategoryLabel(category) {
  if (category === "books") {
    return "Books";
  }

  if (category === "calendars") {
    return "Calendars";
  }

  if (category === "amigurumi") {
    return "Amigurumi";
  }

  return "Product";
}

function getProductStatus(product) {
  if (!product.active) {
    return {
      className: "",
      label: "Archived",
      key: "archived",
      note: "Hidden from the storefront until re-enabled.",
    };
  }

  if (product.stockStatus === "out_of_stock") {
    return {
      className: "out-of-stock",
      label: "Out of stock",
      key: "out_of_stock",
      note: "Visible in the catalog but unavailable for checkout.",
    };
  }

  if (product.stockStatus === "low_stock") {
    return {
      className: "low-stock",
      label: `Low stock (${product.stockQuantity})`,
      key: "low_stock",
      note: `Only ${product.stockQuantity} left before the item is out of stock.`,
    };
  }

  return {
    className: "in-stock",
    label: "In stock",
    key: "active",
    note: `Healthy stock level. Low-stock warning starts at ${adminProductMeta.lowStockThreshold}.`,
  };
}

function getProductCategoryOptions(selectedCategory) {
  return adminProductMeta.categories
    .map(
      (category) => `<option value="${category}"${category === selectedCategory ? " selected" : ""}>${getCategoryLabel(category)}</option>`,
    )
    .join("");
}

function formatPriceInputValue(unitAmount) {
  return (Number(unitAmount || 0) / 100).toFixed(2);
}

function getImagePreviewMarkup(imagePath, imageAlt) {
  if (!imagePath) {
    return `
      <div class="admin-image-preview is-empty" data-image-preview>
        <span>No image uploaded</span>
      </div>
      <p class="muted" data-image-path-label>No image selected yet.</p>
    `;
  }

  return `
    <div class="admin-image-preview" data-image-preview>
      <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(imageAlt)}" />
    </div>
    <p class="muted" data-image-path-label>${escapeHtml(imagePath)}</p>
  `;
}

function updateProductResultsLabel(visibleCount, totalCount) {
  if (!adminProductResults) {
    return;
  }

  if (totalCount === 0) {
    adminProductResults.textContent = "No products saved yet.";
    return;
  }

  adminProductResults.textContent = `Showing ${visibleCount} of ${totalCount} products.`;
}

function productMatchesFilters(product) {
  const { search, category, status } = adminProductState.filters;
  const productStatus = getProductStatus(product);
  const searchHaystack = [product.name, product.slug, product.description, product.imagePath]
    .join(" ")
    .toLowerCase();

  if (search && !searchHaystack.includes(search)) {
    return false;
  }

  if (category !== "all" && product.category !== category) {
    return false;
  }

  if (status === "all") {
    return true;
  }

  if (status === "active") {
    return product.active;
  }

  return productStatus.key === status;
}

function getFilteredProducts() {
  return adminProductState.products.filter(productMatchesFilters);
}

function renderProductList() {
  if (!adminProducts) {
    return;
  }

  const filteredProducts = getFilteredProducts();
  updateProductResultsLabel(filteredProducts.length, adminProductState.products.length);

  if (adminProductState.products.length === 0) {
    adminProducts.innerHTML = `
      <article class="empty-state">
        <h3>No products yet</h3>
        <p>Create your first product to start building the storefront catalog.</p>
      </article>
    `;
    return;
  }

  if (filteredProducts.length === 0) {
    adminProducts.innerHTML = `
      <article class="empty-state">
        <h3>No products match these filters</h3>
        <p>Try a different search term or change the category or status filters.</p>
      </article>
    `;
    return;
  }

  adminProducts.innerHTML = filteredProducts
    .map((product) => {
      const stockState = getProductStatus(product);
      const productHref = `product.html?slug=${encodeURIComponent(product.slug)}`;

      return `
        <article class="admin-card">
          <div class="admin-card-header">
            <div>
              <h3>${escapeHtml(product.name)}</h3>
              <p class="muted">/${escapeHtml(product.slug)}</p>
            </div>
            <span class="status-pill ${stockState.className}">${escapeHtml(stockState.label)}</span>
          </div>

          <div class="admin-meta-grid">
            <p><strong>Price:</strong> ${window.LobosCart.formatMoney(product.unitAmount, product.currency)}</p>
            <p><strong>Stock:</strong> ${product.stockQuantity}</p>
            <p><strong>Category:</strong> ${escapeHtml(getCategoryLabel(product.category))}</p>
            <p><strong>Updated:</strong> ${formatAdminDate(product.updatedAt)}</p>
          </div>

          <p class="muted admin-card-note">${escapeHtml(stockState.note)}</p>

          <form class="admin-inline-form" data-product-form data-product-id="${product.id}" data-pending-image-upload="false">
            <div class="admin-form-grid">
              <label>
                Product name
                <input name="name" type="text" value="${escapeHtml(product.name)}" required />
              </label>
              <label>
                Slug
                <input name="slug" type="text" value="${escapeHtml(product.slug)}" required />
              </label>
              <label>
                Category
                <select name="category" required>
                  ${getProductCategoryOptions(product.category)}
                </select>
              </label>
              <label>
                Price (kr)
                <input name="price" type="number" min="0" step="0.01" value="${formatPriceInputValue(product.unitAmount)}" required />
              </label>
              <label>
                Stock quantity
                <input name="stockQuantity" type="number" min="0" step="1" value="${product.stockQuantity}" required />
              </label>
              <label>
                Stripe tax code
                <input name="stripeTaxCode" type="text" value="${escapeHtml(product.stripeTaxCode || "")}" placeholder="Optional" />
              </label>
              <label class="checkbox-row admin-checkbox-field">
                <input name="active" type="checkbox" ${product.active ? "checked" : ""} />
                <span>Show in storefront</span>
              </label>
            </div>

            <label>
              Description
              <textarea name="description" required>${escapeHtml(product.description)}</textarea>
            </label>

            <section class="admin-image-field">
              <input name="imagePath" type="hidden" value="${escapeHtml(product.imagePath)}" />
              <div class="admin-image-preview-wrap">
                ${getImagePreviewMarkup(product.imagePath, `Preview of ${product.name}`)}
              </div>
              <div class="admin-image-controls">
                <label>
                  Product image
                  <input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
                </label>
                <div class="admin-inline-actions">
                  <button class="btn btn-secondary" type="button" data-upload-image>Upload image</button>
                  <button class="btn btn-secondary" type="button" data-clear-image>Clear image</button>
                </div>
              </div>
            </section>

            <div class="admin-inline-actions">
              <button class="btn btn-secondary" type="submit">Save product</button>
              ${product.active ? `<a class="text-link" href="${productHref}" target="_blank" rel="noreferrer">Open product page</a>` : '<span class="muted">Archived products are hidden from the storefront.</span>'}
            </div>
          </form>
        </article>
      `;
    })
    .join("");
}

function parsePriceToMinorUnits(value) {
  const normalizedValue = String(value || "")
    .trim()
    .replace(",", ".");
  const parsedValue = Number.parseFloat(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error("Enter a valid price in kronor.");
  }

  return Math.round(parsedValue * 100);
}

function getImagePathInput(form) {
  return form?.querySelector('input[name="imagePath"]');
}

function getImageFileInput(form) {
  return form?.querySelector('input[name="imageFile"]');
}

function getImagePreviewContainer(form) {
  return form?.querySelector("[data-image-preview]");
}

function getImagePathLabel(form) {
  return form?.querySelector("[data-image-path-label]");
}

function getProductImageAlt(form) {
  const productName = form?.querySelector('input[name="name"]')?.value?.trim();
  return productName ? `Preview of ${productName}` : "Product image preview";
}

function revokePreviewUrl(form) {
  const previousUrl = form?.dataset.previewUrl;

  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
    delete form.dataset.previewUrl;
  }
}

function setProductImagePreview(form, imagePath, options = {}) {
  const { previewUrl = null, label = null } = options;
  const imagePathInput = getImagePathInput(form);
  const previewContainer = getImagePreviewContainer(form);
  const pathLabel = getImagePathLabel(form);

  if (!imagePathInput || !previewContainer || !pathLabel) {
    return;
  }

  revokePreviewUrl(form);

  if (previewUrl) {
    form.dataset.previewUrl = previewUrl;
  }

  imagePathInput.value = imagePath || "";

  if (previewUrl || imagePath) {
    previewContainer.classList.remove("is-empty");
    previewContainer.innerHTML = `<img src="${escapeHtml(previewUrl || imagePath)}" alt="${escapeHtml(getProductImageAlt(form))}" />`;
    pathLabel.textContent = label || imagePath || "Image selected";
    return;
  }

  previewContainer.classList.add("is-empty");
  previewContainer.innerHTML = "<span>No image uploaded</span>";
  pathLabel.textContent = "No image selected yet.";
}

function markPendingImageUpload(form, isPending) {
  if (!form) {
    return;
  }

  form.dataset.pendingImageUpload = isPending ? "true" : "false";
}

function previewSelectedImageFile(form) {
  const imageFileInput = getImageFileInput(form);

  if (!imageFileInput?.files?.[0]) {
    markPendingImageUpload(form, false);
    setProductImagePreview(form, getImagePathInput(form)?.value || "");
    return;
  }

  const previewUrl = URL.createObjectURL(imageFileInput.files[0]);
  markPendingImageUpload(form, true);
  setProductImagePreview(form, getImagePathInput(form)?.value || "", {
    previewUrl,
    label: `Selected: ${imageFileInput.files[0].name}. Upload image to save it.`,
  });
}

function clearSelectedImage(form) {
  const imageFileInput = getImageFileInput(form);

  if (imageFileInput) {
    imageFileInput.value = "";
  }

  markPendingImageUpload(form, false);
  setProductImagePreview(form, "");
}

async function uploadSelectedImage(form, triggerButton) {
  const imageFileInput = getImageFileInput(form);
  const file = imageFileInput?.files?.[0];

  if (!file) {
    throw new Error("Choose an image before uploading.");
  }

  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "Uploading...";
  }

  try {
    const data = await uploadProductImage(file);
    markPendingImageUpload(form, false);
    setProductImagePreview(form, data.imagePath, {
      label: data.imagePath,
    });

    if (imageFileInput) {
      imageFileInput.value = "";
    }

    showAdminNotice("Image uploaded.", "success");
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = "Upload image";
    }
  }
}

function buildProductPayload(form) {
  const formData = new FormData(form);
  const stockQuantity = Number.parseInt(String(formData.get("stockQuantity") || ""), 10);
  const imagePath = String(formData.get("imagePath") || "").trim();

  if (form.dataset.pendingImageUpload === "true") {
    throw new Error("Upload the selected image before saving this product.");
  }

  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    throw new Error("Stock quantity must be zero or higher.");
  }

  if (!imagePath) {
    throw new Error("Upload an image for this product before saving.");
  }

  const name = String(formData.get("name") || "").trim();
  const slug = slugifyValue(String(formData.get("slug") || "").trim() || name);

  return {
    name,
    slug,
    category: String(formData.get("category") || "").trim().toLowerCase(),
    description: String(formData.get("description") || "").trim(),
    unitAmount: parsePriceToMinorUnits(formData.get("price")),
    stockQuantity,
    imagePath,
    stripeTaxCode: String(formData.get("stripeTaxCode") || "").trim(),
    active: formData.get("active") === "on",
  };
}

function resetCreateProductForm() {
  if (!adminProductCreateForm) {
    return;
  }

  adminProductCreateForm.reset();
  markPendingImageUpload(adminProductCreateForm, false);
  setProductImagePreview(adminProductCreateForm, "");

  if (adminProductSlugInput) {
    adminProductSlugInput.dataset.manual = "false";
    adminProductSlugInput.value = "";
  }
}

function syncCreateProductSlug() {
  if (!adminProductNameInput || !adminProductSlugInput) {
    return;
  }

  if (adminProductSlugInput.dataset.manual === "true") {
    return;
  }

  adminProductSlugInput.value = slugifyValue(adminProductNameInput.value);
}

function syncProductFilters() {
  adminProductState.filters.search = String(adminProductSearchInput?.value || "")
    .trim()
    .toLowerCase();
  adminProductState.filters.category = String(adminProductCategoryFilter?.value || "all");
  adminProductState.filters.status = String(adminProductStatusFilter?.value || "all");
  renderProductList();
}

function updateProductCategoryControls() {
  const categoryOptions = adminProductMeta.categories
    .map((category) => `<option value="${category}">${getCategoryLabel(category)}</option>`)
    .join("");

  const createSelect = adminProductCreateForm?.querySelector('select[name="category"]');
  if (createSelect) {
    createSelect.innerHTML = categoryOptions;
  }

  if (adminProductCategoryFilter) {
    const currentValue = adminProductCategoryFilter.value || "all";
    adminProductCategoryFilter.innerHTML = `<option value="all">All categories</option>${categoryOptions}`;
    adminProductCategoryFilter.value = adminProductMeta.categories.includes(currentValue) ? currentValue : "all";
  }
}

async function loadAdminSummary() {
  if (!adminTotalUsers) {
    return;
  }

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

async function loadAdminProducts() {
  const data = await fetchAdminJson("/api/admin/products");

  if (Array.isArray(data.categories) && data.categories.length > 0) {
    adminProductMeta.categories = data.categories;
  }

  if (data.currency) {
    adminProductMeta.currency = String(data.currency);
  }

  if (Number.isInteger(data.lowStockThreshold) && data.lowStockThreshold > 0) {
    adminProductMeta.lowStockThreshold = data.lowStockThreshold;
  }

  updateProductCategoryControls();
  adminProductState.products = Array.isArray(data.products) ? data.products : [];
  renderProductList();
}

function bindCreateProductForm() {
  if (!adminProductCreateForm) {
    return;
  }

  if (adminProductSlugInput) {
    adminProductSlugInput.dataset.manual = "false";
    adminProductSlugInput.addEventListener("input", () => {
      adminProductSlugInput.dataset.manual = adminProductSlugInput.value.trim().length > 0 ? "true" : "false";

      if (adminProductSlugInput.dataset.manual === "false") {
        syncCreateProductSlug();
      }
    });
  }

  adminProductNameInput?.addEventListener("input", syncCreateProductSlug);

  adminProductCreateForm.addEventListener("change", (event) => {
    if (event.target.closest('input[name="imageFile"]')) {
      previewSelectedImageFile(adminProductCreateForm);
    }
  });

  adminProductCreateForm.addEventListener("click", async (event) => {
    const uploadButton = event.target.closest("[data-upload-image]");
    const clearButton = event.target.closest("[data-clear-image]");

    if (uploadButton) {
      try {
        await uploadSelectedImage(adminProductCreateForm, uploadButton);
      } catch (error) {
        showAdminNotice(error.message || "Could not upload this image.");
      }
      return;
    }

    if (clearButton) {
      clearSelectedImage(adminProductCreateForm);
    }
  });

  adminProductCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const payload = buildProductPayload(adminProductCreateForm);
      const button = adminProductCreateForm.querySelector('button[type="submit"]');

      if (button) {
        button.disabled = true;
      }

      await fetchAdminJson("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      resetCreateProductForm();
      showAdminNotice("Product created.", "success");
    } catch (error) {
      showAdminNotice(error.message || "Could not create this product.");
    } finally {
      const button = adminProductCreateForm.querySelector('button[type="submit"]');

      if (button) {
        button.disabled = false;
      }
    }
  });
}

function bindProductManagement() {
  if (!adminProducts) {
    return;
  }

  adminProductSearchInput?.addEventListener("input", syncProductFilters);
  adminProductCategoryFilter?.addEventListener("change", syncProductFilters);
  adminProductStatusFilter?.addEventListener("change", syncProductFilters);

  refreshProductsButton?.addEventListener("click", () => {
    loadAdminProducts().catch((error) => showAdminNotice(error.message));
  });

  adminProducts.addEventListener("change", (event) => {
    const imageInput = event.target.closest('input[name="imageFile"]');

    if (!imageInput) {
      return;
    }

    const form = imageInput.closest("[data-product-form]");
    previewSelectedImageFile(form);
  });

  adminProducts.addEventListener("click", async (event) => {
    const uploadButton = event.target.closest("[data-upload-image]");
    const clearButton = event.target.closest("[data-clear-image]");

    if (!uploadButton && !clearButton) {
      return;
    }

    const form = event.target.closest("[data-product-form]");

    if (!form) {
      return;
    }

    if (uploadButton) {
      try {
        await uploadSelectedImage(form, uploadButton);
      } catch (error) {
        showAdminNotice(error.message || "Could not upload this image.");
      }
      return;
    }

    clearSelectedImage(form);
  });

  adminProducts.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-product-form]");

    if (!form) {
      return;
    }

    event.preventDefault();

    try {
      const productId = form.dataset.productId;
      const payload = buildProductPayload(form);
      const button = form.querySelector('button[type="submit"]');

      if (button) {
        button.disabled = true;
      }

      await fetchAdminJson(`/api/admin/products/${productId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      showAdminNotice("Product updated.", "success");
      await loadAdminProducts();
    } catch (error) {
      showAdminNotice(error.message || "Could not update this product.");
    } finally {
      const button = form.querySelector('button[type="submit"]');

      if (button && form.isConnected) {
        button.disabled = false;
      }
    }
  });
}

function bindOrders() {
  if (!adminOrders) {
    return;
  }

  refreshOrdersButton?.addEventListener("click", () => {
    loadAdminOrders().catch((error) => showAdminNotice(error.message));
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
      await loadAdminOrders();
    } catch (error) {
      showAdminNotice(error.message || "Could not update this order.");
    } finally {
      const button = form.querySelector('button[type="submit"]');

      if (button && form.isConnected) {
        button.disabled = false;
      }
    }
  });

  adminOrders.addEventListener("click", async (event) => {
    const toggleButton = event.target.closest("[data-order-toggle]");

    if (!toggleButton) {
      return;
    }

    const orderId = Number.parseInt(toggleButton.dataset.orderId, 10);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return;
    }

    await toggleOrderDetails(orderId, toggleButton);
  });
}

function bindUsers() {
  if (!adminUsers) {
    return;
  }

  refreshUsersButton?.addEventListener("click", () => {
    loadAdminUsers().catch((error) => showAdminNotice(error.message));
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
      await Promise.all([window.LobosAuth.refresh(), loadAdminUsers()]);
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

async function ensureAdminAccess() {
  clearAdminNotice();

  try {
    await window.LobosAuth.refresh();
    const user = window.LobosAuth.getUser();

    if (!user) {
      showAdminNotice("Log in with an admin account to use this page.");
      clearProtectedRoots();
      return false;
    }

    if (!user.isAdmin) {
      showAdminNotice("This account does not have admin access.");
      clearProtectedRoots();
      return false;
    }

    return true;
  } catch (error) {
    showAdminNotice(error.message || "Could not load the admin page.");
    clearProtectedRoots();
    return false;
  }
}

async function loadCurrentAdminView() {
  if (adminView === "dashboard") {
    await loadAdminSummary();
    return;
  }

  if (adminView === "add-product") {
    updateProductCategoryControls();
    return;
  }

  if (adminView === "products") {
    await loadAdminProducts();
    return;
  }

  if (adminView === "orders") {
    await loadAdminOrders();
    return;
  }

  if (adminView === "accounts") {
    await loadAdminUsers();
  }
}

async function initAdminPage() {
  bindCreateProductForm();
  bindProductManagement();
  bindOrders();
  bindUsers();

  const hasAccess = await ensureAdminAccess();

  if (!hasAccess) {
    return;
  }

  try {
    await loadCurrentAdminView();
  } catch (error) {
    showAdminNotice(error.message || "Could not load this admin section.");
  }
}

initAdminPage();
