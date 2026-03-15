const CART_STORAGE_KEY = "lobos-cart";
const FALLBACK_PRODUCTS_PATH = "products.json";

let cartItemsCache = [];
let cartScope = {
  type: "guest",
  userId: null,
  username: null,
};
let cartLoadPromise = null;
let authStateCache = null;
let authStatePromise = null;

function sanitizeCart(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const mergedItems = new Map();

  items.forEach((item) => {
    const productId = Number.parseInt(String(item.productId), 10);
    const quantity = Number.parseInt(String(item.quantity), 10);

    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return;
    }

    mergedItems.set(productId, (mergedItems.get(productId) || 0) + quantity);
  });

  return [...mergedItems.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function readGuestCart() {
  try {
    return sanitizeCart(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]"));
  } catch (error) {
    return [];
  }
}

function writeGuestCart(items) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(sanitizeCart(items)));
}

function clearGuestCart() {
  localStorage.removeItem(CART_STORAGE_KEY);
}

function emitCartUpdate(items) {
  window.dispatchEvent(
    new CustomEvent("lobos:cart-updated", {
      detail: {
        items,
        count: items.reduce((sum, item) => sum + item.quantity, 0),
        scope: { ...cartScope },
      },
    }),
  );
}

function syncCartCount() {
  const cartCount = cartItemsCache.reduce((sum, item) => sum + item.quantity, 0);

  document.querySelectorAll("[data-cart-count]").forEach((element) => {
    element.textContent = String(cartCount);
    element.hidden = cartCount === 0;
  });
}

function mergeCartItems(...carts) {
  return sanitizeCart(carts.flat());
}

function updateAccountLinks(user) {
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = user ? "Account" : "Login";
    link.href = "account.html";

    if (user?.username) {
      link.title = `Signed in as ${user.username}`;
    } else {
      link.removeAttribute("title");
    }
  });
}

function emitAuthUpdate(user) {
  window.dispatchEvent(
    new CustomEvent("lobos:auth-changed", {
      detail: {
        authenticated: Boolean(user?.userId),
        user: user ? { ...user } : null,
      },
    }),
  );
}

async function fetchAuthState() {
  const response = await fetch("/api/auth/check", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not check your login status");
  }

  const data = await response.json();

  if (!data.authenticated) {
    return null;
  }

  return {
    userId: Number(data.userId),
    username: data.username || null,
  };
}

async function refreshAuthState() {
  if (!authStatePromise) {
    authStatePromise = fetchAuthState()
      .then((user) => {
        authStateCache = user ? { ...user } : null;
        updateAccountLinks(authStateCache);
        emitAuthUpdate(authStateCache);
        return authStateCache;
      })
      .catch(() => {
        authStateCache = null;
        updateAccountLinks(null);
        emitAuthUpdate(null);
        return null;
      })
      .finally(() => {
        authStatePromise = null;
      });
  }

  return authStatePromise;
}

window.LobosAuth = {
  ready: refreshAuthState(),

  async refresh() {
    return refreshAuthState();
  },

  getUser() {
    return authStateCache ? { ...authStateCache } : null;
  },

  isAuthenticated() {
    return Boolean(authStateCache?.userId);
  },

  async login(username, password) {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not log in");
    }

    await refreshAuthState();
    await window.LobosCart?.refresh?.();
    return data.user;
  },

  async register({ username, password, group }) {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
        group: group || username,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not create your account");
    }

    return data.user;
  },

  async registerAndLogin({ username, password, group }) {
    await window.LobosAuth.register({ username, password, group });
    return window.LobosAuth.login(username, password);
  },

  async logout() {
    const response = await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not log out");
    }

    authStateCache = null;
    updateAccountLinks(null);
    emitAuthUpdate(null);
    await window.LobosCart?.refresh?.();
    return data;
  },
};

async function fetchRemoteCart() {
  const response = await fetch("/api/cart", {
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not load your cart");
  }

  const data = await response.json();
  return sanitizeCart(data.items || []);
}

async function saveRemoteCart(items) {
  const response = await fetch("/api/cart", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: sanitizeCart(items) }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Could not save your cart");
  }

  return sanitizeCart(data.items || []);
}

async function loadCartState() {
  try {
    const authenticatedUser = window.LobosAuth ? await window.LobosAuth.refresh() : await fetchAuthState();

    if (!authenticatedUser) {
      cartScope = {
        type: "guest",
        userId: null,
        username: null,
      };
      cartItemsCache = readGuestCart();
      emitCartUpdate(cartItemsCache);
      return cartItemsCache;
    }

    cartScope = {
      type: "user",
      userId: authenticatedUser.userId,
      username: authenticatedUser.username,
    };

    const [remoteCart, guestCart] = await Promise.all([
      fetchRemoteCart(),
      Promise.resolve(readGuestCart()),
    ]);

    if (guestCart.length > 0) {
      cartItemsCache = await saveRemoteCart(mergeCartItems(remoteCart, guestCart));
      clearGuestCart();
    } else {
      cartItemsCache = remoteCart;
    }

    emitCartUpdate(cartItemsCache);
    return cartItemsCache;
  } catch (error) {
    cartScope = {
      type: "guest",
      userId: null,
      username: null,
    };
    cartItemsCache = readGuestCart();
    emitCartUpdate(cartItemsCache);
    return cartItemsCache;
  }
}

async function refreshCartState() {
  if (!cartLoadPromise) {
    cartLoadPromise = loadCartState().finally(() => {
      cartLoadPromise = null;
    });
  }

  return cartLoadPromise;
}

async function persistCart(items) {
  const sanitizedItems = sanitizeCart(items);
  const previousItems = [...cartItemsCache];

  cartItemsCache = sanitizedItems;
  emitCartUpdate(cartItemsCache);

  try {
    if (cartScope.type === "user" && cartScope.userId) {
      cartItemsCache = await saveRemoteCart(sanitizedItems);
    } else {
      if (sanitizedItems.length === 0) {
        clearGuestCart();
      } else {
        writeGuestCart(sanitizedItems);
      }
    }

    emitCartUpdate(cartItemsCache);
    return cartItemsCache;
  } catch (error) {
    cartItemsCache = previousItems;
    emitCartUpdate(cartItemsCache);
    throw error;
  }
}

async function ensureCartReady() {
  if (cartLoadPromise) {
    await cartLoadPromise;
    return;
  }

  if (cartScope.type === "guest" && cartItemsCache.length === 0 && localStorage.getItem(CART_STORAGE_KEY) !== null) {
    cartItemsCache = readGuestCart();
    emitCartUpdate(cartItemsCache);
    return;
  }

  if (cartScope.userId || cartItemsCache.length > 0) {
    return;
  }

  await refreshCartState();
}

window.LobosCart = {
  ready: refreshCartState(),

  async refresh() {
    return refreshCartState();
  },

  getItems() {
    return [...cartItemsCache];
  },

  getScope() {
    return { ...cartScope };
  },

  async setItems(items) {
    await ensureCartReady();
    return persistCart(items);
  },

  async addItem(productId, quantity = 1) {
    await ensureCartReady();

    const nextCart = [...cartItemsCache];
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

    return persistCart(nextCart);
  },

  async updateItem(productId, quantity) {
    await ensureCartReady();

    const numericProductId = Number.parseInt(String(productId), 10);
    const numericQuantity = Number.parseInt(String(quantity), 10);
    const nextCart = [...cartItemsCache];
    const itemIndex = nextCart.findIndex((item) => item.productId === numericProductId);

    if (itemIndex === -1) {
      return nextCart;
    }

    if (!Number.isInteger(numericQuantity) || numericQuantity <= 0) {
      nextCart.splice(itemIndex, 1);
      return persistCart(nextCart);
    }

    nextCart[itemIndex] = {
      ...nextCart[itemIndex],
      quantity: numericQuantity,
    };

    return persistCart(nextCart);
  },

  async removeItem(productId) {
    await ensureCartReady();
    return persistCart(
      cartItemsCache.filter((item) => item.productId !== Number.parseInt(String(productId), 10)),
    );
  },

  async clear() {
    await ensureCartReady();
    return persistCart([]);
  },

  getCount() {
    return cartItemsCache.reduce((sum, item) => sum + item.quantity, 0);
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

  async fetchProduct(slug) {
    if (!slug) {
      throw new Error("Missing product slug.");
    }

    try {
      const apiResponse = await fetch(`/api/products/${encodeURIComponent(slug)}`);

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
    const product = (fallbackData.products || []).find((item) => item.slug === slug);

    if (!product) {
      throw new Error("Product not found.");
    }

    return {
      product,
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

function getInitialShopCategory() {
  const params = new URLSearchParams(window.location.search);
  return params.get("category") || "all";
}

function getValidShopCategory(category) {
  return Array.from(filterButtons).some((button) => button.dataset.filter === category)
    ? category
    : "all";
}

function updateShopCategoryUrl(category) {
  const url = new URL(window.location.href);

  if (category === "all") {
    url.searchParams.delete("category");
  } else {
    url.searchParams.set("category", category);
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function applyShopFilter(category = "all", options = {}) {
  const nextCategory = getValidShopCategory(category);
  const productCards = document.querySelectorAll(".product-card");

  filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === nextCategory);
  });

  productCards.forEach((card) => {
    card.style.display = nextCategory === "all" || card.dataset.category === nextCategory ? "block" : "none";
  });

  if (options.updateUrl !== false) {
    updateShopCategoryUrl(nextCategory);
  }

  return nextCategory;
}

window.LobosShopFilters = {
  apply: applyShopFilter,
  getInitialCategory: getInitialShopCategory,
};

if (filterButtons.length > 0) {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyShopFilter(button.dataset.filter);
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

window.addEventListener("storage", (event) => {
  if (event.key !== CART_STORAGE_KEY || cartScope.type !== "guest") {
    return;
  }

  cartItemsCache = readGuestCart();
  emitCartUpdate(cartItemsCache);
});
window.addEventListener("lobos:cart-updated", syncCartCount);
window.addEventListener("focus", () => {
  window.LobosAuth.refresh().catch(() => {});
  window.LobosCart.refresh().catch(() => {});
});
updateAccountLinks(null);
syncCartCount();
