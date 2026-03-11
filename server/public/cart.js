const cartItemsRoot = document.getElementById("cartItems");
const cartNotice = document.getElementById("cartNotice");
const subtotalValue = document.getElementById("subtotalValue");
const shippingValue = document.getElementById("shippingValue");
const totalValue = document.getElementById("totalValue");
const checkoutButton = document.getElementById("checkoutButton");

let cartProducts = [];
let shippingAmount = 0;
let catalogSource = "api";

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
        <p>Add books or calendars from the shop to start checkout.</p>
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
          <div class="cart-line-meta">
            <h3>${item.product.name}</h3>
            <p class="muted">${item.product.description}</p>
            <p class="muted">${item.product.price} each</p>
            <div class="qty-control">
              <button class="qty-btn" type="button" data-action="decrement" data-product-id="${item.product.id}">-</button>
              <span class="qty-value">${item.quantity}</span>
              <button class="qty-btn" type="button" data-action="increment" data-product-id="${item.product.id}">+</button>
              <button class="link-btn" type="button" data-action="remove" data-product-id="${item.product.id}">Remove</button>
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
          <div class="cart-line-meta">
            <h3>${item.product ? item.product.name : `Product #${item.productId}`}</h3>
            <p class="muted">${item.reason}</p>
            <button class="link-btn" type="button" data-action="remove" data-product-id="${item.productId}">Remove from cart</button>
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
    const data = await window.LobosStore.fetchCatalog();

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

  cartItemsRoot.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");

    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const productId = Number.parseInt(actionButton.dataset.productId, 10);
    const existingItem = window.LobosCart.getItems().find((item) => item.productId === productId);
    const product = cartProducts.find((item) => item.id === productId);

    if (action === "remove") {
      window.LobosCart.removeItem(productId);
      renderCart();
      return;
    }

    if (!existingItem) {
      return;
    }

    if (action === "decrement") {
      window.LobosCart.updateItem(productId, existingItem.quantity - 1);
      renderCart();
      return;
    }

    if (action === "increment") {
      if (product && existingItem.quantity >= product.stockQuantity) {
        showCartNotice(`${product.name} is already at the maximum available quantity.`);
        return;
      }

      window.LobosCart.updateItem(productId, existingItem.quantity + 1);
      renderCart();
    }
  });

  checkoutButton.addEventListener("click", async () => {
    if (catalogSource === "fallback") {
      showCartNotice(
        "Checkout cannot start yet because the live backend is missing. The website is currently running in catalog-only mode.",
      );
      return;
    }

    const state = getCartState();

    if (state.validItems.length === 0 || state.unavailableItems.length > 0) {
      showCartNotice("Please fix the cart before continuing to payment.");
      return;
    }

    try {
      checkoutButton.disabled = true;
      checkoutButton.textContent = "Redirecting...";

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
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Continue to Stripe Checkout";
    }
  });

  window.addEventListener("lobos:cart-updated", renderCart);
}
