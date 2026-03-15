const cartItemsRoot = document.getElementById("cartItems");
const cartNotice = document.getElementById("cartNotice");
const subtotalValue = document.getElementById("subtotalValue");
const shippingValue = document.getElementById("shippingValue");
const totalValue = document.getElementById("totalValue");
const checkoutButton = document.getElementById("checkoutButton");
const checkoutGate = document.getElementById("checkoutGate");
const checkoutGateChoice = document.getElementById("checkoutGateChoice");
const checkoutLoginForm = document.getElementById("checkoutLoginForm");
const checkoutRegisterForm = document.getElementById("checkoutRegisterForm");
const checkoutAuthNotice = document.getElementById("checkoutAuthNotice");
const checkoutRegisterNotice = document.getElementById("checkoutRegisterNotice");
const guestCheckoutButton = document.getElementById("guestCheckoutButton");
const showLoginButton = document.getElementById("showLoginButton");
const showRegisterButton = document.getElementById("showRegisterButton");
const loginAndCheckoutButton = document.getElementById("loginAndCheckoutButton");
const createAccountAndCheckoutButton = document.getElementById("createAccountAndCheckoutButton");
const backToCheckoutChoiceButton = document.getElementById("backToCheckoutChoiceButton");
const backToCheckoutChoiceFromRegisterButton = document.getElementById("backToCheckoutChoiceFromRegisterButton");
const checkoutUsernameInput = document.getElementById("checkoutUsername");
const checkoutRegisterUsernameInput = document.getElementById("checkoutRegisterUsername");

let cartProducts = [];
let shippingAmount = 0;
let catalogSource = "api";
const defaultCheckoutButtonLabel = checkoutButton ? checkoutButton.textContent : "Continue to Stripe Checkout";

function getCategoryLabel(category) {
  if (category === "books") {
    return "Book";
  }

  if (category === "calendars") {
    return "Calendar";
  }

  if (category === "amigurumi") {
    return "Amigurumi";
  }

  return "Product";
}

function getProductShopHref(product) {
  return `product.html?slug=${encodeURIComponent(product.slug)}`;
}

function showCartNotice(message, type = "error") {
  if (!cartNotice) {
    return;
  }

  cartNotice.hidden = false;
  cartNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  cartNotice.textContent = message;
}

function clearCartNotice() {
  if (!cartNotice) {
    return;
  }

  cartNotice.hidden = true;
  cartNotice.textContent = "";
  cartNotice.className = "page-status";
}

function showCheckoutAuthNotice(message, type = "error") {
  if (!checkoutAuthNotice) {
    return;
  }

  checkoutAuthNotice.hidden = false;
  checkoutAuthNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  checkoutAuthNotice.textContent = message;
}

function clearCheckoutAuthNotice() {
  if (!checkoutAuthNotice) {
    return;
  }

  checkoutAuthNotice.hidden = true;
  checkoutAuthNotice.className = "page-status";
  checkoutAuthNotice.textContent = "";
}

function showCheckoutRegisterNotice(message, type = "error") {
  if (!checkoutRegisterNotice) {
    return;
  }

  checkoutRegisterNotice.hidden = false;
  checkoutRegisterNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  checkoutRegisterNotice.textContent = message;
}

function clearCheckoutRegisterNotice() {
  if (!checkoutRegisterNotice) {
    return;
  }

  checkoutRegisterNotice.hidden = true;
  checkoutRegisterNotice.className = "page-status";
  checkoutRegisterNotice.textContent = "";
}

function showCheckoutGateView(view) {
  if (!checkoutGateChoice || !checkoutLoginForm || !checkoutRegisterForm) {
    return;
  }

  checkoutGateChoice.hidden = view !== "choice";
  checkoutLoginForm.hidden = view !== "login";
  checkoutRegisterForm.hidden = view !== "register";

  if (checkoutGate?.hidden) {
    return;
  }

  if (view === "login") {
    checkoutUsernameInput?.focus();
  } else if (view === "register") {
    checkoutRegisterUsernameInput?.focus();
  } else {
    guestCheckoutButton?.focus();
  }
}

function openCheckoutGate(view = "choice") {
  if (!checkoutGate) {
    return;
  }

  clearCheckoutAuthNotice();
  clearCheckoutRegisterNotice();
  checkoutGate.hidden = false;
  document.body.classList.add("modal-open");
  showCheckoutGateView(view);
}

function closeCheckoutGate() {
  if (!checkoutGate) {
    return;
  }

  checkoutGate.hidden = true;
  document.body.classList.remove("modal-open");
  clearCheckoutAuthNotice();
  clearCheckoutRegisterNotice();
  checkoutLoginForm?.reset();
  checkoutRegisterForm?.reset();
  showCheckoutGateView("choice");
}

function setCheckoutButtonLoading(isLoading, label = defaultCheckoutButtonLabel) {
  if (!checkoutButton) {
    return;
  }

  checkoutButton.disabled = isLoading;
  checkoutButton.textContent = label;
}

function setLoginCheckoutLoading(isLoading) {
  if (!loginAndCheckoutButton || !guestCheckoutButton || !showLoginButton || !backToCheckoutChoiceButton) {
    return;
  }

  loginAndCheckoutButton.disabled = isLoading;
  guestCheckoutButton.disabled = isLoading;
  showLoginButton.disabled = isLoading;
  backToCheckoutChoiceButton.disabled = isLoading;
  loginAndCheckoutButton.textContent = isLoading ? "Logging in..." : "Log in and continue";
}

function setRegisterCheckoutLoading(isLoading) {
  if (!createAccountAndCheckoutButton || !guestCheckoutButton || !showRegisterButton || !backToCheckoutChoiceFromRegisterButton) {
    return;
  }

  createAccountAndCheckoutButton.disabled = isLoading;
  guestCheckoutButton.disabled = isLoading;
  showRegisterButton.disabled = isLoading;
  backToCheckoutChoiceFromRegisterButton.disabled = isLoading;
  createAccountAndCheckoutButton.textContent = isLoading ? "Creating account..." : "Create account and continue";
}

function getCheckoutState() {
  if (catalogSource === "fallback") {
    showCartNotice(
      "Checkout cannot start yet because the live backend is missing. The website is currently running in catalog-only mode.",
    );
    return null;
  }

  const state = getCartState();

  if (state.validItems.length === 0 || state.unavailableItems.length > 0) {
    showCartNotice("Please fix the cart before continuing to payment.");
    return null;
  }

  return state;
}

async function startCheckout(state = getCheckoutState()) {
  if (!state) {
    return;
  }

  try {
    setCheckoutButtonLoading(true, "Redirecting...");

    const response = await fetch("/api/checkout/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: state.validItems.map((item) => ({ productId: item.product.id, quantity: item.quantity })) }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not start checkout");
    }

    window.location.href = data.url;
  } catch (error) {
    showCartNotice(error.message);
    setCheckoutButtonLoading(false, defaultCheckoutButtonLabel);
  }
}

async function handleCheckoutClick() {
  const state = getCheckoutState();

  if (!state) {
    return;
  }

  await window.LobosCart.refresh();
  const cartScope = window.LobosCart.getScope();

  if (cartScope.type === "user" && cartScope.userId) {
    startCheckout(getCheckoutState());
    return;
  }

  openCheckoutGate("choice");
}

async function loginAndContinueCheckout(username, password) {
  await window.LobosAuth.login(username, password);
  renderCart();
  closeCheckoutGate();
  await startCheckout(getCheckoutState());
}

async function createAccountAndContinueCheckout(username, password, group) {
  await window.LobosAuth.registerAndLogin({ username, password, group });
  renderCart();
  closeCheckoutGate();
  await startCheckout(getCheckoutState());
}

function getCartState() {
  const items = window.LobosCart.getItems();
  const productMap = new Map(cartProducts.map((product) => [product.id, product]));
  const validItems = [];
  const unavailableItems = [];

  items.forEach((item) => {
    const product = productMap.get(item.productId);

    if (!product) {
      unavailableItems.push({
        productId: item.productId,
        quantity: item.quantity,
        reason: "This product is no longer available.",
      });
      return;
    }

    if (product.stockQuantity < item.quantity) {
      unavailableItems.push({
        productId: item.productId,
        product,
        quantity: item.quantity,
        reason: `${product.name} only has ${product.stockQuantity} left in stock.`,
      });
      return;
    }

    validItems.push({
      product,
      quantity: item.quantity,
      lineTotal: product.unitAmount * item.quantity,
    });
  });

  const subtotal = validItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const currentShipping = subtotal > 0 ? shippingAmount : 0;

  return {
    items,
    validItems,
    unavailableItems,
    subtotal,
    total: subtotal + currentShipping,
    shipping: currentShipping,
  };
}

function renderCart() {
  if (!cartItemsRoot) {
    return;
  }

  const state = getCartState();

  subtotalValue.textContent = window.LobosCart.formatMoney(state.subtotal);
  shippingValue.textContent = state.shipping > 0 ? window.LobosCart.formatMoney(state.shipping) : "Calculated at checkout";
  totalValue.textContent = window.LobosCart.formatMoney(state.total);

  if (state.items.length === 0) {
    cartItemsRoot.innerHTML = `
      <article class="empty-state">
        <h3>Your cart is empty</h3>
        <p>Add books, calendars, or amigurumi from the shop to start checkout.</p>
        <a class="btn" href="shop.html">Go to shop</a>
      </article>
    `;
    checkoutButton.disabled = true;
    clearCartNotice();
    return;
  }

  const validMarkup = state.validItems
    .map(
      (item) => `
        <article class="cart-row">
          <div class="cart-line-main">
            <a class="cart-thumb-link" href="${getProductShopHref(item.product)}" aria-label="View ${item.product.name} details">
              <img class="cart-thumb" src="${item.product.imagePath}" alt="${item.product.name}" />
            </a>
            <div class="cart-line-meta">
              <span class="card-tag cart-category-tag">${getCategoryLabel(item.product.category)}</span>
              <h3><a class="cart-product-link" href="${getProductShopHref(item.product)}">${item.product.name}</a></h3>
              <p class="muted">${item.product.description}</p>
              <p class="muted">${item.product.price} each</p>
              <div class="qty-control">
                <button class="qty-btn" type="button" data-action="decrement" data-product-id="${item.product.id}">-</button>
                <span class="qty-value">${item.quantity}</span>
                <button class="qty-btn" type="button" data-action="increment" data-product-id="${item.product.id}">+</button>
                <button class="link-btn" type="button" data-action="remove" data-product-id="${item.product.id}">Remove</button>
              </div>
            </div>
          </div>
          <p class="price">${window.LobosCart.formatMoney(item.lineTotal)}</p>
        </article>
      `,
    )
    .join("");

  const unavailableMarkup = state.unavailableItems
    .map(
      (item) => `
        <article class="cart-row">
          <div class="cart-line-main">
            ${item.product ? `<a class="cart-thumb-link" href="${getProductShopHref(item.product)}" aria-label="View ${item.product.name} details"><img class="cart-thumb" src="${item.product.imagePath}" alt="${item.product.name}" /></a>` : ""}
            <div class="cart-line-meta">
              ${item.product ? `<span class="card-tag cart-category-tag">${getCategoryLabel(item.product.category)}</span>` : ""}
              <h3>${item.product ? `<a class="cart-product-link" href="${getProductShopHref(item.product)}">${item.product.name}</a>` : `Product #${item.productId}`}</h3>
              <p class="muted">${item.reason}</p>
              <button class="link-btn" type="button" data-action="remove" data-product-id="${item.productId}">Remove from cart</button>
            </div>
          </div>
          <span class="status-pill out-of-stock">Unavailable</span>
        </article>
      `,
    )
    .join("");

  cartItemsRoot.innerHTML = `${validMarkup}${unavailableMarkup}`;
  checkoutButton.disabled = state.validItems.length === 0 || state.unavailableItems.length > 0;

  if (state.unavailableItems.length > 0) {
    showCartNotice("Some items need attention before checkout. Update the cart and try again.");
  } else {
    clearCartNotice();
  }
}

async function loadCartProducts() {
  if (!cartItemsRoot) {
    return;
  }

  try {
    const [, data] = await Promise.all([window.LobosCart.ready, window.LobosStore.fetchCatalog()]);

    cartProducts = data.products || [];
    shippingAmount = Number(data.shipping?.amount || 0);
    catalogSource = data.source || "api";
    renderCart();

    if (catalogSource === "fallback") {
      checkoutButton.disabled = true;
      showCartNotice(
        "Your products are showing from a static catalog. Checkout is disabled until the backend API, database, and Stripe server are deployed.",
      );
    }
  } catch (error) {
    cartItemsRoot.innerHTML = `
      <article class="empty-state">
        <h3>Cart unavailable</h3>
        <p>${error.message}</p>
      </article>
    `;
    showCartNotice("Could not load cart data from either the API or the fallback catalog.");
    checkoutButton.disabled = true;
  }
}

if (cartItemsRoot) {
  loadCartProducts();

  cartItemsRoot.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");

    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const productId = Number.parseInt(actionButton.dataset.productId, 10);
    const existingItem = window.LobosCart.getItems().find((item) => item.productId === productId);
    const product = cartProducts.find((item) => item.id === productId);

    try {
      if (action === "remove") {
        await window.LobosCart.removeItem(productId);
        return;
      }

      if (!existingItem) {
        return;
      }

      if (action === "decrement") {
        await window.LobosCart.updateItem(productId, existingItem.quantity - 1);
        return;
      }

      if (action === "increment") {
        if (product && existingItem.quantity >= product.stockQuantity) {
          showCartNotice(`${product.name} is already at the maximum available quantity.`);
          return;
        }

        await window.LobosCart.updateItem(productId, existingItem.quantity + 1);
      }
    } catch (error) {
      showCartNotice(error.message || "Could not update your cart.");
    }
  });

  checkoutButton.addEventListener("click", async () => {
    await handleCheckoutClick();
  });

  window.addEventListener("lobos:cart-updated", renderCart);
}

if (checkoutGate) {
  checkoutGate.addEventListener("click", (event) => {
    if (event.target.closest("[data-gate-close]")) {
      closeCheckoutGate();
    }
  });

  showLoginButton?.addEventListener("click", () => {
    clearCheckoutAuthNotice();
    showCheckoutGateView("login");
  });

  showRegisterButton?.addEventListener("click", () => {
    clearCheckoutRegisterNotice();
    showCheckoutGateView("register");
  });

  backToCheckoutChoiceButton?.addEventListener("click", () => {
    clearCheckoutAuthNotice();
    showCheckoutGateView("choice");
  });

  backToCheckoutChoiceFromRegisterButton?.addEventListener("click", () => {
    clearCheckoutRegisterNotice();
    showCheckoutGateView("choice");
  });

  guestCheckoutButton?.addEventListener("click", async () => {
    closeCheckoutGate();
    await startCheckout(getCheckoutState());
  });

  checkoutLoginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearCheckoutAuthNotice();

    const formData = new FormData(checkoutLoginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    if (!username || !password) {
      showCheckoutAuthNotice("Enter both your username and password.");
      return;
    }

    try {
      setLoginCheckoutLoading(true);
      await loginAndContinueCheckout(username, password);
    } catch (error) {
      showCheckoutAuthNotice(error.message || "Could not log in.");
    } finally {
      setLoginCheckoutLoading(false);
    }
  });

  checkoutRegisterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearCheckoutRegisterNotice();

    const formData = new FormData(checkoutRegisterForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const group = String(formData.get("group") || "").trim();

    if (!username || !password) {
      showCheckoutRegisterNotice("Choose a username and password to create your account.");
      return;
    }

    try {
      setRegisterCheckoutLoading(true);
      await createAccountAndContinueCheckout(username, password, group);
    } catch (error) {
      showCheckoutRegisterNotice(error.message || "Could not create your account.");
    } finally {
      setRegisterCheckoutLoading(false);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !checkoutGate.hidden) {
      closeCheckoutGate();
    }
  });
}
