const CART_STORAGE_KEY = "lobos-cart";
const FALLBACK_PRODUCTS_PATH = "products.json";

function sanitizeCart(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      productId: Number.parseInt(String(item.productId), 10),
      quantity: Number.parseInt(String(item.quantity), 10),
    }))
    .filter(
      (item) => Number.isInteger(item.productId) && item.productId > 0 && Number.isInteger(item.quantity) && item.quantity > 0,
    );
}

function readCart() {
  try {
    return sanitizeCart(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]"));
  } catch (error) {
    return [];
  }
}

function emitCartUpdate(items) {
  window.dispatchEvent(
    new CustomEvent("lobos:cart-updated", {
      detail: {
        items,
        count: items.reduce((sum, item) => sum + item.quantity, 0),
      },
    }),
  );
}

function writeCart(items) {
  const sanitizedItems = sanitizeCart(items);
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(sanitizedItems));
  emitCartUpdate(sanitizedItems);
  return sanitizedItems;
}

function syncCartCount() {
  const cartItems = readCart();
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  document.querySelectorAll("[data-cart-count]").forEach((element) => {
    element.textContent = String(cartCount);
    element.hidden = cartCount === 0;
  });
}

window.LobosCart = {
  getItems() {
    return readCart();
  },

  setItems(items) {
    return writeCart(items);
  },

  addItem(productId, quantity = 1) {
    const nextCart = readCart();
    const numericProductId = Number.parseInt(String(productId), 10);
    const numericQuantity = Number.parseInt(String(quantity), 10);
    const existingItem = nextCart.find((item) => item.productId === numericProductId);

    if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
      return nextCart;
    }

    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      return nextCart;
    }

    if (existingItem) {
      existingItem.quantity += numericQuantity;
    } else {
      nextCart.push({ productId: numericProductId, quantity: numericQuantity });
    }

    return writeCart(nextCart);
  },

  updateItem(productId, quantity) {
    const numericProductId = Number.parseInt(String(productId), 10);
    const numericQuantity = Number.parseInt(String(quantity), 10);
    const nextCart = readCart();
    const itemIndex = nextCart.findIndex((item) => item.productId === numericProductId);

    if (itemIndex === -1) {
      return nextCart;
    }

    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      nextCart.splice(itemIndex, 1);
      return writeCart(nextCart);
    }

    nextCart[itemIndex].quantity = numericQuantity;
    return writeCart(nextCart);
  },

  removeItem(productId) {
    return writeCart(
      readCart().filter((item) => item.productId !== Number.parseInt(String(productId), 10)),
    );
  },

  clear() {
    localStorage.removeItem(CART_STORAGE_KEY);
    emitCartUpdate([]);
  },

  getCount() {
    return readCart().reduce((sum, item) => sum + item.quantity, 0);
  },

  formatMoney(amount, currency = "SEK") {
    return new Intl.NumberFormat("sv-SE", {
      style: "currency",
      currency,
    }).format(Number(amount || 0) / 100);
  },

  syncCount: syncCartCount,
};

window.LobosStore = {
  async fetchCatalog() {
    try {
      const apiResponse = await fetch("/api/products");

      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        return {
          ...apiData,
          source: "api",
        };
      }
    } catch (error) {
    }

    const fallbackResponse = await fetch(FALLBACK_PRODUCTS_PATH);
    const fallbackData = await fallbackResponse.json();

    return {
      ...fallbackData,
      source: "fallback",
    };
  },
};

const menuToggle = document.getElementById("menuToggle");
const siteNav = document.getElementById("siteNav");

if (menuToggle && siteNav) {
  menuToggle.addEventListener("click", () => {
    siteNav.classList.toggle("open");
  });
}

const filterButtons = document.querySelectorAll(".filter-btn");

if (filterButtons.length > 0) {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.filter;
      const productCards = document.querySelectorAll(".product-card");

      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      productCards.forEach((card) => {
        card.style.display =
          category === "all" || card.dataset.category === category ? "block" : "none";
      });
    });
  });
}

const contactForm = document.getElementById("contactForm");
const contactNotice = document.getElementById("contactNotice");

if (contactForm && contactNotice) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    contactNotice.textContent =
      "Thanks! Your message is saved on this page version. We can connect this to email next.";
    contactForm.reset();
  });
}

window.addEventListener("storage", syncCartCount);
window.addEventListener("lobos:cart-updated", syncCartCount);
syncCartCount();
