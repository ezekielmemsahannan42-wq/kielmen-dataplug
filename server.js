"use strict";

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "https://ezekielmemsahannan42-wq.github.io",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "20kb" }));

// ==================================================
// ENVIRONMENT VARIABLES
// ==================================================

const DATABASE_URL = process.env.DATABASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Paystack requires an email even when your checkout
// form does not collect one.
//
// Set this to an email address you control in Render.
const PAYSTACK_CUSTOMER_EMAIL =
  process.env.PAYSTACK_CUSTOMER_EMAIL;

// Supplier delivery remains disabled until explicitly
// enabled in Render.
const DATAMART_PURCHASES_ENABLED =
  process.env.DATAMART_PURCHASES_ENABLED === "true";

const DATAMART_API_KEY = process.env.DATAMART_API_KEY;

// ==================================================
// DATABASE
// ==================================================

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

// ==================================================
// OFFICIAL CUSTOMER PRICES — GH₵
// These are the latest prices you supplied.
// The server, not the browser, determines the price.
// ==================================================

const PRICES = {
  MTN: {
    "1GB": 4.70,
    "2GB": 9.70,
    "3GB": 14.50,
    "4GB": 20.00,
    "5GB": 26.00,
    "6GB": 32.00,
    "8GB": 43.00,
    "10GB": 49.00,
    "15GB": 69.00,
    "20GB": 99.00,
    "25GB": 140.00,
    "30GB": 155.00,
    "40GB": 199.00,
    "50GB": 240.00
  },

  Telecel: {
    "10GB": 45.00,
    "15GB": 62.00,
    "20GB": 82.00,
    "25GB": 101.00,
    "30GB": 124.00,
    "40GB": 170.00,
    "50GB": 210.00,
    "100GB": 420.00
  },

  AirtelTigo: {
    "1GB": 5.00,
    "2GB": 9.20,
    "5GB": 22.00,
    "10GB": 41.00,
    "20GB": 78.00,
    "30GB": 115.00,
    "50GB": 188.00
  }
};

// ==================================================
// SUPPLIER NETWORK NAMES
// ==================================================

const NETWORK_MAP = {
  MTN: "YELLO",
  AirtelTigo: "AT_PREMIUM",
  Telecel: "TELECEL"
};

// ==================================================
// DATABASE INITIALIZATION
// ==================================================

async function createOrdersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      reference VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      network VARCHAR(50) NOT NULL,
      bundle VARCHAR(50) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      delivery_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
      supplier_reference VARCHAR(150),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add these columns to older tables if they are missing.
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery_status
    VARCHAR(30) NOT NULL DEFAULT 'not_started'
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(150)
  `);

  console.log("Orders table is ready.");
}

// ==================================================
// HELPERS
// ==================================================
// DATAMART SUPPLIER CONNECTION
async function purchaseDataFromSupplier(order) {
  if (process.env.DATAMART_PURCHASES_ENABLED !== "true") {
    throw new Error("Automatic data delivery is disabled.");
  }

  const apiKey = process.env.DATAMART_API_KEY;

  if (!apiKey) {
    throw new Error("DataMart API key is missing.");
  }

  if (!order.phone || !order.bundle || !order.reference) {
    throw new Error("Required order details are missing.");
  }

  // Convert website network names to DataMart network codes.
  const networkMap = {
    MTN: "YELLO",
    TELECEL: "TELECEL",
    AIRTELTIGO: "AT_PREMIUM"
  };

  const network = networkMap[
    String(order.network).toUpperCase()
  ];

  if (!network) {
    throw new Error("Unsupported network.");
  }

  // Extract the number of GB from a bundle such as "5GB".
  const match = String(order.bundle)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*GB$/i);

  if (!match) {
    throw new Error("Invalid data bundle capacity.");
  }

  const capacity = Number(match[1]);

  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error("Invalid data capacity.");
  }

  const phone = normalizePhone(order.phone);

  const response = await fetch(
  "https://api.datamartgh.shop/api/purchase",
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "X-Idempotency-Key": String(order.reference)
      },
      body: JSON.stringify({
        phoneNumber: phone,
        network: network,
        capacity: String(capacity),
        gateway: "wallet"
      })
    }
  );

  const result = await response.json();

  if (!response.ok || result.status !== "success") {
    throw new Error(
      result.message || "DataMart purchase failed."
    );
  }

  return {
    success: true,
    purchaseId: result.data?.purchaseId || null,
    orderReference: result.data?.orderReference || null,
    transactionReference:
      result.data?.transactionReference || null,
    network: result.data?.network || network,
    capacity: result.data?.capacity || capacity,
    orderStatus: result.data?.orderStatus || "unknown"
  };
}
function validGhanaPhone(phone) {
  const cleaned = String(phone || "").replace(/[\s-]/g, "");

  return /^(?:0\d{9}|\+233\d{9}|233\d{9})$/.test(cleaned);
}

function normalizePhone(phone) {
  let cleaned = String(phone || "").replace(/[\s-]/g, "");

  if (cleaned.startsWith("+233")) {
    cleaned = "0" + cleaned.slice(4);
  } else if (cleaned.startsWith("233")) {
    cleaned = "0" + cleaned.slice(3);
  }

  return cleaned;
}

function getApprovedPrice(network, bundle) {
  if (
    !Object.prototype.hasOwnProperty.call(PRICES, network) ||
    !Object.prototype.hasOwnProperty.call(PRICES[network], bundle)
  ) {
    return null;
  }

  return PRICES[network][bundle];
}

async function paystackRequest(path, body) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack is not configured on the server.");
  }

  const response = await fetch(
    `https://api.paystack.co${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  const data = await response.json();

  if (!response.ok || !data.status) {
    throw new Error(
      data.message || "Paystack request failed."
    );
  }

  return data.data;
}

// ==================================================
// HEALTH CHECK
// ==================================================

app.get("/", (req, res) => {
  res.json({
    service: "Kielmen 636 Dataplug Payment API",
    status: "online"
  });
});

// ==================================================
// GET APPROVED PRICES
// ==================================================

app.get("/prices", (req, res) => {
  res.json({
    success: true,
    currency: "GHS",
    prices: PRICES
  });
});

// ==================================================
// INITIALIZE PAYMENT
// ==================================================

app.post("/initialize-payment", async (req, res) => {
  try {
    const { phone, network, bundle } = req.body || {};

    // Validate the recipient's phone number.
    if (!validGhanaPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Ghana phone number."
      });
    }

    // Calculate the approved price on the server.
    const approvedPrice = getApprovedPrice(network, bundle);

    if (approvedPrice === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid network or data bundle."
      });
    }

    if (!Number.isFinite(approvedPrice) || approvedPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "The bundle price is invalid."
      });
    }

    // Paystack requires an email address. The customer
    // does not need to enter one in the checkout form.
    if (!PAYSTACK_CUSTOMER_EMAIL) {
      return res.status(503).json({
        success: false,
        message:
          "Checkout is not fully configured. Please contact the website owner."
      });
    }

    const email = PAYSTACK_CUSTOMER_EMAIL;
    const normalizedPhone = normalizePhone(phone);

    const reference =
      "KIELMEN_" +
      Date.now() +
      "_" +
      crypto.randomBytes(6).toString("hex");

    // Create the pending order before payment initialization.
    await pool.query(
      `INSERT INTO orders
        (reference, email, phone, network, bundle, amount, status, delivery_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'not_started')`,
      [
        reference,
        email,
        normalizedPhone,
        network,
        bundle,
        approvedPrice
      ]
    );

    // Amount must be sent to Paystack in pesewas.
    const amountInPesewas = Math.round(approvedPrice * 100);

    const payment = await paystackRequest(
      "/transaction/initialize",
      {
        email,
        amount: amountInPesewas,
        currency: "GHS",
        reference,
        callback_url:
          "https://ezekielmemsahannan42-wq.github.io/kielmen-dataplug/success.html",
        metadata: {
          order_reference: reference,
          phone: normalizedPhone,
          network,
          bundle
        }
      }
    );

    return res.json({
      success: true,
      reference,
      amount: approvedPrice,
      currency: "GHS",
      authorization_url: payment.authorization_url
    });
  } catch (error) {
    console.error("Payment initialization error:", error.message);

    return res.status(500).json({
      success: false,
      message:
        "Unable to start payment. Please try again later."
    });
  }
});

// ==================================================
// VERIFY PAYMENT
// ==================================================

app.post("/verify-payment", async (req, res) => {
  try {
    const reference = String(
      (req.body && req.body.reference) || ""
    ).trim();

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        message: "A valid payment reference is required."
      });
    }

    const orderResult = await pool.query(
      `SELECT reference, phone, network, bundle, amount,
              status, delivery_status
       FROM orders
       WHERE reference = $1`,
      [reference]
    );

    if (orderResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    const order = orderResult.rows[0];

    // Never deliver an order twice merely because the
    // customer refreshes the payment-success page.
    if (order.status === "paid") {
      return res.json({
        success: true,
        paid: true,
        reference,
        network: order.network,
        bundle: order.bundle,
        amount: Number(order.amount),
        delivery_status: order.delivery_status
      });
    }

    const payment = await paystackRequest(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );

    const verifiedAmount = Number(payment.amount);
    const expectedAmount = Math.round(
      Number(order.amount) * 100
    );

    if (
      payment.status !== "success" ||
      payment.currency !== "GHS" ||
      verifiedAmount !== expectedAmount ||
      payment.reference !== reference
    ) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "Payment could not be verified."
      });
    }

    // Only mark the order paid after checking Paystack.
    const updateResult = await pool.query(
      `UPDATE orders
       SET status = 'paid'
       WHERE reference = $1
         AND status = 'pending'
       RETURNING reference`,
      [reference]
    );

    if (updateResult.rowCount === 0) {
      const latest = await pool.query(
        `SELECT status, delivery_status
         FROM orders
         WHERE reference = $1`,
        [reference]
      );

      return res.json({
        success: true,
        paid: latest.rows[0]?.status === "paid",
        reference,
        delivery_status:
          latest.rows[0]?.delivery_status || "not_started"
      });
    }

    // Supplier delivery is deliberately not triggered
    // automatically in this starter version.
    // It must be safely integrated and tested first.

    return res.json({
      success: true,
      paid: true,
      reference,
      network: order.network,
      bundle: order.bundle,
      amount: Number(order.amount),
      delivery_status: "not_started",
      message:
        "Payment verified. Data delivery still requires supplier integration."
    });
  } catch (error) {
    console.error("Payment verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify payment right now."
    });
  }
});

// ==================================================
// ORDER STATUS
// ==================================================

app.get("/order-status/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "");

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid order reference."
      });
    }

    const result = await pool.query(
      `SELECT reference, phone, network, bundle, amount,
              status, delivery_status, created_at
       FROM orders
       WHERE reference = $1`,
      [reference]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    const order = result.rows[0];

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
        created_at: order.created_at
      }
    });
  } catch (error) {
    console.error("Order status error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve order status."
    });
  }
});

// ==================================================
// START SERVER
// ==================================================

async function startServer() {
  try {
    await createOrdersTable();

    app.listen(PORT, () => {
      console.log(
        `Kielmen Dataplug API listening on port ${PORT}`
      );
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
