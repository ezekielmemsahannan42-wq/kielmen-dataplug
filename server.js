"use strict";

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_CUSTOMER_EMAIL = process.env.PAYSTACK_CUSTOMER_EMAIL;
const DATAMART_API_KEY = process.env.DATAMART_API_KEY;
const PURCHASES_ENABLED =
  String(process.env.DATAMART_PURCHASES_ENABLED).toLowerCase() === "true";

const FRONTEND =
  "https://ezekielmemsahannan42-wq.github.io/kielmen-dataplug";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/i.test(DATABASE_URL)
    ? false
    : { rejectUnauthorized: false }
});

app.use(cors({
  origin: [
    "https://ezekielmemsahannan42-wq.github.io",
    "http://localhost:3000"
  ]
}));

app.use(express.json({ limit: "30kb" }));

// APPROVED PRICES IN GHANA CEDIS

const PRICES = {
  MTN: {
    "1GB": 4.70,
    "2GB": 9.70,
    "3GB": 14.50,
    "4GB": 20,
    "5GB": 26,
    "6GB": 32,
    "8GB": 43,
    "10GB": 49,
    "15GB": 69,
    "20GB": 99,
    "25GB": 140,
    "30GB": 155,
    "40GB": 199,
    "50GB": 240
  },

  TELECEL: {
    "10GB": 45,
    "15GB": 62,
    "20GB": 82,
    "25GB": 101,
    "30GB": 124,
    "40GB": 170,
    "50GB": 210,
    "100GB": 420
  },

  AIRTELTIGO: {
    "1GB": 5,
    "2GB": 9.20,
    "5GB": 22,
    "10GB": 41,
    "20GB": 78,
    "30GB": 115,
    "50GB": 188
  }
};

const NETWORK_CODES = {
  MTN: "YELLO",
  TELECEL: "TELECEL",
  AIRTELTIGO: "AT_PREMIUM"
};

function normalizeNetwork(value) {
  const network = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, "");

  if (["MTN", "YELLO"].includes(network)) return "MTN";

  if (["TELECEL", "VODAFONE"].includes(network)) {
    return "TELECEL";
  }

  if (["AIRTELTIGO", "ATPREMIUM", "AIRTEL"].includes(network)) {
    return "AIRTELTIGO";
  }

  return "";
}

function normalizeBundle(value) {
  const match = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/^(\d+(?:\.\d+)?)GB?$/);

  return match ? `${Number(match[1])}GB` : "";
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/[^\d+]/g, "");

  if (phone.startsWith("+233")) {
    phone = "0" + phone.slice(4);
  } else if (phone.startsWith("233")) {
    phone = "0" + phone.slice(3);
  }

  return phone;
}

function validPhone(phone) {
  return /^0\d{9}$/.test(normalizePhone(phone));
}

async function createOrdersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      reference VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(20) NOT NULL,
      network VARCHAR(30) NOT NULL,
      bundle VARCHAR(30) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      delivery_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
      supplier_reference VARCHAR(150),
      supplier_response JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery_status
    VARCHAR(30) NOT NULL DEFAULT 'not_started'
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(150)
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS supplier_response JSONB
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS updated_at
    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
}

async function paystackRequest(path, method = "GET", body) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack secret key is not configured.");
  }

  const response = await fetch(
    "https://api.paystack.co" + path,
    {
      method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.status !== true) {
    throw new Error(result.message || "Paystack request failed.");
  }

  return result.data;
}

// DATAMART API REQUEST

async function dataMartRequest(path, method = "GET", body, key) {
  if (!DATAMART_API_KEY) {
    throw new Error("DataMart API key is missing.");
  }

  const headers = {
    "X-API-Key": DATAMART_API_KEY,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  if (key) {
    headers["X-Idempotency-Key"] = key;
  }

  const response = await fetch(
    "https://api.datamartgh.shop" + path,
    {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false ||
      result.status === false || result.error) {
    throw new Error(
      result.message || result.error || "DataMart request failed."
    );
  }

  return result;
}

// PURCHASE DATA AFTER PAYMENT VERIFICATION

async function purchaseDataFromSupplier(order) {
  if (!PURCHASES_ENABLED) {
    throw new Error("Automatic purchases are disabled.");
  }

  const network = normalizeNetwork(order.network);
  const supplierNetwork = NETWORK_CODES[network];
  const bundle = normalizeBundle(order.bundle);
  const phone = normalizePhone(order.phone);

  if (!supplierNetwork || !bundle || !validPhone(phone)) {
    throw new Error("Invalid phone, network or bundle.");
  }

  const result = await dataMartRequest(
    "/api/developer/purchase",
    "POST",
    {
      phoneNumber: phone,
      network: supplierNetwork,
      capacity: bundle.replace(/GB$/i, ""),
      gateway: "wallet"
    },
    "kielmen-" + order.reference
  );

  const supplierReference =
  result.data?.purchaseId ||
  result.data?.orderReference ||
  result.data?.transactionReference ||
  result.reference ||
  result.orderReference ||
  result.order_reference ||
  result.data?.reference ||
  result.data?.order_reference;

  if (!supplierReference) {
    throw new Error(
      "DataMart did not return an order reference. Check the DataMart dashboard before retrying."
    );
  }

  return {
    supplierReference: String(supplierReference),
    result
  };
}
// OWNER DASHBOARD AUTHENTICATION

const OWNER_SECRET = process.env.OWNER_SECRET;

const ownerSessions = new Map();

function requireOwner(req, res, next) {
  const token = req.headers.authorization || "";
  const sessionToken = token.startsWith("Bearer ")
    ? token.slice(7)
    : "";

  const session = ownerSessions.get(sessionToken);

  if (
    !sessionToken ||
    !session ||
    session.expiresAt < Date.now()
  ) {
    if (sessionToken) {
      ownerSessions.delete(sessionToken);
    }

    return res.status(401).json({
      success: false,
      message: "Owner login required."
    });
  }

  next();
}

// OWNER LOGIN
app.post("/owner/login", (req, res) => {
  if (!OWNER_SECRET) {
    return res.status(503).json({
      success: false,
      message: "Owner login is not configured."
    });
  }

  const password = String(req.body?.password || "");

  if (
    !password ||
    password.length > 500 ||
    password !== OWNER_SECRET
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid owner password."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  ownerSessions.set(token, {
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  });

  return res.json({
    success: true,
    token,
    expiresIn: 28800
  });
});

// OWNER LOGOUT
app.post("/owner/logout", requireOwner, (req, res) => {
  const token = req.headers.authorization.slice(7);

  ownerSessions.delete(token);

  return res.json({
    success: true,
    message: "Logged out successfully."
  });
});
// HEALTH CHECK

app.get("/", (_req, res) => {
  res.json({
    service: "Kielmen 636 Dataplug API",
    status: "online",
    automaticPurchasesEnabled: PURCHASES_ENABLED
  });
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ success: true, database: "connected" });
  } catch (_error) {
    res.status(503).json({
      success: false,
      database: "unavailable"
    });
  }
});

// PUBLIC PRICE LIST

app.get("/prices", (_req, res) => {
  res.json({
    success: true,
    currency: "GHS",
    prices: PRICES
  });
});

// INITIALIZE PAYSTACK PAYMENT

app.post("/initialize-payment", async (req, res) => {
  try {
    if (!PAYSTACK_CUSTOMER_EMAIL || !PAYSTACK_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message: "Payment service is not configured."
      });
    }

    const phone = normalizePhone(req.body?.phone);
    const network = normalizeNetwork(req.body?.network);
    const bundle = normalizeBundle(req.body?.bundle);

    if (!validPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Ghana phone number."
      });
    }

    if (!network || !PRICES[network]?.[bundle]) {
      return res.status(400).json({
        success: false,
        message: "Invalid network or data bundle."
      });
    }

    const amount = PRICES[network][bundle];

    const reference =
      "K636-" + Date.now() + "-" +
      crypto.randomBytes(5).toString("hex");

    await pool.query(
      `INSERT INTO orders
       (reference, email, phone, network, bundle, amount,
        status, delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','not_started')`,
      [
        reference,
        PAYSTACK_CUSTOMER_EMAIL,
        phone,
        network,
        bundle,
        amount
      ]
    );

    try {
      const payment = await paystackRequest(
        "/transaction/initialize",
        "POST",
        {
          email: PAYSTACK_CUSTOMER_EMAIL,
          amount: Math.round(amount * 100),
          currency: "GHS",
          reference,
          callback_url: FRONTEND + "/success.html",
          metadata: {
            order_reference: reference,
            phone,
            network,
            bundle
          }
        }
      );

      return res.json({
        success: true,
        reference,
        authorization_url: payment.authorization_url,
        access_code: payment.access_code,
        amount,
        currency: "GHS"
      });
    } catch (error) {
      await pool.query(
        `UPDATE orders
         SET status = 'initialization_failed', updated_at = NOW()
         WHERE reference = $1`,
        [reference]
      );

      throw error;
    }
  } catch (error) {
    console.error("Payment initialization:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not start payment. Please try again."
    });
  }
});

// VERIFY PAYMENT AND TRIGGER DATA PURCHASE

app.post("/verify-payment", async (req, res) => {
  const reference = String(req.body?.reference || "").trim();

  if (!reference || reference.length > 100) {
    return res.status(400).json({
      success: false,
      paid: false,
      message: "A valid payment reference is required."
    });
  }

  let client;

  try {
    const found = await pool.query(
      `SELECT * FROM orders WHERE reference = $1`,
      [reference]
    );

    if (found.rowCount === 0) {
      return res.status(404).json({
        success: false,
        paid: false,
        message: "Order not found."
      });
    }

    const order = found.rows[0];

    if (order.status === "paid") {
      return res.json({
        success: true,
        paid: true,
        reference,
        network: order.network,
        bundle: order.bundle,
        amount: Number(order.amount),
        delivery_status: order.delivery_status,
        message: "Payment was already verified. No duplicate purchase started."
      });
    }

    const payment = await paystackRequest(
      "/transaction/verify/" + encodeURIComponent(reference)
    );

    if (
      payment.status !== "success" ||
      String(payment.currency).toUpperCase() !== "GHS" ||
      Number(payment.amount) !== Math.round(Number(order.amount) * 100) ||
      String(payment.reference) !== reference
    ) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Payment verification failed."
      });
    }

    // Claim the order as paid only once.
    client = await pool.connect();
    await client.query("BEGIN");

    const claimed = await client.query(
      `UPDATE orders
       SET status = 'paid', updated_at = NOW()
       WHERE reference = $1 AND status = 'pending'
       RETURNING reference, phone, network, bundle, amount`,
      [reference]
    );

    await client.query("COMMIT");

    if (claimed.rowCount === 0) {
      const latest = await pool.query(
        `SELECT status, delivery_status
         FROM orders WHERE reference = $1`,
        [reference]
      );

      return res.json({
        success: true,
        paid: latest.rows[0]?.status === "paid",
        reference,
        delivery_status: latest.rows[0]?.delivery_status,
        message: "Order was already processed."
      });
    }

    const paidOrder = claimed.rows[0];

    // Reserve the one-time purchase attempt before calling DataMart.
    const deliveryClaim = await pool.query(
      `UPDATE orders
       SET delivery_status = 'processing', updated_at = NOW()
       WHERE reference = $1
       AND status = 'paid'
       AND delivery_status = 'not_started'
       RETURNING reference`,
      [reference]
    );

    if (deliveryClaim.rowCount === 0) {
      return res.status(202).json({
        success: true,
        paid: true,
        reference,
        delivery_status: "processing",
        message: "Delivery is already being processed."
      });
    }

    try {
      const purchase = await purchaseDataFromSupplier(paidOrder);

      await pool.query(
        `UPDATE orders
         SET delivery_status = 'processing',
             supplier_reference = $1,
             supplier_response = $2::jsonb,
             updated_at = NOW()
         WHERE reference = $3`,
        [
          purchase.supplierReference,
          JSON.stringify(purchase.result),
          reference
        ]
      );

      return res.status(202).json({
        success: true,
        paid: true,
        reference,
        network: paidOrder.network,
        bundle: paidOrder.bundle,
        amount: Number(paidOrder.amount),
        delivery_status: "processing",
        supplier_reference: purchase.supplierReference,
        message: "Payment verified. DataMart accepted the order for processing."
      });
    } catch (deliveryError) {
      console.error(
        "DataMart delivery error:",
        reference,
        deliveryError.message
      );

      await pool.query(
        `UPDATE orders
         SET delivery_status = 'failed',
             supplier_response = $1::jsonb,
             updated_at = NOW()
         WHERE reference = $2`,
        [
          JSON.stringify({ message: deliveryError.message }),
          reference
        ]
      );

      return res.status(202).json({
        success: true,
        paid: true,
        reference,
        delivery_status: "failed",
        message: "Payment received, but delivery needs support. Do not pay again."
      });
    }
  } catch (error) {
    console.error("Verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify right now. Do not pay again."
    });
  } finally {
    if (client) client.release();
  }
});

// CHECK ORDER AND DATAMART DELIVERY STATUS

app.get("/order-status/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid order reference."
      });
    }

    const result = await pool.query(
      `SELECT reference, phone, network, bundle, amount, status,
              delivery_status, supplier_reference, created_at, updated_at
       FROM orders WHERE reference = $1`,
      [reference]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    const order = result.rows[0];

    if (order.supplier_reference && DATAMART_API_KEY) {
      try {
        const supplier = await dataMartRequest(
          "/api/developer/order-status/" +
          encodeURIComponent(order.supplier_reference)
        );

        const status = String(
  supplier.data?.orderStatus ||
  supplier.orderStatus ||
  supplier.status ||
  supplier.data?.status ||
  supplier.delivery_status ||
  ""
).toLowerCase();

        if (["delivered", "completed", "success", "successful"].includes(status)) {
          order.delivery_status = "delivered";

          await pool.query(
            `UPDATE orders
             SET delivery_status = 'delivered',
                 supplier_response = $1::jsonb,
                 updated_at = NOW()
             WHERE reference = $2`,
            [JSON.stringify(supplier), reference]
          );
        } else if (["failed", "rejected", "cancelled", "canceled"].includes(status)) {
          order.delivery_status = "failed";

          await pool.query(
            `UPDATE orders
             SET delivery_status = 'failed',
                 supplier_response = $1::jsonb,
                 updated_at = NOW()
             WHERE reference = $2`,
            [JSON.stringify(supplier), reference]
          );
        }
      } catch (error) {
        console.error("DataMart status check:", error.message);
      }
    }

    return res.json({
      success: true,
      order: {
        reference: order.reference,
        phone: order.phone,
        network: order.network,
        bundle: order.bundle,
        amount: Number(order.amount),
        payment_status: order.status,
        delivery_status: order.delivery_status,
        supplier_reference: order.supplier_reference,
        created_at: order.created_at,
        updated_at: order.updated_at
      }
    });
  } catch (error) {
    console.error("Order status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not check order status."
    });
  }
});
// CUSTOMER ORDER TRACKING
app.get("/orders-by-phone/:phone", async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);

    if (!validPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid phone number."
      });
    }

    const result = await pool.query(
      `SELECT
        reference,
        phone,
        network,
        bundle,
        amount,
        status AS payment_status,
        delivery_status,
        created_at,
        updated_at
       FROM orders
       WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [phone.slice(-9)]
    );

    return res.json({
      success: true,
      orders: result.rows.map(order => ({
        reference: order.reference,
        phone: order.phone,
        network: order.network,
        bundle: order.bundle,
        amount: Number(order.amount),
        payment_status: order.payment_status,
        delivery_status: order.delivery_status,
        created_at: order.created_at,
        updated_at: order.updated_at
      }))
    });
  } catch (error) {
    console.error("Customer order tracking error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to check orders. Please try again."
    });
  }
});
// START SERVER

async function startServer() {
  try {
    await createOrdersTable();

    app.listen(PORT, () => {
      console.log("Kielmen 636 Dataplug API running on port " + PORT);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  await pool.end().catch(() => {});
  process.exit(0);
});

startServer();
