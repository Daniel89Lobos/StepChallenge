const productGrid = document.getElementById("productGrid");
const shopNotice = document.getElementById("shopNotice");

function showShopNotice(message, type = "error") {
  if (!shopNotice) {
    return;
  }

  shopNotice.hidden = false;
  shopNotice.className = `page-status${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  shopNotice.textContent = message;
}

function getStockLabel(product) {
  if (product.stockStatus === "out_of_stock") {
    return {
      className: "status-pill out-of-stock",
      text: "Out of stock",
      note: "This product cannot be added until stock is updated.",
    };
  }

  if (product.stockStatus === "low_stock") {
    return {
      className: "status-pill low-stock",
      text: `Only ${product.stockQuantity} left`,
      note: "Low stock. Stripe will verify availability again at checkout.",
    };
  }

  return {
    className: "status-pill in-stock",
    text: "In stock",
    note: `Ready to ship from Sweden. ${product.stockQuantity} available right now.`,
  };
}

function renderProducts(products) {
  if (!productGrid) {
    return;
  }

  if (!Array.isArray(products) || products.length === 0) {
    productGrid.innerHTML = `
      <article class="card empty-state">
        <h3>No products available</h3>
        <p>Add products to the database seed and reload the shop.</p>
      </article>
    `;
    return;
  }

  productGrid.innerHTML = products
    .map((product) => {
      const stock = getStockLabel(product);

      return `
        <article class="card product-card card-stack" data-category="${product.category}">
          <img class="product-image" src="${product.imagePath}" alt="${product.name}" />
          <div class="card-tag">${product.category === "books" ? "Book" : "Calendar"}</div>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <p class="price">${product.price}</p>
          <div class="card-footer">
            <span class="${stock.className}">${stock.text}</span>
            <button class="btn" type="button" data-add-to-cart="${product.id}" ${product.stockStatus === "out_of_stock" ? "disabled" : ""}>
              ${product.stockStatus === "out_of_stock" ? "Unavailable" : "Add to cart"}
            </button>
          </div>
          <p class="inventory-copy">${stock.note}</p>
        </article>
      `;
    })
    .join("");
}

async function loadProducts() {
  if (!productGrid) {
    return;
  }

  try {
    const data = await window.LobosStore.fetchCatalog();

    renderProducts(data.products || []);

    if (data.source === "fallback") {
      showShopNotice(
        "Products are loading from a static catalog because the live backend API is not deployed yet. Browsing works, but checkout still needs the server setup.",
      );
    }
  } catch (error) {
    productGrid.innerHTML = `
      <article class="card empty-state">
        <h3>Product feed unavailable</h3>
        <p>${error.message}</p>
      </article>
    `;
    showShopNotice("Could not load products from either the API or the fallback catalog.");
  }
}

if (productGrid) {
  loadProducts();

  productGrid.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-to-cart]");

    if (!addButton) {
      return;
    }

    const productId = Number.parseInt(addButton.dataset.addToCart, 10);
    window.LobosCart.addItem(productId, 1);
    showShopNotice("Added to cart. You can keep browsing or review your cart now.", "success");
  });
}
