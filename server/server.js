const fs = require("fs");
const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const FRONTEND_URL = (process.env.FRONTEND_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SHOP_CURRENCY = "sek";
const SHOP_COUNTRY = "SE";
const SHIPPING_LABEL = "Sweden standard shipping";
const STANDARD_SHIPPING_AMOUNT = 4900;
const CART_METADATA_KEY = "cart_items";
const SHIPPING_METADATA_KEY = "shipping_amount";
const ORDER_USER_METADATA_KEY = "user_id";
const LOW_STOCK_THRESHOLD = 5;
const FEATURED_PRODUCT_SLOT_COUNT = 5;
const FEATURED_LABEL_MAX_LENGTH = 30;
const PRODUCT_CATEGORIES = ["books", "calendars", "amigurumi"];
const PRODUCT_CATEGORY_SET = new Set(PRODUCT_CATEGORIES);
const PRODUCT_UPLOAD_DIR = path.join(PUBLIC_DIR, "assets", "uploads");
const PRODUCT_UPLOAD_WEB_PATH = "assets/uploads";
const PRODUCT_IMAGE_UPLOAD_LIMIT = 5 * 1024 * 1024;
const ORDER_FULFILLMENT_STATUSES = [
  "paid",
  "packed",
  "fulfilled",
  "delivered",
  "inventory_issue",
  "cancelled",
];
const NON_PENDING_ORDER_STATUSES = ["fulfilled", "delivered", "cancelled"];
const DEFAULT_PAYMENT_METHOD_TYPES = ["card", "klarna", "swish"];

const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

const paymentMethodTypes = (process.env.STRIPE_PAYMENT_METHOD_TYPES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const enabledPaymentMethodTypes =
  paymentMethodTypes.length > 0 ? paymentMethodTypes : DEFAULT_PAYMENT_METHOD_TYPES;
const PostgresSessionStore = connectPgSimple(session);

fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });

function getUploadFileExtension(file) {
  const byMimeType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  return byMimeType[file.mimetype] || path.extname(file.originalname || "").toLowerCase();
}

function isManagedUploadImagePath(imagePath) {
  return typeof imagePath === "string" && imagePath.startsWith(`${PRODUCT_UPLOAD_WEB_PATH}/`);
}

async function maybeDeleteManagedUploadImage(client, imagePath, ignoredProductId = null) {
  if (!isManagedUploadImagePath(imagePath)) {
    return;
  }

  const params = [imagePath];
  let duplicateQuery = "SELECT COUNT(*)::int AS count FROM products WHERE image_path = $1";

  if (Number.isInteger(ignoredProductId) && ignoredProductId > 0) {
    params.push(ignoredProductId);
    duplicateQuery += ` AND id <> $${params.length}`;
  }

  const duplicateResult = await client.query(duplicateQuery, params);

  if (duplicateResult.rows[0].count > 0) {
    return;
  }

  const relativePath = imagePath.slice(`${PRODUCT_UPLOAD_WEB_PATH}/`.length);

  if (!relativePath) {
    return;
  }

  const absolutePath = path.join(PRODUCT_UPLOAD_DIR, relativePath);

  try {
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not remove uploaded product image:", error);
    }
  }
}

const productImageUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      callback(null, PRODUCT_UPLOAD_DIR);
    },
    filename(req, file, callback) {
      const originalBaseName = path.basename(file.originalname || "image", path.extname(file.originalname || ""));
      const safeBaseName = slugifyProductValue(originalBaseName) || "product-image";
      const extension = getUploadFileExtension(file);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      callback(null, `${safeBaseName}-${uniqueSuffix}${extension}`);
    },
  }),
  limits: {
    fileSize: PRODUCT_IMAGE_UPLOAD_LIMIT,
  },
  fileFilter(req, file, callback) {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      const error = new Error("Only JPG, PNG, WebP, and GIF images are supported");
      error.statusCode = 400;
      callback(error);
      return;
    }

    callback(null, true);
  },
});

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

const sessionStore = new PostgresSessionStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true,
});

const emailTransport = process.env.SMTP_HOST && process.env.SMTP_FROM
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
      secure: String(process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
          : undefined,
    })
  : null;

async function ensureShopSupportTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS featured_products (
       id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       slot_index INTEGER NOT NULL UNIQUE CHECK (slot_index >= 1 AND slot_index <= ${FEATURED_PRODUCT_SLOT_COUNT}),
       product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
       highlight_label TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_featured_products_product_id ON featured_products (product_id)",
  );
}

// Stripe webhook must receive the raw body before JSON parsing.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({
        error: "Stripe webhook is not configured",
      });
    }

    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing Stripe signature" });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      console.error("Stripe webhook signature verification failed:", error.message);
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    if (event.type !== "checkout.session.completed") {
      return res.json({ received: true });
    }

    const checkoutSession = event.data.object;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const processedEvent = await client.query(
        "SELECT stripe_event_id FROM stripe_events WHERE stripe_event_id = $1",
        [event.id],
      );

      if (processedEvent.rows.length > 0) {
        await client.query("COMMIT");
        return res.json({ received: true, duplicate: true });
      }

      const existingOrder = await client.query(
        "SELECT id FROM orders WHERE stripe_checkout_session_id = $1",
        [checkoutSession.id],
      );

      if (existingOrder.rows.length > 0) {
        await client.query(
          "INSERT INTO stripe_events (stripe_event_id, event_type) VALUES ($1, $2)",
          [event.id, event.type],
        );
        await client.query("COMMIT");
        return res.json({ received: true, duplicate: true });
      }

      const rawCartItems = checkoutSession.metadata?.[CART_METADATA_KEY];
      const cartItems = parseCartMetadata(rawCartItems);

      if (cartItems.length === 0) {
        throw new Error("Checkout session metadata is missing cart items");
      }

      const productIds = [...new Set(cartItems.map((item) => item.productId))];
      const productsResult = await client.query(
        "SELECT * FROM products WHERE id = ANY($1::int[]) FOR UPDATE",
        [productIds],
      );

      const productMap = new Map(
        productsResult.rows.map((product) => [Number(product.id), product]),
      );

      const orderItems = cartItems.map((item) => {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new Error(`Product ${item.productId} not found while finalizing order`);
        }

        return {
          product,
          quantity: item.quantity,
          lineTotal: Number(product.unit_amount) * item.quantity,
        };
      });

      const subtotalAmount = orderItems.reduce(
        (sum, item) => sum + item.lineTotal,
        0,
      );
      const shippingAmount = parseMinorAmount(
        checkoutSession.metadata?.[SHIPPING_METADATA_KEY],
      );
      const taxAmount = Number(checkoutSession.total_details?.amount_tax || 0);
      const totalAmount = Number(
        checkoutSession.amount_total || subtotalAmount + shippingAmount + taxAmount,
      );

      const inventoryIssue = orderItems.some(
        (item) => Number(item.product.stock_quantity) < item.quantity,
      );

      const shippingDetails = checkoutSession.shipping_details || {};
      const customerDetails = checkoutSession.customer_details || {};
      const metadataUserId = Number.parseInt(
        String(checkoutSession.metadata?.[ORDER_USER_METADATA_KEY] || ""),
        10,
      );
      let orderUserId = null;

      if (Number.isInteger(metadataUserId) && metadataUserId > 0) {
        const userResult = await client.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [
          metadataUserId,
        ]);
        orderUserId = userResult.rows[0]?.id || null;
      }

      const shippingAddress = JSON.stringify({
        name: shippingDetails.name || customerDetails.name || null,
        phone: customerDetails.phone || null,
        address: shippingDetails.address || customerDetails.address || null,
      });

      const orderResult = await client.query(
        `INSERT INTO orders (
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          user_id,
          payment_status,
          fulfillment_status,
          customer_email,
          customer_name,
          phone,
          tracking_number,
          admin_note,
          customer_note,
          shipping_address_json,
          subtotal_amount,
          shipping_amount,
          tax_amount,
          total_amount,
          currency
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17
        ) RETURNING *`,
        [
          checkoutSession.id,
          checkoutSession.payment_intent || null,
          orderUserId,
          checkoutSession.payment_status || "paid",
          inventoryIssue ? "inventory_issue" : "paid",
          customerDetails.email || checkoutSession.customer_email || null,
          shippingDetails.name || customerDetails.name || null,
          customerDetails.phone || null,
          null,
          null,
          null,
          shippingAddress,
          subtotalAmount,
          shippingAmount,
          taxAmount,
          totalAmount,
          SHOP_CURRENCY,
        ],
      );

      for (const item of orderItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id,
            product_id,
            product_name,
            unit_amount,
            quantity,
            line_total
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            orderResult.rows[0].id,
            item.product.id,
            item.product.name,
            item.product.unit_amount,
            item.quantity,
            item.lineTotal,
          ],
        );
      }

      if (!inventoryIssue) {
        for (const item of orderItems) {
          await client.query(
            `UPDATE products
             SET stock_quantity = stock_quantity - $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [item.quantity, item.product.id],
          );
        }
      }

      await client.query(
        "INSERT INTO stripe_events (stripe_event_id, event_type) VALUES ($1, $2)",
        [event.id, event.type],
      );

      await client.query("COMMIT");
      await sendOrderConfirmationEmail(
        buildOrderResponse(
          orderResult.rows[0],
          orderItems.map((item) => ({
            product_name: item.product.name,
            unit_amount: item.product.unit_amount,
            quantity: item.quantity,
            line_total: item.lineTotal,
          })),
        ),
      );
      res.json({ received: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Stripe webhook handling failed:", error);
      res.status(500).json({ error: "Could not finalize checkout session" });
    } finally {
      client.release();
    }
  },
);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:3000",
      "https://lobos.se",
      "https://www.lobos.se",
      FRONTEND_URL,
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (path.extname(filePath).toLowerCase() === ".html") {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }),
);

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error connecting to database:", err);
  } else {
    console.log("Connected to PostgreSQL database");
    release();
  }
});

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  next();
};

async function loadSessionUser(userId, client = pool) {
  const result = await client.query(
    "SELECT id, username, group_name, is_admin FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );

  return result.rows[0] || null;
}

app.post("/api/contact", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const message = String(req.body.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (name.length > 120) {
      return res.status(400).json({ error: "Name must be 120 characters or fewer" });
    }

    if (message.length > 4000) {
      return res.status(400).json({ error: "Message must be 4000 characters or fewer" });
    }

    const emailSent = await sendContactFormEmail({ name, email, message });

    if (!emailSent) {
      return res.status(503).json({ error: "Contact email is not configured right now" });
    }

    res.json({ message: "Your message was sent." });
  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ error: "Could not send your message" });
  }
});

async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const user = await loadSessionUser(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (!user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.currentUser = user;
    req.session.username = user.username;
    req.session.isAdmin = true;
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(500).json({ error: "Could not verify admin access" });
  }
}

function parseMinorAmount(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatCurrency(amount, currency = SHOP_CURRENCY) {
  try {
    return new Intl.NumberFormat("sv-SE", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch (error) {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCustomerOrderStatusInfo(status) {
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

function formatOrderStatusForAdmin(status) {
  return getCustomerOrderStatusInfo(status).label;
}

function formatPaymentStatusLabel(status) {
  if (status === "paid") {
    return "Payment received";
  }

  return String(status || "-").replace(/_/g, " ");
}

function formatShippingAddressLines(shippingAddress) {
  const shipping = shippingAddress?.address ? shippingAddress : shippingAddress?.shippingAddress || shippingAddress;
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

async function sendEmailMessage({ to, subject, text, html, replyTo }) {
  if (!emailTransport || !to) {
    return false;
  }

  try {
    await emailTransport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      html,
      replyTo,
    });
    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

async function sendContactFormEmail({ name, email, message }) {
  const contactRecipient = process.env.CONTACT_TO_EMAIL || process.env.SMTP_USER;

  if (!contactRecipient) {
    return false;
  }

  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim();
  const safeMessage = String(message || "").trim();

  return sendEmailMessage({
    to: contactRecipient,
    subject: `Lobos Shop contact form from ${safeName}`,
    replyTo: safeEmail,
    text:
      `New message from the Lobos Shop contact form.\n\n` +
      `Name: ${safeName}\n` +
      `Email: ${safeEmail}\n\n` +
      `Message:\n${safeMessage}`,
    html:
      `<p><strong>New message from the Lobos Shop contact form.</strong></p>` +
      `<p><strong>Name:</strong> ${escapeHtml(safeName)}<br />` +
      `<strong>Email:</strong> ${escapeHtml(safeEmail)}</p>` +
      `<p><strong>Message:</strong></p>` +
      `<p>${escapeHtml(safeMessage).replace(/\n/g, "<br />")}</p>`,
  });
}

async function sendOrderConfirmationEmail(order) {
  if (!order?.customerEmail) {
    return false;
  }

  const statusInfo = getCustomerOrderStatusInfo(order.fulfillmentStatus);
  const shippingLines = formatShippingAddressLines(order.shippingAddress);
  const itemsText = order.items
    .map((item) => `- ${item.productName} x ${item.quantity}: ${formatCurrency(item.lineTotal, order.currency)}`)
    .join("\n");
  const messageText = order.customerNote ? `\nMessage from Lobos Shop: ${order.customerNote}\n` : "";
  const trackingText = order.trackingNumber ? `\nTracking number: ${order.trackingNumber}\n` : "";
  const addressText = shippingLines.length > 0 ? `\nShipping to:\n${shippingLines.join("\n")}\n` : "";

  return sendEmailMessage({
    to: order.customerEmail,
    subject: `Lobos Shop order confirmation #${order.id}`,
    text:
      `Hi${order.customerName ? ` ${order.customerName}` : ""},\n\n` +
      `Thanks for your order at Lobos Shop.\n` +
      `Status: ${statusInfo.label}\n` +
      `Payment: ${formatPaymentStatusLabel(order.paymentStatus)}\n\n` +
      `Items:\n${itemsText}\n\n` +
      `Total: ${formatCurrency(order.totalAmount, order.currency)}\n` +
      `${trackingText}${messageText}${addressText}\n` +
      `You can review your order anytime in your account.`,
    html:
      `<p>Hi${order.customerName ? ` ${escapeHtml(order.customerName)}` : ""},</p>` +
      `<p>Thanks for your order at Lobos Shop.</p>` +
      `<p><strong>Status:</strong> ${escapeHtml(statusInfo.label)}<br /><strong>Payment:</strong> ${escapeHtml(formatPaymentStatusLabel(order.paymentStatus))}</p>` +
      `<ul>${order.items
        .map(
          (item) => `<li>${escapeHtml(item.productName)} x ${item.quantity} - ${escapeHtml(formatCurrency(item.lineTotal, order.currency))}</li>`,
        )
        .join("")}</ul>` +
      `<p><strong>Total:</strong> ${escapeHtml(formatCurrency(order.totalAmount, order.currency))}</p>` +
      `${order.trackingNumber ? `<p><strong>Tracking number:</strong> ${escapeHtml(order.trackingNumber)}</p>` : ""}` +
      `${order.customerNote ? `<p><strong>Message from Lobos Shop:</strong> ${escapeHtml(order.customerNote)}</p>` : ""}` +
      `${shippingLines.length > 0 ? `<p><strong>Shipping to:</strong><br />${shippingLines.map((line) => escapeHtml(line)).join("<br />")}</p>` : ""}` +
      `<p>You can review your order anytime in your account.</p>`,
  });
}

async function sendOrderStatusUpdateEmail(order) {
  if (!order?.customerEmail) {
    return false;
  }

  const statusInfo = getCustomerOrderStatusInfo(order.fulfillmentStatus);
  const includeTracking = order.fulfillmentStatus === "fulfilled" || order.fulfillmentStatus === "delivered";

  return sendEmailMessage({
    to: order.customerEmail,
    subject: `Lobos Shop order update #${order.id}: ${statusInfo.label}`,
    text:
      `Hi${order.customerName ? ` ${order.customerName}` : ""},\n\n` +
      `Your Lobos Shop order is now marked as ${statusInfo.label}.\n` +
      `${statusInfo.detail}\n\n` +
      `${includeTracking && order.trackingNumber ? `Tracking number: ${order.trackingNumber}\n\n` : ""}` +
      `${order.customerNote ? `Message from Lobos Shop: ${order.customerNote}\n\n` : ""}` +
      `You can log in to your account for the latest details.`,
    html:
      `<p>Hi${order.customerName ? ` ${escapeHtml(order.customerName)}` : ""},</p>` +
      `<p>Your Lobos Shop order is now marked as <strong>${escapeHtml(statusInfo.label)}</strong>.</p>` +
      `<p>${escapeHtml(statusInfo.detail)}</p>` +
      `${includeTracking && order.trackingNumber ? `<p><strong>Tracking number:</strong> ${escapeHtml(order.trackingNumber)}</p>` : ""}` +
      `${order.customerNote ? `<p><strong>Message from Lobos Shop:</strong> ${escapeHtml(order.customerNote)}</p>` : ""}` +
      `<p>You can log in to your account for the latest details.</p>`,
  });
}

function buildOrderResponse(order, items = []) {
  return {
    id: order.id,
    checkoutSessionId: order.stripe_checkout_session_id,
    userId: order.user_id ? Number(order.user_id) : null,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    customerEmail: order.customer_email,
    customerName: order.customer_name,
    phone: order.phone,
    trackingNumber: order.tracking_number,
    adminNote: order.admin_note,
    customerNote: order.customer_note,
    shippingAddress: order.shipping_address_json,
    subtotalAmount: Number(order.subtotal_amount),
    shippingAmount: Number(order.shipping_amount),
    taxAmount: Number(order.tax_amount),
    totalAmount: Number(order.total_amount),
    currency: order.currency,
    createdAt: order.created_at,
    items: items.map((item) => ({
      productName: item.product_name,
      unitAmount: Number(item.unit_amount),
      quantity: Number(item.quantity),
      lineTotal: Number(item.line_total),
    })),
  };
}

function serializeAdminProduct(product) {
  return {
    ...serializeProduct(product),
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
}

function slugifyProductValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBooleanInput(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function normalizeAdminProductPayload(payload) {
  const name = String(payload.name || "").trim();
  const rawSlug = String(payload.slug || "").trim();
  const slug = slugifyProductValue(rawSlug || name);
  const description = String(payload.description || "").trim();
  const category = String(payload.category || "").trim().toLowerCase();
  const unitAmount = Number.parseInt(String(payload.unitAmount || ""), 10);
  const stockQuantity = Number.parseInt(String(payload.stockQuantity || ""), 10);
  const imagePath = String(payload.imagePath || "").trim();
  const stripeTaxCode = String(payload.stripeTaxCode || "").trim() || null;
  const active = parseBooleanInput(payload.active);
  const currency = String(payload.currency || SHOP_CURRENCY)
    .trim()
    .toLowerCase();

  if (!name) {
    const error = new Error("Product name is required");
    error.statusCode = 400;
    throw error;
  }

  if (!slug) {
    const error = new Error("Slug is required and must use letters, numbers, or hyphens");
    error.statusCode = 400;
    throw error;
  }

  if (!description) {
    const error = new Error("Product description is required");
    error.statusCode = 400;
    throw error;
  }

  if (!PRODUCT_CATEGORY_SET.has(category)) {
    const error = new Error("Choose a valid product category");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isInteger(unitAmount) || unitAmount < 0) {
    const error = new Error("Price must be a valid amount in ore");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    const error = new Error("Stock quantity must be zero or higher");
    error.statusCode = 400;
    throw error;
  }

  if (!imagePath) {
    const error = new Error("Image path is required");
    error.statusCode = 400;
    throw error;
  }

  if (currency !== SHOP_CURRENCY) {
    const error = new Error(`Only ${SHOP_CURRENCY.toUpperCase()} products are supported right now`);
    error.statusCode = 400;
    throw error;
  }

  return {
    slug,
    name,
    description,
    category,
    unitAmount,
    currency,
    stockQuantity,
    imagePath,
    active,
    stripeTaxCode,
  };
}

function getStockStatus(stockQuantity) {
  if (stockQuantity <= 0) {
    return "out_of_stock";
  }

  if (stockQuantity <= LOW_STOCK_THRESHOLD) {
    return "low_stock";
  }

  return "in_stock";
}

function serializeProduct(product) {
  return {
    id: Number(product.id),
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    unitAmount: Number(product.unit_amount),
    currency: product.currency,
    price: formatCurrency(Number(product.unit_amount), product.currency),
    stockQuantity: Number(product.stock_quantity),
    stockStatus: getStockStatus(Number(product.stock_quantity)),
    imagePath: product.image_path,
    active: Boolean(product.active),
    stripeTaxCode: product.stripe_tax_code,
  };
}

function normalizeFeaturedProductsPayload(payload) {
  const featuredProducts = Array.isArray(payload.featuredProducts) ? payload.featuredProducts : [];

  if (featuredProducts.length > FEATURED_PRODUCT_SLOT_COUNT) {
    const error = new Error(`Choose up to ${FEATURED_PRODUCT_SLOT_COUNT} featured products`);
    error.statusCode = 400;
    throw error;
  }

  const usedSlots = new Set();
  const usedProductIds = new Set();

  return featuredProducts
    .map((entry) => {
      const slot = Number.parseInt(String(entry.slot || ""), 10);
      const productId = Number.parseInt(String(entry.productId || ""), 10);
      const highlightLabel = String(entry.highlightLabel || "").trim() || null;

      if (!Number.isInteger(slot) || slot < 1 || slot > FEATURED_PRODUCT_SLOT_COUNT) {
        const error = new Error("Choose a valid featured product slot");
        error.statusCode = 400;
        throw error;
      }

      if (!Number.isInteger(productId) || productId <= 0) {
        const error = new Error("Choose a valid product for each featured slot");
        error.statusCode = 400;
        throw error;
      }

      if (usedSlots.has(slot)) {
        const error = new Error("Each homepage slot can only be used once");
        error.statusCode = 400;
        throw error;
      }

      if (usedProductIds.has(productId)) {
        const error = new Error("The same product cannot be featured more than once");
        error.statusCode = 400;
        throw error;
      }

      if (highlightLabel && highlightLabel.length > FEATURED_LABEL_MAX_LENGTH) {
        const error = new Error(`Highlight labels must be ${FEATURED_LABEL_MAX_LENGTH} characters or fewer`);
        error.statusCode = 400;
        throw error;
      }

      usedSlots.add(slot);
      usedProductIds.add(productId);

      return {
        slot,
        productId,
        highlightLabel,
      };
    })
    .sort((left, right) => left.slot - right.slot);
}

async function loadFeaturedProductRows(options = {}) {
  const { includeInactive = false } = options;
  const activeClause = includeInactive ? "" : "AND p.active = true";
  const result = await pool.query(
    `SELECT
       fp.slot_index,
       fp.product_id,
       fp.highlight_label,
       p.*
     FROM featured_products fp
     JOIN products p ON p.id = fp.product_id
     WHERE 1 = 1
       ${activeClause}
     ORDER BY fp.slot_index ASC`,
  );

  return result.rows;
}

function parseCartMetadata(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        productId: Number.parseInt(String(item.productId), 10),
        quantity: Number.parseInt(String(item.quantity), 10),
      }))
      .filter(
        (item) => Number.isInteger(item.productId) && item.productId > 0 && Number.isInteger(item.quantity) && item.quantity > 0,
      );
  } catch (error) {
    return [];
  }
}

function normalizeCartItems(items, options = {}) {
  const { allowEmpty = false } = options;

  if (!Array.isArray(items)) {
    const error = new Error("Cart payload is invalid");
    error.statusCode = 400;
    throw error;
  }

  if (items.length === 0) {
    if (allowEmpty) {
      return [];
    }

    const error = new Error("Your cart is empty");
    error.statusCode = 400;
    throw error;
  }

  const mergedItems = new Map();

  for (const item of items) {
    const productId = Number.parseInt(String(item.productId), 10);
    const quantity = Number.parseInt(String(item.quantity), 10);

    if (!Number.isInteger(productId) || productId <= 0) {
      const error = new Error("Cart contains an invalid product");
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      const error = new Error("Cart contains an invalid quantity");
      error.statusCode = 400;
      throw error;
    }

    mergedItems.set(productId, (mergedItems.get(productId) || 0) + quantity);
  }

  return [...mergedItems.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function buildLineItems(validatedItems, shippingAmount) {
  const productLineItems = validatedItems.map(({ product, quantity }) => ({
    quantity,
    price_data: {
      currency: product.currency,
      product_data: {
        name: product.name,
        description: product.description,
      },
      unit_amount: Number(product.unit_amount),
    },
  }));

  if (shippingAmount > 0) {
    productLineItems.push({
      quantity: 1,
      price_data: {
        currency: SHOP_CURRENCY,
        product_data: {
          name: SHIPPING_LABEL,
          description: "Flat shipping rate for Sweden orders",
        },
        unit_amount: shippingAmount,
      },
    });
  }

  return productLineItems;
}

async function loadProductsByIds(productIds, client = pool) {
  return client.query(
    "SELECT * FROM products WHERE id = ANY($1::int[]) AND active = true",
    [productIds],
  );
}

async function loadUserCart(userId, client = pool) {
  const result = await client.query(
    `SELECT product_id, quantity
     FROM cart_items
     WHERE user_id = $1
     ORDER BY id ASC`,
    [userId],
  );

  return result.rows.map((row) => ({
    productId: Number(row.product_id),
    quantity: Number(row.quantity),
  }));
}

async function replaceUserCart(userId, items) {
  const normalizedItems = normalizeCartItems(items, { allowEmpty: true });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);

    if (normalizedItems.length > 0) {
      const values = [];
      const placeholders = normalizedItems
        .map((item, index) => {
          const baseIndex = index * 3;
          values.push(userId, item.productId, item.quantity);
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3})`;
        })
        .join(", ");

      await client.query(
        `INSERT INTO cart_items (user_id, product_id, quantity)
         VALUES ${placeholders}`,
        values,
      );
    }

    await client.query("COMMIT");
    return normalizedItems;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function prepareCheckoutCart(items) {
  const normalizedItems = normalizeCartItems(items);
  const productIds = normalizedItems.map((item) => item.productId);
  const productsResult = await loadProductsByIds(productIds);
  const productMap = new Map(
    productsResult.rows.map((product) => [Number(product.id), product]),
  );

  const validatedItems = normalizedItems.map((item) => {
    const product = productMap.get(item.productId);

    if (!product) {
      const error = new Error("One or more products are no longer available");
      error.statusCode = 400;
      throw error;
    }

    if (Number(product.stock_quantity) < item.quantity) {
      const error = new Error(`${product.name} does not have enough stock`);
      error.statusCode = 400;
      throw error;
    }

    return {
      product,
      quantity: item.quantity,
      lineTotal: Number(product.unit_amount) * item.quantity,
    };
  });

  const subtotalAmount = validatedItems.reduce(
    (sum, item) => sum + item.lineTotal,
    0,
  );
  const shippingAmount = subtotalAmount > 0 ? STANDARD_SHIPPING_AMOUNT : 0;

  return {
    validatedItems,
    subtotalAmount,
    shippingAmount,
    totalAmount: subtotalAmount + shippingAmount,
  };
}

function handleShopError(error, res) {
  if (error.code === "42P01") {
    return res.status(503).json({
      error: "Shop tables are missing. Run db/shop-schema.sql and db/shop-seed.sql first.",
    });
  }

  if (error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error("Shop API error:", error);
  return res.status(500).json({ error: "Internal server error" });
}

// Routes

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM products
       WHERE active = true
       ORDER BY category ASC, name ASC`,
    );

    res.json({
      products: result.rows.map(serializeProduct),
      shipping: {
        amount: STANDARD_SHIPPING_AMOUNT,
        formattedAmount: formatCurrency(STANDARD_SHIPPING_AMOUNT),
        country: SHOP_COUNTRY,
        label: SHIPPING_LABEL,
      },
    });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/featured-products", async (req, res) => {
  try {
    const rows = await loadFeaturedProductRows();

    res.json({
      slotCount: FEATURED_PRODUCT_SLOT_COUNT,
      featuredProducts: rows.map((row) => ({
        ...serializeProduct(row),
        slot: Number(row.slot_index),
        highlightLabel: row.highlight_label || null,
      })),
    });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/products/:slug", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE slug = $1 AND active = true LIMIT 1",
      [req.params.slug],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ product: serializeProduct(result.rows[0]) });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/cart", requireAuth, async (req, res) => {
  try {
    const items = await loadUserCart(req.session.userId);
    res.json({ items });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.put("/api/cart", requireAuth, async (req, res) => {
  try {
    const items = await replaceUserCart(req.session.userId, req.body.items);
    res.json({ items });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.post("/api/checkout/session", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY before checkout.",
    });
  }

  try {
    const { validatedItems, shippingAmount } = await prepareCheckoutCart(req.body.items);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "sv",
      customer_creation: "always",
      billing_address_collection: "auto",
      shipping_address_collection: {
        allowed_countries: [SHOP_COUNTRY],
      },
      phone_number_collection: {
        enabled: true,
      },
      payment_method_types: enabledPaymentMethodTypes,
      line_items: buildLineItems(validatedItems, shippingAmount),
      success_url: `${FRONTEND_URL}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout-cancel.html`,
      metadata: {
        [CART_METADATA_KEY]: JSON.stringify(
          validatedItems.map((item) => ({
            productId: Number(item.product.id),
            quantity: item.quantity,
          })),
        ),
        [SHIPPING_METADATA_KEY]: String(shippingAmount),
        ...(req.session.userId ? { [ORDER_USER_METADATA_KEY]: String(req.session.userId) } : {}),
      },
    });

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/orders/checkout-session/:sessionId", async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT *
       FROM orders
       WHERE stripe_checkout_session_id = $1
       LIMIT 1`,
      [req.params.sessionId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderResult.rows[0];
    const itemsResult = await pool.query(
      `SELECT product_name, unit_amount, quantity, line_total
       FROM order_items
       WHERE order_id = $1
       ORDER BY id ASC`,
      [order.id],
    );

    res.json({
      order: buildOrderResponse(order, itemsResult.rows),
    });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/orders", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_email, payment_status, fulfillment_status, total_amount, created_at
       FROM orders
       ORDER BY created_at DESC
       LIMIT 50`,
    );

    res.json({ orders: result.rows });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, password, group } = req.body;
    const normalizedUsername = String(username || "").trim();
    const normalizedGroup = String(group || "").trim() || normalizedUsername;

    if (!normalizedUsername || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (normalizedUsername.length < 3) {
      return res
        .status(400)
        .json({ error: "Username must be at least 3 characters" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE username = $1",
      [normalizedUsername],
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password, group_name) VALUES ($1, $2, $3) RETURNING id, username, group_name, is_admin",
      [normalizedUsername, hashedPassword, normalizedGroup.toUpperCase()],
    );

    res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const result = await pool.query(
      "SELECT id, username, password, group_name, is_admin FROM users WHERE username = $1",
      [username.trim()],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = Boolean(user.is_admin);

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        group: user.group_name,
        isAdmin: Boolean(user.is_admin),
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out" });
    }

    res.json({ message: "Logout successful" });
  });
});

app.get("/api/user/profile", requireAuth, async (req, res) => {
  try {
    const user = await loadSessionUser(req.session.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    req.session.username = user.username;
    req.session.isAdmin = Boolean(user.is_admin);
    res.json({ user });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/user/password", requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      req.session.userId,
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/user/group", requireAuth, async (req, res) => {
  try {
    const { newGroup } = req.body;

    if (!newGroup || newGroup.trim().length === 0) {
      return res.status(400).json({ error: "Group name cannot be empty" });
    }

    await pool.query("UPDATE users SET group_name = $1 WHERE id = $2", [
      newGroup.trim().toUpperCase(),
      req.session.userId,
    ]);

    res.json({ message: "Group updated successfully" });
  } catch (error) {
    console.error("Group change error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/summary", requireAdmin, async (req, res) => {
  try {
    const [userStats, orderStats, productStats] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_users,
           COUNT(*) FILTER (WHERE is_admin)::int AS admin_users
         FROM users`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_orders,
           COUNT(*) FILTER (WHERE fulfillment_status NOT IN ('fulfilled', 'delivered', 'cancelled'))::int AS pending_orders
         FROM orders`,
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_products,
           COUNT(*) FILTER (WHERE active = true)::int AS active_products,
           COUNT(*) FILTER (WHERE active = true AND stock_quantity > 0 AND stock_quantity <= $1)::int AS low_stock_products
         FROM products`,
        [LOW_STOCK_THRESHOLD],
      ),
    ]);

    res.json({
      stats: {
        totalUsers: userStats.rows[0].total_users,
        adminUsers: userStats.rows[0].admin_users,
        totalOrders: orderStats.rows[0].total_orders,
        pendingOrders: orderStats.rows[0].pending_orders,
        totalProducts: productStats.rows[0].total_products,
        activeProducts: productStats.rows[0].active_products,
        lowStockProducts: productStats.rows[0].low_stock_products,
      },
    });
  } catch (error) {
    console.error("Admin summary error:", error);
    res.status(500).json({ error: "Could not load admin summary" });
  }
});

app.get("/api/admin/featured-products", requireAdmin, async (req, res) => {
  try {
    const rows = await loadFeaturedProductRows({ includeInactive: true });

    res.json({
      slotCount: FEATURED_PRODUCT_SLOT_COUNT,
      highlightLabelMaxLength: FEATURED_LABEL_MAX_LENGTH,
      featuredProducts: rows.map((row) => ({
        slot: Number(row.slot_index),
        productId: Number(row.product_id),
        highlightLabel: row.highlight_label || null,
        product: serializeAdminProduct(row),
      })),
    });
  } catch (error) {
    console.error("Admin featured products error:", error);
    res.status(500).json({ error: "Could not load featured products" });
  }
});

app.put("/api/admin/featured-products", requireAdmin, async (req, res) => {
  try {
    const featuredProducts = normalizeFeaturedProductsPayload(req.body || {});
    const productIds = [...new Set(featuredProducts.map((entry) => entry.productId))];
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (productIds.length > 0) {
        const productResult = await client.query(
          `SELECT id, name, active
           FROM products
           WHERE id = ANY($1::int[])
           FOR UPDATE`,
          [productIds],
        );

        if (productResult.rows.length !== productIds.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "One or more selected featured products no longer exist" });
        }

        const inactiveProduct = productResult.rows.find((product) => !product.active);

        if (inactiveProduct) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `${inactiveProduct.name} must be active before it can be featured` });
        }
      }

      await client.query("DELETE FROM featured_products");

      for (const entry of featuredProducts) {
        await client.query(
          `INSERT INTO featured_products (slot_index, product_id, highlight_label)
           VALUES ($1, $2, $3)`,
          [entry.slot, entry.productId, entry.highlightLabel],
        );
      }

      await client.query("COMMIT");

      const rows = await loadFeaturedProductRows({ includeInactive: true });
      return res.json({
        slotCount: FEATURED_PRODUCT_SLOT_COUNT,
        highlightLabelMaxLength: FEATURED_LABEL_MAX_LENGTH,
        featuredProducts: rows.map((row) => ({
          slot: Number(row.slot_index),
          productId: Number(row.product_id),
          highlightLabel: row.highlight_label || null,
          product: serializeAdminProduct(row),
        })),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    handleShopError(error, res);
  }
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const query = String(req.query.q || "").trim();
    const params = [];
    const whereClauses = [];

    if (status === "pending") {
      whereClauses.push("o.fulfillment_status NOT IN ('fulfilled', 'delivered', 'cancelled')");
    } else if (status !== "all") {
      params.push(status);
      whereClauses.push(`o.fulfillment_status = $${params.length}`);
    }

    if (query) {
      if (/^\d+$/.test(query)) {
        params.push(Number.parseInt(query, 10));
        const exactIdIndex = params.length;
        params.push(`%${query}%`);
        const partialIndex = params.length;
        whereClauses.push(
          `(o.id = $${exactIdIndex} OR CAST(o.id AS TEXT) ILIKE $${partialIndex} OR COALESCE(o.customer_name, '') ILIKE $${partialIndex} OR COALESCE(o.customer_email, '') ILIKE $${partialIndex} OR COALESCE(o.tracking_number, '') ILIKE $${partialIndex})`,
        );
      } else {
        params.push(`%${query}%`);
        const searchIndex = params.length;
        whereClauses.push(
          `(CAST(o.id AS TEXT) ILIKE $${searchIndex} OR COALESCE(o.customer_name, '') ILIKE $${searchIndex} OR COALESCE(o.customer_email, '') ILIKE $${searchIndex} OR COALESCE(o.tracking_number, '') ILIKE $${searchIndex})`,
        );
      }
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT
         o.id,
         o.customer_email,
         o.customer_name,
         o.payment_status,
         o.fulfillment_status,
         o.tracking_number,
         o.admin_note,
         o.customer_note,
         o.total_amount,
         o.created_at,
         o.updated_at,
         COUNT(oi.id)::int AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${whereClause}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 100`,
      params,
    );

    res.json({ orders: result.rows });
  } catch (error) {
    console.error("Admin orders error:", error);
    res.status(500).json({ error: "Could not load admin orders" });
  }
});

app.get("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const orderId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const orderResult = await pool.query(
      `SELECT *
       FROM orders
       WHERE id = $1
       LIMIT 1`,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const itemsResult = await pool.query(
      `SELECT product_name, unit_amount, quantity, line_total
       FROM order_items
       WHERE order_id = $1
       ORDER BY id ASC`,
      [orderId],
    );

    res.json({ order: buildOrderResponse(orderResult.rows[0], itemsResult.rows) });
  } catch (error) {
    console.error("Admin order detail error:", error);
    res.status(500).json({ error: "Could not load order details" });
  }
});

app.put("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const allowedStatuses = new Set(ORDER_FULFILLMENT_STATUSES);
    const orderId = Number.parseInt(req.params.id, 10);
    const fulfillmentStatus = String(req.body.fulfillmentStatus || "").trim().toLowerCase();
    const trackingNumber = String(req.body.trackingNumber || "").trim() || null;
    const adminNote = String(req.body.adminNote || "").trim() || null;
    const customerNote = String(req.body.customerNote || "").trim() || null;

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    if (!allowedStatuses.has(fulfillmentStatus)) {
      return res.status(400).json({ error: "Invalid fulfillment status" });
    }

    if (trackingNumber && trackingNumber.length > 120) {
      return res.status(400).json({ error: "Tracking number must be 120 characters or fewer" });
    }

    if (adminNote && adminNote.length > 2000) {
      return res.status(400).json({ error: "Admin note must be 2000 characters or fewer" });
    }

    if (customerNote && customerNote.length > 2000) {
      return res.status(400).json({ error: "Customer note must be 2000 characters or fewer" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentOrderResult = await client.query(
        "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
        [orderId],
      );

      if (currentOrderResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Order not found" });
      }

      const currentOrder = currentOrderResult.rows[0];
      const result = await client.query(
        `UPDATE orders
         SET fulfillment_status = $1,
             tracking_number = $2,
             admin_note = $3,
             customer_note = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [fulfillmentStatus, trackingNumber, adminNote, customerNote, orderId],
      );

      const itemsResult = await client.query(
        `SELECT product_name, unit_amount, quantity, line_total
         FROM order_items
         WHERE order_id = $1
         ORDER BY id ASC`,
        [orderId],
      );

      await client.query("COMMIT");

      const updatedOrder = buildOrderResponse(result.rows[0], itemsResult.rows);
      const shouldSendStatusEmail =
        updatedOrder.customerEmail &&
        currentOrder.fulfillment_status !== fulfillmentStatus &&
        ["packed", "fulfilled", "delivered", "inventory_issue", "cancelled"].includes(fulfillmentStatus);

      if (shouldSendStatusEmail) {
        await sendOrderStatusUpdateEmail(updatedOrder);
      }

      return res.json({ order: updatedOrder });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Admin order update error:", error);
    res.status(500).json({ error: "Could not update order" });
  }
});

app.get("/api/user/orders", requireAuth, async (req, res) => {
  try {
    const ordersResult = await pool.query(
      `SELECT *
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.session.userId],
    );

    if (ordersResult.rows.length === 0) {
      return res.json({ orders: [] });
    }

    const orderIds = ordersResult.rows.map((order) => Number(order.id));
    const itemsResult = await pool.query(
      `SELECT order_id, product_name, unit_amount, quantity, line_total
       FROM order_items
       WHERE order_id = ANY($1::int[])
       ORDER BY order_id DESC, id ASC`,
      [orderIds],
    );

    const itemsByOrderId = new Map();

    for (const item of itemsResult.rows) {
      const orderId = Number(item.order_id);

      if (!itemsByOrderId.has(orderId)) {
        itemsByOrderId.set(orderId, []);
      }

      itemsByOrderId.get(orderId).push(item);
    }

    res.json({
      orders: ordersResult.rows.map((order) =>
        buildOrderResponse(order, itemsByOrderId.get(Number(order.id)) || []),
      ),
    });
  } catch (error) {
    console.error("User orders error:", error);
    res.status(500).json({ error: "Could not load your orders" });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, group_name, is_admin, created_at
       FROM users
       ORDER BY LOWER(username) ASC, id ASC
       LIMIT 200`,
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error("Admin users error:", error);
    res.status(500).json({ error: "Could not load users" });
  }
});

app.post("/api/admin/product-images", requireAdmin, (req, res) => {
  productImageUpload.single("image")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Image must be 5 MB or smaller" });
      }

      return res.status(400).json({ error: error.message || "Could not upload image" });
    }

    if (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({ error: error.message || "Could not upload image" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Choose an image to upload" });
    }

    return res.status(201).json({
      imagePath: `${PRODUCT_UPLOAD_WEB_PATH}/${req.file.filename}`,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
});

app.get("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "true").trim().toLowerCase() !== "false";
    const category = String(req.query.category || "all").trim().toLowerCase();
    const params = [];
    const whereClauses = [];

    if (!includeInactive) {
      whereClauses.push("active = true");
    }

    if (category !== "all") {
      if (!PRODUCT_CATEGORY_SET.has(category)) {
        return res.status(400).json({ error: "Invalid product category" });
      }

      params.push(category);
      whereClauses.push(`category = $${params.length}`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT *
       FROM products
       ${whereClause}
       ORDER BY active DESC, updated_at DESC, id DESC
       LIMIT 300`,
      params,
    );

    res.json({
      products: result.rows.map(serializeAdminProduct),
      categories: PRODUCT_CATEGORIES,
      currency: SHOP_CURRENCY.toUpperCase(),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    });
  } catch (error) {
    console.error("Admin products error:", error);
    res.status(500).json({ error: "Could not load products" });
  }
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const productInput = normalizeAdminProductPayload(req.body || {});
    const duplicateProduct = await pool.query(
      "SELECT id FROM products WHERE slug = $1 LIMIT 1",
      [productInput.slug],
    );

    if (duplicateProduct.rows.length > 0) {
      return res.status(400).json({ error: "A product with this slug already exists" });
    }

    const result = await pool.query(
      `INSERT INTO products (
         slug,
         name,
         description,
         category,
         unit_amount,
         currency,
         stock_quantity,
         image_path,
         active,
         stripe_tax_code
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       RETURNING *`,
      [
        productInput.slug,
        productInput.name,
        productInput.description,
        productInput.category,
        productInput.unitAmount,
        productInput.currency,
        productInput.stockQuantity,
        productInput.imagePath,
        productInput.active,
        productInput.stripeTaxCode,
      ],
    );

    res.status(201).json({ product: serializeAdminProduct(result.rows[0]) });
  } catch (error) {
    handleShopError(error, res);
  }
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const productInput = normalizeAdminProductPayload(req.body || {});
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingProduct = await client.query(
        "SELECT id FROM products WHERE id = $1 FOR UPDATE",
        [productId],
      );

      if (existingProduct.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Product not found" });
      }

      const duplicateProduct = await client.query(
        "SELECT id FROM products WHERE slug = $1 AND id <> $2 LIMIT 1",
        [productInput.slug, productId],
      );

      if (duplicateProduct.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "A product with this slug already exists" });
      }

      const result = await client.query(
        `UPDATE products
         SET slug = $1,
             name = $2,
             description = $3,
             category = $4,
             unit_amount = $5,
             currency = $6,
             stock_quantity = $7,
             image_path = $8,
             active = $9,
             stripe_tax_code = $10,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $11
         RETURNING *`,
        [
          productInput.slug,
          productInput.name,
          productInput.description,
          productInput.category,
          productInput.unitAmount,
          productInput.currency,
          productInput.stockQuantity,
          productInput.imagePath,
          productInput.active,
          productInput.stripeTaxCode,
          productId,
        ],
      );

      await client.query("COMMIT");
      res.json({ product: serializeAdminProduct(result.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    handleShopError(error, res);
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingProduct = await client.query(
        "SELECT id, name, image_path FROM products WHERE id = $1 FOR UPDATE",
        [productId],
      );

      if (existingProduct.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Product not found" });
      }

      const product = existingProduct.rows[0];

      await client.query("DELETE FROM products WHERE id = $1", [productId]);
      await maybeDeleteManagedUploadImage(client, product.image_path, productId);

      await client.query("COMMIT");
      res.json({
        message: "Product deleted",
        product: {
          id: productId,
          name: product.name,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ error: "Could not delete product" });
  }
});

app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);
    const nextUsername = String(req.body.username || "").trim();
    const nextIsAdmin = Boolean(req.body.isAdmin);
    const nextPassword = String(req.body.newPassword || "");

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    if (!nextUsername || nextUsername.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }

    if (nextPassword && nextPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingUserResult = await client.query(
        "SELECT id, username, group_name, is_admin FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );

      if (existingUserResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found" });
      }

      const existingUser = existingUserResult.rows[0];
      const duplicateUser = await client.query(
        "SELECT id FROM users WHERE username = $1 AND id <> $2 LIMIT 1",
        [nextUsername, userId],
      );

      if (duplicateUser.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Username already exists" });
      }

      if (existingUser.is_admin && !nextIsAdmin) {
        const adminCount = await client.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE is_admin = true",
        );

        if (adminCount.rows[0].count <= 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "At least one admin account is required" });
        }
      }

      const nextGroupName =
        existingUser.group_name === existingUser.username.toUpperCase()
          ? nextUsername.toUpperCase()
          : existingUser.group_name;

      await client.query(
        `UPDATE users
         SET username = $1,
             group_name = $2,
             is_admin = $3
         WHERE id = $4`,
        [nextUsername, nextGroupName, nextIsAdmin, userId],
      );

      if (nextPassword) {
        const hashedPassword = await bcrypt.hash(nextPassword, 10);
        await client.query("UPDATE users SET password = $1 WHERE id = $2", [
          hashedPassword,
          userId,
        ]);
      }

      const updatedUserResult = await client.query(
        "SELECT id, username, group_name, is_admin, created_at FROM users WHERE id = $1",
        [userId],
      );

      await client.query("COMMIT");

      if (req.session.userId === userId) {
        req.session.username = updatedUserResult.rows[0].username;
        req.session.isAdmin = Boolean(updatedUserResult.rows[0].is_admin);
      }

      res.json({ user: updatedUserResult.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Admin user update error:", error);
    res.status(500).json({ error: "Could not update user" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    if (req.session.userId === userId) {
      return res.status(400).json({ error: "You cannot delete the account you are currently using" });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingUserResult = await client.query(
        "SELECT id, username, is_admin FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );

      if (existingUserResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found" });
      }

      const existingUser = existingUserResult.rows[0];

      if (existingUser.is_admin) {
        const adminCount = await client.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE is_admin = true",
        );

        if (adminCount.rows[0].count <= 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "At least one admin account is required" });
        }
      }

      await client.query("DELETE FROM users WHERE id = $1", [userId]);
      await client.query("COMMIT");

      res.json({
        message: "User deleted",
        user: {
          id: userId,
          username: existingUser.username,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Admin user delete error:", error);
    res.status(500).json({ error: "Could not delete user" });
  }
});

app.get("/api/auth/check", async (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }

  try {
    const user = await loadSessionUser(req.session.userId);

    if (!user) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }

    req.session.username = user.username;
    req.session.isAdmin = Boolean(user.is_admin);

    return res.json({
      authenticated: true,
      userId: user.id,
      username: user.username,
      isAdmin: Boolean(user.is_admin),
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return res.status(500).json({ error: "Could not check auth state" });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

async function startServer() {
  try {
    await ensureShopSupportTables();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Storefront: ${FRONTEND_URL}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error("Could not start server:", error);
    process.exit(1);
  }
}

startServer();
