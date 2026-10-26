/**
 * Kielmen 636 Dataplug — Payment, DataMart Delivery and Agent API
 *
 * Required Render environment variables:
 * DATABASE_URL
 * PAYSTACK_SECRET_KEY
 * PAYSTACK_CUSTOMER_EMAIL
 * DATAMART_API_KEY
 * DATAMART_PURCHASES_ENABLED=true
 * OWNER_SECRET
 * AGENT_TOKEN_SECRET
 *
 * Never expose secret keys in frontend code.
 */

"use strict";

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const calculateAgentTotalProfit = require("./agent-profit");
const {
  calculateNextPayout
} = require("./next-payout");
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_CUSTOMER_EMAIL = process.env.PAYSTACK_CUSTOMER_EMAIL;
const DATAMART_API_KEY = process.env.DATAMART_API_KEY;
const WITHDRAWALS_ENABLED =
  String(process.env.WITHDRAWALS_ENABLED || "false").toLowerCase() === "true";

const DATAMART_PURCHASES_ENABLED =
  String(process.env.DATAMART_PURCHASES_ENABLED || "").toLowerCase() === "true";

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ||
  "https://kielmen.com";

const FRONTEND_BASE_URL =
  "https://kielmen.com";

const AGENT_TOKEN_SECRET = process.env.AGENT_TOKEN_SECRET || "";
const OWNER_SECRET = process.env.OWNER_SECRET || "";

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
}

if (!PAYSTACK_SECRET_KEY) {
  console.error("Missing PAYSTACK_SECRET_KEY");
}

if (!PAYSTACK_CUSTOMER_EMAIL) {
  console.error("Missing PAYSTACK_CUSTOMER_EMAIL");
}

if (AGENT_TOKEN_SECRET.length < 32) {
  console.error("AGENT_TOKEN_SECRET must be at least 32 characters.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl:
    DATABASE_URL &&
    !/localhost|127\.0\.0\.1/i.test(DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        origin === FRONTEND_ORIGIN ||
        origin === "https://ezekielmemsahannan42-wq.github.io"
      ) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },

    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With"
    ]
  })
);

app.use(
  express.json({
    limit: "30kb",
    verify: (req, res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    }
  })
);

// ============================================================
// 1. PUBLIC CUSTOMER PRICES — GHS
// ============================================================

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

  TELECEL: {
    "10GB": 45.00,
    "15GB": 62.00,
    "20GB": 82.00,
    "25GB": 101.00,
    "30GB": 124.00,
    "40GB": 170.00,
    "50GB": 210.00,
    "100GB": 420.00
  },

  AIRTELTIGO: {
    "1GB": 5.00,
    "2GB": 9.20,
    "5GB": 22.00,
    "10GB": 41.00,
    "20GB": 78.00,
    "30GB": 115.00,
    "50GB": 188.00
  }
};

// ============================================================
// 2. FIXED AGENT BASE PRICES — GHS
// Agents may choose their own selling prices.
// ============================================================

const AGENT_BASE_PRICES = {
  MTN: {
    "1GB": 4.50,
    "2GB": 9.00,
    "3GB": 13.00,
    "4GB": 17.50,
    "5GB": 21.00,
    "6GB": 25.00,
    "8GB": 34.00,
    "10GB": 42.00,
    "15GB": 59.00,
    "20GB": 79.00,
    "25GB": 98.00,
    "30GB": 119.00,
    "40GB": 157.00,
    "50GB": 197.00
  },

  // Provisional prices: confirm these before enabling these networks
  // for agents.
  TELECEL: { ...PRICES.TELECEL },

  AIRTELTIGO: { ...PRICES.AIRTELTIGO }
};

const SUPPLIER_NETWORKS = {
  MTN: "YELLO",
  TELECEL: "TELECEL",
  AIRTELTIGO: "AT_PREMIUM"
};

// ============================================================
// 3. GENERAL HELPERS
// ============================================================

function normalizeNetwork(value) {
const raw = String(value || "")
.trim()
.toUpperCase()
.replace(/[\s_-]/g, "");

if (raw === "MTN" || raw === "YELLO") {
return "MTN";
}

if (raw === "TELECEL" || raw === "VODAFONE") {
return "TELECEL";
}

if (
raw === "AIRTELTIGO" ||
raw === "ATPREMIUM" ||
raw === "AIRTEL"
) {
return "AIRTELTIGO";
}

return "";
}

function normalizeBundle(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  const match = raw.match(/^(\d+(?:\.\d+)?)GB?$/);

  if (!match) {
    return "";
  }

  return `${Number(match[1])}GB`;
}

function normalizePhone(value) {
  let phone = String(value || "")
    .replace(/[^\d+]/g, "");

  if (phone.startsWith("+233")) {
    phone = "0" + phone.slice(4);
  } else if (phone.startsWith("233")) {
    phone = "0" + phone.slice(3);
  }

  return phone;
}
function createStoreSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

function validGhanaPhone(value) {
  return /^0\d{9}$/.test(normalizePhone(value));
}

function amountToPesewas(cedis) {
  return Math.round(Number(cedis) * 100);
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

// ============================================================
// 4. DATABASE TABLES AND MIGRATIONS
// ============================================================

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
      delivery_status VARCHAR(30)
        NOT NULL DEFAULT 'not_started',
      supplier_reference VARCHAR(150),
      supplier_response JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  
// Record the time an order's data delivery is completed.
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ
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

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS agent_base_price NUMERIC(10,2)
  `);
  await pool.query(`
  ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ
`);

await pool.query(`
  UPDATE orders
  SET delivered_at = updated_at
  WHERE delivery_status = 'delivered'
    AND delivered_at IS NULL
`);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS supplier_cost NUMERIC(10,2)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS orders_created_at_idx
    ON orders (created_at DESC)
  `);
      // Generate unique store slugs for existing agents.
  const agentsWithoutSlugs = await pool.query(`
    SELECT id, business_name
    FROM agents
    WHERE store_slug IS NULL OR store_slug = ''
    ORDER BY id ASC
  `);

  for (const agent of agentsWithoutSlugs.rows) {
    const baseSlug =
      createStoreSlug(agent.business_name) || `agent_${agent.id}`;

    let storeSlug = baseSlug;
    let suffix = 2;

    while (true) {
      const existingSlug = await pool.query(
        `
          SELECT id
          FROM agents
          WHERE store_slug = $1
            AND id <> $2
          LIMIT 1
        `,
        [storeSlug, agent.id]
      );

      if (!existingSlug.rowCount) {
        break;
      }

      storeSlug = `${baseSlug}_${suffix}`;
      suffix++;
    }

    await pool.query(
      `
        UPDATE agents
        SET store_slug = $1,
            updated_at = NOW()
        WHERE id = $2
      `,
      [storeSlug, agent.id]
    );
  }

  // Enforce uniqueness for future agent registrations.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS agents_store_slug_unique_idx
    ON agents(store_slug)
    WHERE store_slug IS NOT NULL
  `);
}

async function createAgentTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id BIGSERIAL PRIMARY KEY,
      agent_code VARCHAR(30) UNIQUE NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      business_name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
          status IN (
            'pending',
            'approved',
            'rejected',
            'suspended'
          )
        ),
      store_description VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // Add the store slug column to existing databases.
await pool.query(`
  ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS store_slug VARCHAR(100)
`);

// Agent profile contact and social links
await pool.query(`
  ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS whatsapp_number
  VARCHAR(25) NOT NULL DEFAULT ''
`);

await pool.query(`
  ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS whatsapp_channel
  VARCHAR(500) NOT NULL DEFAULT ''
`);

await pool.query(`
  ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS social_link
  VARCHAR(500) NOT NULL DEFAULT ''
`);
  

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_prices (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT NOT NULL
        REFERENCES agents(id) ON DELETE CASCADE,
      network VARCHAR(30) NOT NULL,
      bundle VARCHAR(30) NOT NULL,
      selling_price NUMERIC(10,2) NOT NULL
        CHECK (selling_price >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agent_id, network, bundle)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_withdrawals (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT NOT NULL REFERENCES agents(id),
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      phone VARCHAR(20) NOT NULL,
      provider VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
          status IN (
            'pending',
            'approved',
            'rejected',
            'paid'
          )
        ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Record when an agent's withdrawal request is reviewed.
  await pool.query(`
    ALTER TABLE agent_withdrawals
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS agent_id BIGINT
    REFERENCES agents(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS orders_agent_id_idx
    ON orders(agent_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS agents_status_idx
    ON agents(status)
  `);
}

// ============================================================
// 5. PAYSTACK API
// ============================================================

async function paystackRequest(
  path,
  method = "GET",
  body = undefined
) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack is not configured on the server.");
  }

  const response = await fetch(
    `https://api.paystack.co${path}`,
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
    throw new Error(
      result.message ||
      `Paystack request failed (${response.status}).`
    );
  }

  return result.data;
}

// ============================================================
// 6. DATAMART API
// ============================================================

async function dataMartRequest(
  path,
  method = "GET",
  body = undefined,
  idempotencyKey = undefined
) {
  if (!DATAMART_API_KEY) {
    throw new Error("DataMart API key is missing on the server.");
  }

  const headers = {
    "X-API-Key": DATAMART_API_KEY,
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (idempotencyKey) {
    headers["X-Idempotency-Key"] = idempotencyKey;
  }

  const response = await fetch(
    `https://api.datamartgh.shop${path}`,
    {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.message ||
      result.error ||
      `DataMart request failed (${response.status}).`
    );
  }

  if (
    result.success === false ||
    result.status === false ||
    result.error
  ) {
    throw new Error(
      result.message ||
      result.error ||
      "DataMart rejected the purchase."
    );
  }

  return result;
}

function supplierReferenceFrom(result) {
  const candidates = [
    result && result.reference,
    result && result.orderReference,
    result && result.order_reference,
    result && result.data && result.data.reference,
    result && result.data && result.data.orderReference,
    result && result.data && result.data.order_reference
  ];

  return (
    candidates.find(
      value =>
        typeof value === "string" &&
        value.trim()
    ) || null
  );
}

async function purchaseDataFromSupplier(order) {
  if (!DATAMART_PURCHASES_ENABLED) {
    throw new Error(
      "Automatic DataMart purchases are disabled."
    );
  }

  if (!DATAMART_API_KEY) {
    throw new Error("DataMart API key is missing.");
  }

  const network = normalizeNetwork(order.network);
  const supplierNetwork = SUPPLIER_NETWORKS[network];
  const bundle = normalizeBundle(order.bundle);
  const phone = normalizePhone(order.phone);

  if (
    !supplierNetwork ||
    !bundle ||
    !validGhanaPhone(phone) ||
    !order.reference
  ) {
    throw new Error("Invalid order details for DataMart.");
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
    `kielmen-${order.reference}`
  );

  const supplierReference = supplierReferenceFrom(result);

  if (!supplierReference) {
    throw new Error(
      "DataMart response did not include an order reference. Check DataMart before retrying."
    );
  }

  return {
    supplierReference,
    raw: result
  };
}

async function getOrderByReference(reference) {
  const result = await pool.query(
    `
      SELECT
        reference,
        email,
        phone,
        network,
        bundle,
        amount,
        status,
        delivery_status,
        supplier_reference,
        created_at,
        updated_at
      FROM orders
      WHERE reference = $1
    `,
    [reference]
  );

  return result.rows[0] || null;
}
  // ============================================================
// AUTOMATIC PAYSTACK PAYMENT VERIFICATION + DATA DELIVERY
// ============================================================

async function processSuccessfulPayment(reference) {
  if (!reference || reference.length > 100) {
    throw new Error("Invalid payment reference.");
  }

  // Find the order created before checkout.
  const order = await getOrderByReference(reference);

  if (!order) {
    throw new Error(`Order not found: ${reference}`);
  }

  // Verify directly with Paystack. Never trust a browser
  // redirect or webhook payload alone.
  const payment = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  const expectedAmount = amountToPesewas(order.amount);

  if (
    payment.status !== "success" ||
    String(payment.reference || "") !== reference ||
    String(payment.currency || "").toUpperCase() !== "GHS" ||
    Number(payment.amount) !== expectedAmount
  ) {
    throw new Error(
      `Paystack verification failed for ${reference}`
    );
  }

  // Atomically mark the order paid if it has not already
  // been marked paid.
  await pool.query(
    `
      UPDATE orders
      SET status = 'paid',
          updated_at = NOW()
      WHERE reference = $1
        AND status IN ('pending', 'initialization_failed')
    `,
    [reference]
  );

  // Atomically claim delivery. This prevents duplicate
  // webhook notifications from initiating another purchase.
  const claim = await pool.query(
    `
      UPDATE orders
      SET delivery_status = 'processing',
          updated_at = NOW()
      WHERE reference = $1
        AND status = 'paid'
        AND delivery_status = 'not_started'
      RETURNING
        reference,
        phone,
        network,
        bundle,
        amount
    `,
    [reference]
  );

  if (!claim.rowCount) {
    const latest = await getOrderByReference(reference);

    return {
      success: true,
      paid: true,
      reference,
      delivery_status: latest?.delivery_status || "unknown",
      message:
        "Payment verified. Delivery has already been claimed or processed."
    };
  }

  const paidOrder = claim.rows[0];

  try {
    // Automatically purchase the data bundle.
    const purchase = await purchaseDataFromSupplier(paidOrder);

    await pool.query(
      `
        UPDATE orders
        SET supplier_reference = $1,
            supplier_response = $2::jsonb,
            delivery_status = 'processing',
            updated_at = NOW()
        WHERE reference = $3
      `,
      [
        purchase.supplierReference,
        JSON.stringify(purchase.raw),
        reference
      ]
    );

    return {
      success: true,
      paid: true,
      reference,
      delivery_status: "processing",
      supplier_reference: purchase.supplierReference,
      message:
        "Payment verified and the data order was accepted for processing."
    };
  } catch (error) {
    console.error(
      "Automatic data delivery failed:",
      reference,
      error.message
    );

    await pool.query(
      `
        UPDATE orders
        SET delivery_status = 'failed',
            supplier_response = $1::jsonb,
            updated_at = NOW()
        WHERE reference = $2
      `,
      [
        JSON.stringify({
          message: error.message
        }),
        reference
      ]
    );

    return {
      success: true,
      paid: true,
      reference,
      delivery_status: "failed",
      message:
        "Payment received, but data delivery needs investigation. Do not pay again."
    };
  }
}


async function refreshSupplierOrderStatus(supplierReference) {
  if (!supplierReference || !DATAMART_API_KEY) {
    throw new Error(
      "A DataMart supplier reference and API key are required."
    );
  }

  const path =
    "/api/developer/order-status/" +
    encodeURIComponent(supplierReference);

  const result = await dataMartRequest(path, "GET");

  const status = String(
    result.data?.orderStatus ||
    result.orderStatus ||
    result.data?.delivery_status ||
    result.delivery_status ||
    result.data?.status ||
    result.status ||
    ""
  ).trim().toLowerCase();

  if (
    ["delivered", "completed", "success", "successful"].includes(status)
  ) {
    return {
      status: "delivered",
      raw: result
    };
  }

  if (
    ["failed", "rejected", "cancelled", "canceled"].includes(status)
  ) {
    return {
      status: "failed",
      raw: result
    };
  }

  return {
    status: "processing",
    raw: result
  };
}

// ============================================================
// 7. AGENT AUTHENTICATION
// ============================================================

// ============================================================
// 7. AGENT AUTHENTICATION
// ============================================================

const agentSessions = new Map();
const ownerSessions = new Map();

function hashAgentPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);

    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) {
        return reject(error);
      }

      resolve(
        `${salt.toString("hex")}:${key.toString("hex")}`
      );
    });
  });
}

function verifyAgentPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const parts = String(stored || "").split(":");

    if (parts.length !== 2) {
      return resolve(false);
    }

    const salt = Buffer.from(parts[0], "hex");
    const expected = Buffer.from(parts[1], "hex");

    crypto.scrypt(
      password,
      salt,
      expected.length,
      (error, key) => {
        if (error) {
          return reject(error);
        }

        resolve(
          key.length === expected.length &&
          crypto.timingSafeEqual(key, expected)
        );
      }
    );
  });
}

function requireAgent(req, res, next) {
  const auth = String(req.headers.authorization || "");

  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  const session = agentSessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    if (token) {
      agentSessions.delete(token);
    }

    return res.status(401).json({
      success: false,
      message: "Please log in again."
    });
  }

  req.agentId = session.agentId;

  next();
}

async function requireApprovedAgent(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT status FROM agents WHERE id = $1",
      [req.agentId]
    );

    if (
      !result.rowCount ||
      result.rows[0].status !== "approved"
    ) {
      return res.status(403).json({
        success: false,
        message: "Agent account is not approved."
      });
    }

    next();
  } catch (error) {
    console.error("Agent check:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not verify agent account."
    });
  }
}

function requireOwner(req, res, next) {
  const auth = String(req.headers.authorization || "");

  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  const session = ownerSessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    if (token) {
      ownerSessions.delete(token);
    }

    return res.status(401).json({
      success: false,
      message: "Owner login required."
    });
  }

  next();
}

function requireWithdrawalsEnabled(req, res, next) {
  if (!WITHDRAWALS_ENABLED) {
    return res.status(503).json({
      success: false,
      message: "Withdrawals are temporarily disabled."
    });
  }

  next();
}
// ============================================================
// ============================================================
// 8. AGENT REGISTRATION — AUTOMATIC APPROVAL
// ============================================================

app.post("/agents/register", async (req, res) => {
  try {
    if (AGENT_TOKEN_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message:
          "Agent authentication is not configured. Please try again later."
      });
    }

    const fullName = String(
      req.body?.fullName || ""
    ).trim();

    const businessName = String(
      req.body?.businessName || ""
    ).trim();

    const email = String(
      req.body?.email || ""
    ).trim().toLowerCase();

    const phone = normalizePhone(req.body?.phone);

    const password = String(
      req.body?.password || ""
    );

    const storeDescription = String(
      req.body?.storeDescription || ""
    ).trim();

    if (
      fullName.length < 2 ||
      fullName.length > 100 ||
      businessName.length < 2 ||
      businessName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 255 ||
      !validGhanaPhone(phone) ||
      password.length < 12 ||
      password.length > 128 ||
      storeDescription.length > 200
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter valid details. Your password must contain at least 12 characters, and your phone number must be valid."
      });
    }

        const hash = await hashAgentPassword(password);

    const code =
      "K636-" +
      crypto.randomBytes(6).toString("hex").toUpperCase();

    const baseSlug =
      createStoreSlug(businessName) || `agent_${Date.now()}`;

    let storeSlug = baseSlug;
    let suffix = 2;

    while (true) {
      const existingSlug = await pool.query(
        `
          SELECT id
          FROM agents
          WHERE store_slug = $1
          LIMIT 1
        `,
        [storeSlug]
      );

      if (!existingSlug.rowCount) {
        break;
      }

      storeSlug = `${baseSlug}_${suffix}`;
      suffix++;
    }

    const result = await pool.query(
      `
        INSERT INTO agents (
          agent_code,
          full_name,
          business_name,
          store_slug,
          email,
          phone,
          password_hash,
          store_description,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved')
        RETURNING
          id,
          agent_code,
          full_name,
          business_name,
          store_slug,
          email,
          phone,
          status,
          created_at
      `,
      [
        code,
        fullName,
        businessName,
        storeSlug,
        email,
        phone,
        hash,
        storeDescription
      ]
    );

        const registeredAgent = result.rows[0];

    return res.status(201).json({
      success: true,
      message:
        "Registration successful! Your account is ready. You can log in now.",

      agent: {
        id: registeredAgent.id,
        agentCode: registeredAgent.agent_code,
        fullName: registeredAgent.full_name,
        businessName: registeredAgent.business_name,
        storeSlug: registeredAgent.store_slug,
        email: registeredAgent.email,
        phone: registeredAgent.phone,
        status: registeredAgent.status,
        createdAt: registeredAgent.created_at
      }
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message:
          "This email address or phone number is already registered."
      });
    }

    console.error(
      "Agent registration:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again."
    });
  }
});

// ============================================================
// 9. AGENT LOGIN
// ============================================================

app.post("/agents/login", async (req, res) => {
  try {
    if (AGENT_TOKEN_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message: "Agent authentication is not configured."
      });
    }

    const email = String(
      req.body?.email || ""
    ).trim().toLowerCase();

    const password = String(
      req.body?.password || ""
    );

    const result = await pool.query(
      "SELECT * FROM agents WHERE email = $1",
      [email]
    );

    if (
      !result.rowCount ||
      !(await verifyAgentPassword(
        password,
        result.rows[0].password_hash
      ))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const agent = result.rows[0];

    if (agent.status !== "approved") {
      return res.status(403).json({
        success: false,
        status: agent.status,
        message:
          agent.status === "pending"
            ? "Waiting for owner approval."
            : "Account cannot log in. Contact the owner."
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    agentSessions.set(token, {
      agentId: String(agent.id),
      expiresAt: Date.now() + 4 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      token,
      expiresIn: 14400,

            agent: {
        id: agent.id,
        agentCode: agent.agent_code,
        fullName: agent.full_name,
        businessName: agent.business_name,
        storeSlug: agent.store_slug || "",
        email: agent.email,
        phone: agent.phone,
        status: agent.status
            }
    });
  } catch (error) {
    console.error("Agent login:", error.message);

    res.status(500).json({
      success: false,
      message: "Login failed."
    });
  }
});

app.post("/agents/logout", requireAgent, (req, res) => {
  const token = req.headers.authorization.slice(7);

  agentSessions.delete(token);

  res.json({ success: true });
});

app.get(
  "/agents/me",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            id,
            agent_code,
            full_name,
            business_name,
            email,
            phone,
            status,
            store_description,
            created_at
          FROM agents
          WHERE id = $1
        `,
        [req.agentId]
      );

      res.json({
        success: true,
        agent: result.rows[0]
      });
    } catch (error) {
      console.error("Agent profile:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load agent profile."
      });
    }
  }
);
// ============================================================
// AGENT PROFILE: LOAD, UPDATE AND CHANGE PASSWORD
// ============================================================

// Load the logged-in agent's profile
app.get(
  "/agents/profile",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            id,
            agent_code,
            full_name,
            business_name,
            email,
            phone,
            store_slug,
            store_description,
            whatsapp_number,
            whatsapp_channel,
            social_link
          FROM agents
          WHERE id = $1
        `,
        [req.agentId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent profile not found."
        });
      }

      const a = result.rows[0];

      return res.json({
        success: true,
        profile: {
          fullName: a.full_name,
          businessName: a.business_name,
          email: a.email,
          phone: a.phone,
          storeSlug: a.store_slug,
          description: a.store_description,
          whatsappNumber: a.whatsapp_number,
          whatsappChannel: a.whatsapp_channel,
          socialLink: a.social_link,
          agentCode: a.agent_code
        }
      });
    } catch (error) {
      console.error("Load agent profile:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not load your profile."
      });
    }
  }
);


// Save changes to the logged-in agent's profile
app.put(
  "/agents/profile",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const fullName = String(
        req.body?.fullName || ""
      ).trim();

      const businessName = String(
        req.body?.businessName || ""
      ).trim();

      const email = String(
        req.body?.email || ""
      ).trim().toLowerCase();

      const phone = normalizePhone(req.body?.phone);

      const whatsappNumber = String(
        req.body?.whatsappNumber || ""
      ).trim();

      const whatsappChannel = String(
        req.body?.whatsappChannel || ""
      ).trim();

      const socialLink = String(
        req.body?.socialLink || ""
      ).trim();

      const description = String(
        req.body?.description || ""
      ).trim();

      if (
        fullName.length < 2 ||
        fullName.length > 100 ||
        businessName.length < 2 ||
        businessName.length > 100 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 255 ||
        !validGhanaPhone(phone) ||
        whatsappNumber.length > 25 ||
        whatsappChannel.length > 500 ||
        socialLink.length > 500 ||
        description.length > 200
      ) {
        return res.status(400).json({
          success: false,
          message: "Please check your details and try again."
        });
      }

      if (
        whatsappChannel &&
        !/^https?:\/\/\S+$/i.test(whatsappChannel)
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid WhatsApp Channel URL."
        });
      }

      if (
        socialLink &&
        !/^https?:\/\/\S+$/i.test(socialLink)
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid social media URL."
        });
      }

      const result = await pool.query(
        `
          UPDATE agents
          SET
            full_name = $1,
            business_name = $2,
            email = $3,
            phone = $4,
            whatsapp_number = $5,
            whatsapp_channel = $6,
            social_link = $7,
            store_description = $8,
            updated_at = NOW()
          WHERE id = $9
          RETURNING
            id,
            agent_code,
            full_name,
            business_name,
            email,
            phone,
            store_slug,
            store_description,
            whatsapp_number,
            whatsapp_channel,
            social_link
        `,
        [
          fullName,
          businessName,
          email,
          phone,
          whatsappNumber,
          whatsappChannel,
          socialLink,
          description,
          req.agentId
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent account not found."
        });
      }

      const a = result.rows[0];

      return res.json({
        success: true,
        message: "Your profile has been updated successfully.",
        profile: {
          fullName: a.full_name,
          businessName: a.business_name,
          email: a.email,
          phone: a.phone,
          storeSlug: a.store_slug,
          description: a.store_description,
          whatsappNumber: a.whatsapp_number,
          whatsappChannel: a.whatsapp_channel,
          socialLink: a.social_link,
          agentCode: a.agent_code
        }
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          message:
            "That email address or phone number is already registered to another account."
        });
      }

      console.error("Update agent profile:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not save your profile."
      });
    }
  }
);


// Change the logged-in agent's password
app.post(
  "/agents/change-password",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const currentPassword = String(
        req.body?.currentPassword || ""
      );

      const newPassword = String(
        req.body?.newPassword || ""
      );

      if (
        currentPassword.length === 0 ||
        newPassword.length < 12 ||
        newPassword.length > 128
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter your current password and a new password of at least 12 characters."
        });
      }

      const result = await pool.query(
        `
          SELECT id, password_hash
          FROM agents
          WHERE id = $1
        `,
        [req.agentId]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent account not found."
        });
      }

      const agent = result.rows[0];

      const matches = await verifyAgentPassword(
        currentPassword,
        agent.password_hash
      );

      if (!matches) {
        return res.status(400).json({
          success: false,
          message: "Your current password is incorrect."
        });
      }

      if (
        await verifyAgentPassword(
          newPassword,
          agent.password_hash
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Your new password must be different from your current password."
        });
      }

      const newHash = await hashAgentPassword(newPassword);

      await pool.query(
        `
          UPDATE agents
          SET password_hash = $1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [newHash, req.agentId]
      );

      // Invalidate existing sessions after a password change.
      for (const [token, session] of agentSessions) {
        if (String(session.agentId) === String(req.agentId)) {
          agentSessions.delete(token);
        }
      }

      return res.json({
        success: true,
        message:
          "Password changed successfully. Please log in again with your new password."
      });
    } catch (error) {
      console.error("Change agent password:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not change your password."
      });
    }
  }
);

// ============================================================
// ============================================================
// 10. PUBLIC AGENT STOREFRONT
// ============================================================

app.get("/agents/store/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "")
      .trim()
      .toUpperCase();

    const result = await pool.query(
      `
        SELECT
          id,
          agent_code,
          business_name,
          store_description,
          phone,
          status
        FROM agents
        WHERE agent_code = $1
      `,
      [code]
    );

    if (
      !result.rowCount ||
      result.rows[0].status !== "approved"
    ) {
      return res.status(404).json({
        success: false,
        message: "Store not found or not active."
      });
    }

    const agent = result.rows[0];

    const prices = await pool.query(
      `
        SELECT network, bundle, selling_price
        FROM agent_prices
        WHERE agent_id = $1
        ORDER BY network, bundle
      `,
      [agent.id]
    );

    res.json({
      success: true,

      store: {
        agentCode: agent.agent_code,
        businessName: agent.business_name,
        description: agent.store_description,
        phone: agent.phone,
        whatsapp: "https://wa.me/233" +
          agent.phone.replace(/^0/, "").replace(/\D/g, "")
      },

      prices: prices.rows.map(item => ({
        network: item.network,
        bundle: item.bundle,
        sellingPrice: Number(item.selling_price)
      }))
    });
  } catch (error) {
    console.error("Agent store:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not load agent store."
    });
  }
});
app.get("/agents/store-by-slug/:slug", async (req, res) => {
try {
const slug = String(req.params.slug || "")
.trim()
.toLowerCase();

if (!/^[a-z0-9_]{1,100}$/.test(slug)) {
  return res.status(400).json({
    success: false,
    message: "Invalid store link."
  });
}

const result = await pool.query(
  `
    SELECT
      id,
      agent_code,
      business_name,
      store_slug,
      store_description,
      phone,
      status
    FROM agents
    WHERE store_slug = $1
      AND status = 'approved'
    LIMIT 1
  `,
  [slug]
);

if (!result.rowCount) {
  return res.status(404).json({
    success: false,
    message: "Store not found or not active."
  });
}

const agent = result.rows[0];

const prices = await pool.query(
  `
    SELECT network, bundle, selling_price
    FROM agent_prices
    WHERE agent_id = $1
    ORDER BY network, bundle
  `,
  [agent.id]
);

return res.json({
  success: true,
  store: {
    agentCode: agent.agent_code,
    businessName: agent.business_name,
    storeSlug: agent.store_slug,
    description: agent.store_description,
    phone: agent.phone,
    whatsapp:
      "https://wa.me/233" +
      agent.phone.replace(/^0/, "").replace(/\D/g, "")
  },
  prices: prices.rows.map(item => ({
    network: item.network,
    bundle: item.bundle,
    sellingPrice: Number(item.selling_price)
  }))
});

} catch (error) {
console.error("Agent store lookup by slug:", error.message);

return res.status(500).json({
  success: false,
  message: "Could not load agent store."
});

}
});

// ============================================================
// 11. AGENT PRICES
// ============================================================

app.get(
  "/agents/prices",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT network, bundle, selling_price
          FROM agent_prices
          WHERE agent_id = $1
          ORDER BY network, bundle
        `,
        [req.agentId]
      );

      res.json({
        success: true,
        basePrices: AGENT_BASE_PRICES,

        prices: result.rows.map(item => ({
          network: item.network,
          bundle: item.bundle,
          sellingPrice: Number(item.selling_price)
        }))
      });
    } catch (error) {
      console.error("Agent prices:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load prices."
      });
    }
  }
);

app.put(
  "/agents/prices",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    const items = req.body?.prices;

    if (
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide 1 to 100 prices."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const item of items) {
        const network = normalizeNetwork(item.network);
        const bundle = normalizeBundle(item.bundle);
        const sellingPrice = Number(item.sellingPrice);

        if (
          !network ||
          AGENT_BASE_PRICES[network]?.[bundle] === undefined ||
          !Number.isFinite(sellingPrice) ||
          sellingPrice < 0 ||
          Math.round(sellingPrice * 100) !== sellingPrice * 100
        ) {
          throw new Error(
            `Invalid price for ${item.network} ${item.bundle}.`
          );
        }

        await client.query(
          `
            INSERT INTO agent_prices (
              agent_id,
              network,
              bundle,
              selling_price
            )
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (agent_id,network,bundle)
            DO UPDATE SET
              selling_price = EXCLUDED.selling_price,
              updated_at = NOW()
          `,
          [
            req.agentId,
            network,
            bundle,
            sellingPrice
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message:
          "Selling prices saved. Prices below your base cost can cause a loss."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res.status(400).json({
        success: false,
        message: error.message
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// 12. AGENT STATISTICS AND ORDERS
// ============================================================

// ============================================================
// ============================================================
// AGENT STATISTICS AND PROFIT
// ============================================================

      app.get(
  "/agents/stats",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        WITH earnings AS (
          SELECT
            COUNT(*) AS total_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
            ) AS paid_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(delivery_status, '')))
                IN ('delivered', 'completed', 'success', 'successful')
            ) AS delivered_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(delivery_status, ''))) = 'processing'
            ) AS processing_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(delivery_status, '')))
                IN ('failed', 'rejected', 'cancelled', 'canceled')
            ) AS failed_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                AND LOWER(TRIM(COALESCE(delivery_status, '')))
                  IN ('processing', 'delivered', 'completed', 'success', 'successful')
                AND supplier_reference IS NOT NULL
            ) AS accepted_orders,

            COUNT(*) FILTER (
              WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                AND LOWER(TRIM(COALESCE(delivery_status, ''))) = 'processing'
                AND supplier_reference IS NOT NULL
            ) AS pending_delivery_orders,

            COUNT(DISTINCT phone) AS customers,

            COALESCE(
              SUM(amount) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
              ), 0
            ) AS total_sales,

            COALESCE(
              SUM(amount - agent_base_price) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                  AND agent_base_price IS NOT NULL
                  AND supplier_reference IS NOT NULL
                  AND LOWER(TRIM(COALESCE(delivery_status, '')))
                    IN ('processing', 'delivered', 'completed', 'success', 'successful')
              ), 0
            ) AS estimated_profit,

            COALESCE(
              SUM(amount - agent_base_price) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                  AND agent_base_price IS NOT NULL
                  AND supplier_reference IS NOT NULL
                  AND LOWER(TRIM(COALESCE(delivery_status, '')))
                    IN ('processing', 'delivered', 'completed', 'success', 'successful')
                  AND created_at < (
                    date_trunc(
                      'day',
                      NOW() AT TIME ZONE 'Africa/Accra'
                    ) AT TIME ZONE 'Africa/Accra'
                  )
              ), 0
            ) AS previous_profit,

            COALESCE(
              SUM(amount - agent_base_price) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                  AND agent_base_price IS NOT NULL
                  AND supplier_reference IS NOT NULL
                  AND LOWER(TRIM(COALESCE(delivery_status, '')))
                    IN ('processing', 'delivered', 'completed', 'success', 'successful')
                  AND created_at >= (
                    date_trunc(
                      'day',
                      NOW() AT TIME ZONE 'Africa/Accra'
                    ) AT TIME ZONE 'Africa/Accra'
                  )
              ), 0
            ) AS today_profit,

            COALESCE(
              SUM(amount - agent_base_price) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                  AND agent_base_price IS NOT NULL
                  AND supplier_reference IS NOT NULL
                  AND LOWER(TRIM(COALESCE(delivery_status, ''))) = 'processing'
              ), 0
            ) AS pending_delivery_profit

          FROM orders
          WHERE agent_id = $1
        ),

        reserved AS (
          SELECT
            COALESCE(
              SUM(amount) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, '')))
                  IN ('pending', 'approved', 'paid')
              ), 0
            ) AS reserved_amount,

            COALESCE(
              SUM(amount) FILTER (
                WHERE LOWER(TRIM(COALESCE(status, '')))
                  IN ('pending', 'approved')
              ), 0
            ) AS pending_amount

          FROM agent_withdrawals
          WHERE agent_id = $1
        )

        SELECT
          earnings.*,
          reserved.reserved_amount,
          reserved.pending_amount,

          GREATEST(
            earnings.previous_profit - reserved.reserved_amount,
            0
          ) AS available_balance

        FROM earnings
        CROSS JOIN reserved
        `,
        [req.agentId]
      );

      const row = result.rows[0];

      const estimatedProfit = Number(row.estimated_profit);
      const previousProfit = Number(row.previous_profit);
      const todayProfit = Number(row.today_profit);

      res.json({
        success: true,
        stats: {
          totalOrders: Number(row.total_orders),
          paidOrders: Number(row.paid_orders),
          deliveredOrders: Number(row.delivered_orders),
          processingOrders: Number(row.processing_orders),
          failedOrders: Number(row.failed_orders),
          acceptedOrders: Number(row.accepted_orders),
          pendingDeliveryOrders: Number(row.pending_delivery_orders),
          totalSales: Number(row.total_sales),

          customers: Number(row.customers),

          estimatedProfit,
          estimatedMargin: estimatedProfit,

          confirmedProfit: estimatedProfit,
          todayProfit,
          pendingDeliveryProfit: Number(row.pending_delivery_profit),

          availableBalance: Number(row.available_balance),
          pendingWithdrawals: Number(row.pending_amount),

          currency: "GHS",
          timezone: "Africa/Accra"
        }
      });
    } catch (error) {
      console.error("Agent stats error:", error);

      res.status(500).json({
        success: false,
        message: "Could not calculate agent profits."
      });
    }
  }
);
// ============================================================
// AGENT: VIEW OWN ORDERS
// ============================================================

app.get(
  "/agents/orders",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            reference,
            phone,
            network,
            bundle,
            amount,
            status,
            delivery_status,
            created_at,
            updated_at
          FROM orders
          WHERE agent_id = $1
          ORDER BY created_at DESC
          LIMIT 100
        `,
        [req.agentId]
      );

      return res.status(200).json({
        success: true,
        orders: result.rows.map(order => ({
          ...order,
          amount: Number(order.amount)
        }))
      });
    } catch (error) {
      console.error("Agent orders error:", {
        message: error.message,
        code: error.code,
        detail: error.detail
      });

      return res.status(500).json({
        success: false,
        message: "Could not load your orders.",
        errorCode: error.code || "UNKNOWN"
      });
    }
  }
);

// Submit a withdrawal request.
app.post(
  "/agents/withdrawals",
  requireAgent,
  requireApprovedAgent,
  requireWithdrawalsEnabled,
  async (req, res) => {
    const amount = Number(req.body?.amount);
    const phone = normalizePhone(req.body?.phone);
    const provider = String(req.body?.provider || "")
      .trim()
      .toUpperCase();

    if (
  !Number.isFinite(amount) ||
  Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
  amount < 0.10 ||
  amount <= 0
) {
  return res.status(400).json({
    success: false,
    message:
      "Enter a valid withdrawal amount of at least GH₵0.10."
  });
    }
    if (!validGhanaPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Ghana Mobile Money number."
      });
    }

    if (!["MTN", "TELECEL", "AIRTELTIGO"].includes(provider)) {
      return res.status(400).json({
        success: false,
        message:
          "Select MTN MoMo, Telecel Cash, or AirtelTigo Money."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Lock the agent row so simultaneous requests cannot
      // withdraw the same balance twice.
      const agentResult = await client.query(
        `
          SELECT id
          FROM agents
          WHERE id = $1
            AND status = 'approved'
          FOR UPDATE
        `,
        [req.agentId]
      );

      if (!agentResult.rowCount) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          success: false,
          message: "Your agent account is not approved."
        });
      }

      const balanceResult = await client.query(
        `
          WITH time_boundary AS (
  SELECT
    date_trunc(
      'day',
      NOW() AT TIME ZONE 'Africa/Accra'
    ) AT TIME ZONE 'Africa/Accra' AS today_start
),

earnings AS (
  SELECT
    COALESCE(
      SUM(o.amount - o.agent_base_price) FILTER (
        WHERE o.created_at < t.today_start
      ),
      0
    ) AS previous_earnings,

    COALESCE(
      SUM(o.amount - o.agent_base_price) FILTER (
        WHERE o.created_at >= t.today_start
      ),
      0
    ) AS todays_earnings

  FROM orders o
  CROSS JOIN time_boundary t

  WHERE o.agent_id = $1
    AND LOWER(TRIM(COALESCE(o.status, ''))) = 'paid'
    AND o.agent_base_price IS NOT NULL
    AND o.supplier_reference IS NOT NULL
    AND LOWER(TRIM(COALESCE(o.delivery_status, '')))
      IN ('processing', 'delivered', 'completed', 'success', 'successful')
),

withdrawals AS (
  SELECT
    COALESCE(
      SUM(amount) FILTER (
        WHERE LOWER(TRIM(COALESCE(status, '')))
          IN ('pending', 'approved', 'paid')
      ),
      0
    ) AS reserved_amount

  FROM agent_withdrawals
  WHERE agent_id = $1
)

SELECT
  earnings.previous_earnings,
  earnings.todays_earnings,
  withdrawals.reserved_amount
FROM earnings
CROSS JOIN withdrawals
        `,
        [req.agentId]
      );
      const balance = balanceResult.rows[0];

const previousEarnings = Number(
  balance.previous_earnings || 0
);

const reservedAmount = Number(
  balance.reserved_amount || 0
);

const availableBalance = Math.max(
  0,
  previousEarnings - reservedAmount
);

      if (amount > availableBalance + 0.000001) {
        return res.status(400).json({
          success: false,
          message:
            `Insufficient available balance. Your available balance is GH₵${availableBalance.toFixed(2)}.`
        });
      }

      const withdrawalResult = await client.query(
        `
          INSERT INTO agent_withdrawals (
            agent_id,
            amount,
            phone,
            provider,
            status
          )
          VALUES ($1, $2, $3, $4, 'pending')
          RETURNING
            id,
            amount,
            phone,
            provider,
            status,
            created_at
        `,
        [req.agentId, amount, phone, provider]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        message:
          "Withdrawal request submitted successfully. It is pending owner review; money has not yet been sent.",
        withdrawal: withdrawalResult.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      console.error("Withdrawal request:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not submit your withdrawal request."
      });
    } finally {
      client.release();
    }
  }
);

// View the logged-in agent's withdrawal history.
app.get(
  "/agents/withdrawals/history",
  requireAgent,
  requireApprovedAgent,
  requireWithdrawalsEnabled,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            id,
            amount,
            phone,
            provider,
            status,
            created_at,
            updated_at
          FROM agent_withdrawals
          WHERE agent_id = $1
          ORDER BY created_at DESC
          LIMIT 100
        `,
        [req.agentId]
      );

      res.json({
        success: true,
        withdrawals: result.rows.map(item => ({
          ...item,
          amount: Number(item.amount)
        }))
      });
    } catch (error) {
      console.error("Withdrawal history:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load withdrawal history."
      });
    }
  }
);

// ============================================================
// 13. OWNER LOGIN AND MANAGEMENT
// ============================================================

app.post("/owner/login", (req, res) => {
  if (!OWNER_SECRET) {
    return res.status(503).json({
      success: false,
      message: "Owner login is not configured."
    });
  }

  if (!safeEqualText(req.body?.password, OWNER_SECRET)) {
    return res.status(401).json({
      success: false,
      message: "Invalid owner password."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  ownerSessions.set(token, {
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    token,
    expiresIn: 28800
  });
});

app.post("/owner/logout", requireOwner, (req, res) => {
  const token = req.headers.authorization.slice(7);

  ownerSessions.delete(token);

  res.json({ success: true });
});

app.get("/owner/agents", requireOwner, async (_req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          a.id,
          a.agent_code,
          a.full_name,
          a.business_name,
          a.email,
          a.phone,
          a.status,
          a.created_at,
          COUNT(o.id)::int AS total_orders,

          COALESCE(
            SUM(o.amount) FILTER (WHERE o.status = 'paid'),
            0
          )::numeric(12,2) AS paid_sales

        FROM agents a

        LEFT JOIN orders o
          ON o.agent_id = a.id

        GROUP BY a.id

        ORDER BY a.created_at DESC
      `
    );

    res.json({
      success: true,
      agents: result.rows
    });
  } catch (error) {
    console.error("Owner agents:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not load agents."
    });
  }
});

app.patch(
  "/owner/agents/:id/status",
  requireOwner,
  async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "");

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !["approved", "rejected", "suspended"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid agent ID or status."
      });
    }

    try {
      const result = await pool.query(
        `
          UPDATE agents
          SET status = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, agent_code, full_name, status
        `,
        [status, id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent not found."
        });
      }

      for (const [token, session] of agentSessions) {
        if (String(session.agentId) === String(id)) {
          agentSessions.delete(token);
        }
      }

      res.json({
        success: true,
        agent: result.rows[0]
      });
    } catch (error) {
      console.error("Agent status:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not update agent."
      });
    }
  }
);

app.get(
  "/owner/withdrawals",
  requireOwner,
  async (_req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
  w.*,
  a.agent_code,
  a.full_name,
  a.business_name
FROM agent_withdrawals w
JOIN agents a ON a.id = w.agent_id
ORDER BY w.created_at DESC
LIMIT 200
        `
      );

      res.json({
        success: true,
        withdrawals: result.rows
      });
    } catch (error) {
      console.error("Owner withdrawals:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load withdrawals."
      });
    }
  }
);

// ============================================================
// OWNER: UPDATE WITHDRAWAL STATUS
// ============================================================

app.patch(
  "/owner/withdrawals/:id/status",
  requireOwner,
  async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "")
      .trim()
      .toLowerCase();

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal ID."
      });
    }

    if (!["paid", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be paid or rejected."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT id, amount, status
          FROM agent_withdrawals
          WHERE id = $1
          FOR UPDATE
        `,
        [id]
      );

      if (!result.rowCount) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "Withdrawal request not found."
        });
      }

      const withdrawal = result.rows[0];

      if (withdrawal.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "Only pending requests can be marked paid or rejected."
        });
      }

      const updated = await client.query(
        `
          UPDATE agent_withdrawals
          SET status = $1,
              updated_at = NOW()
          WHERE id = $2
          RETURNING id, amount, status, updated_at
        `,
        [status, id]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        message:
          status === "paid"
            ? "Withdrawal marked as paid. Ensure the Mobile Money transfer has actually succeeded."
            : "Withdrawal rejected. The reserved amount is now available again.",
        withdrawal: {
          ...updated.rows[0],
          amount: Number(updated.rows[0].amount)
        }
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      console.error(
        "Owner update withdrawal:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message: "Could not update withdrawal status."
      });
    } finally {
      client.release();
    }
  }
);


// ============================================================
// NEW OWNER DASHBOARD ROUTES
// ============================================================

// 1. GET /owner/stats

// 2. GET /owner/orders

// 3. GET /owner/agents/:id/details

// ============================================================
// NEW OWNER DASHBOARD ROUTES
// Place immediately before Section 14
// ============================================================


// ======================================================
// OWNER DASHBOARD: BUSINESS STATISTICS
// ======================================================

app.get("/owner/stats", requireOwner, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS "totalOrders",

        COALESCE(
          SUM(amount) FILTER (
            WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
          ),
          0
        ) AS "totalSales",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
        )::int AS "paidOrders",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(delivery_status, '')))
            IN ('delivered', 'completed', 'success', 'successful')
        )::int AS "successfulDeliveries",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
            AND LOWER(TRIM(COALESCE(delivery_status, '')))
              IN ('not_started', 'pending', 'processing', '')
        )::int AS "pendingOrders",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(delivery_status, '')))
            IN ('failed', 'rejected', 'cancelled', 'canceled')
        )::int AS "failedOrders",

        COALESCE(
          SUM(amount) FILTER (
            WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
              AND created_at >=
                (date_trunc('day', NOW() AT TIME ZONE 'Africa/Accra')
                  AT TIME ZONE 'Africa/Accra')
          ),
          0
        ) AS "todaySales",

        COUNT(*) FILTER (
          WHERE created_at >=
            (date_trunc('day', NOW() AT TIME ZONE 'Africa/Accra')
              AT TIME ZONE 'Africa/Accra')
        )::int AS "todayOrders",

        COALESCE(
          SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                AND agent_id IS NOT NULL
                AND agent_base_price IS NOT NULL
                AND supplier_reference IS NOT NULL
                AND LOWER(TRIM(COALESCE(delivery_status, '')))
                  IN (
                    'processing',
                    'delivered',
                    'completed',
                    'success',
                    'successful'
                  )
              THEN amount - agent_base_price
              ELSE 0
            END
          ),
          0
        ) AS "totalAgentProfit",

        COALESCE(
          SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(status, ''))) = 'paid'
                AND agent_id IS NOT NULL
                AND agent_base_price IS NOT NULL
                AND supplier_reference IS NOT NULL
                AND LOWER(TRIM(COALESCE(delivery_status, '')))
                  IN (
                    'processing',
                    'delivered',
                    'completed',
                    'success',
                    'successful'
                  )
                AND created_at >=
                  (date_trunc('day', NOW() AT TIME ZONE 'Africa/Accra')
                    AT TIME ZONE 'Africa/Accra')
              THEN amount - agent_base_price
              ELSE 0
            END
          ),
          0
        ) AS "todayAgentProfit"

      FROM orders
    `);

    const agentResult = await pool.query(`
      SELECT
        COUNT(*)::int AS "registeredAgents",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, ''))) = 'approved'
        )::int AS "activeAgents",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, '')))
            IN ('pending', 'awaiting_approval')
        )::int AS "pendingAgents",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, '')))
            IN ('suspended', 'disabled')
        )::int AS "suspendedAgents",

        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, ''))) = 'rejected'
        )::int AS "rejectedAgents"

      FROM agents
    `);

    const withdrawalResult = await pool.query(`
      SELECT
        COUNT(*)::int AS "pendingWithdrawals",
        COALESCE(SUM(amount), 0) AS "pendingWithdrawalAmount"
      FROM agent_withdrawals
      WHERE LOWER(TRIM(COALESCE(status, ''))) = 'pending'
    `);

    const stats = result.rows[0];
    const agents = agentResult.rows[0];
    const withdrawals = withdrawalResult.rows[0];

    res.json({
      success: true,

      ...stats,

      totalRevenue: stats.totalSales,

      agents,

      registeredAgents: agents.registeredAgents,
      activeAgents: agents.activeAgents,
      pendingAgents: agents.pendingAgents,
      suspendedAgents: agents.suspendedAgents,
      rejectedAgents: agents.rejectedAgents,

      pendingWithdrawals: withdrawals.pendingWithdrawals,
      pendingWithdrawalAmount: withdrawals.pendingWithdrawalAmount
    });

  } catch (error) {
    console.error("Owner stats error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load owner statistics."
    });
  }
});


// 2. OWNER ORDER LIST

app.get("/owner/orders", requireOwner, async (req, res) => {
  try {
    const status = String(req.query.status || "")
      .trim()
      .toLowerCase();

    const deliveryStatus = String(
      req.query.delivery_status || ""
    ).trim().toLowerCase();

    const search = String(req.query.search || "")
      .trim()
      .slice(0, 100);

    const limitValue = Number(req.query.limit || 100);

    const limit = Number.isInteger(limitValue)
      ? Math.max(1, Math.min(limitValue, 500))
      : 100;

    const result = await pool.query(`
      SELECT
        o.id,
        o.reference,
        o.phone,
        o.network,
        o.bundle,
        o.amount,
        o.status,
        o.delivery_status,
        o.supplier_reference,
        o.agent_id,
        o.agent_base_price,
        o.created_at,
        o.delivered_at,
        a.agent_code,
        a.business_name AS agent_business_name,

        CASE
  WHEN LOWER(TRIM(COALESCE(o.status, ''))) = 'paid'
    AND LOWER(TRIM(COALESCE(o.delivery_status, '')))
      IN ('processing', 'delivered', 'completed', 'success', 'successful')
    AND o.agent_base_price IS NOT NULL
    AND o.supplier_reference IS NOT NULL
  THEN GREATEST(o.amount - o.agent_base_price, 0)
  ELSE 0
END AS estimated_agent_margin

      FROM orders o

      LEFT JOIN agents a
        ON a.id = o.agent_id

      WHERE
        ($1 = '' OR LOWER(o.status) = $1)
        AND
        ($2 = '' OR LOWER(o.delivery_status) = $2)
        AND
        (
          $3 = ''
          OR o.reference ILIKE '%' || $3 || '%'
          OR o.phone ILIKE '%' || $3 || '%'
          OR COALESCE(a.business_name, '') ILIKE '%' || $3 || '%'
          OR COALESCE(a.agent_code, '') ILIKE '%' || $3 || '%'
        )

      ORDER BY o.created_at DESC
      LIMIT $4
    `, [status, deliveryStatus, search, limit]);

    res.json({
      success: true,

      orders: result.rows.map(order => ({
        ...order,
        amount: Number(order.amount),
        agent_base_price:
          order.agent_base_price === null
            ? null
            : Number(order.agent_base_price),
        estimated_agent_margin:
          Number(order.estimated_agent_margin)
      }))
    });

  } catch (error) {
    console.error("Owner order list:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not load customer orders."
    });
  }
});


// 3. DETAILS FOR ONE AGENT

app.get(
  "/owner/agents/:id/details",
  requireOwner,
  async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid agent ID."
      });
    }

    try {
      const agentResult = await pool.query(`
        SELECT
          id,
          agent_code,
          full_name,
          business_name,
          email,
          phone,
          status,
          store_description,
          created_at
        FROM agents
        WHERE id = $1
      `, [id]);

      if (!agentResult.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent not found."
        });
      }

      const statsResult = await pool.query(`
        SELECT
          COUNT(*)::int AS total_orders,

          COUNT(*) FILTER (
            WHERE LOWER(status) = 'paid'
          )::int AS paid_orders,

          COUNT(*) FILTER (
            WHERE LOWER(delivery_status) = 'delivered'
          )::int AS delivered_orders,

          COALESCE(
            SUM(amount) FILTER (
              WHERE LOWER(status) = 'paid'
            ), 0
          )::numeric(12,2) AS total_sales,

          COALESCE(
            SUM(GREATEST(amount - agent_base_price, 0))
              FILTER (
                WHERE LOWER(status) = 'paid'
                  AND LOWER(delivery_status) = 'delivered'
                  AND agent_base_price IS NOT NULL
              ), 0
          )::numeric(12,2) AS estimated_profit

        FROM orders
        WHERE agent_id = $1
      `, [id]);

      const ordersResult = await pool.query(`
        SELECT
          reference,
          phone,
          network,
          bundle,
          amount,
          agent_base_price,
          status,
          delivery_status,
          created_at,
          delivered_at
        FROM orders
        WHERE agent_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `, [id]);

      const withdrawalsResult = await pool.query(`
        SELECT
          id,
          amount,
          phone,
          provider,
          status,
          created_at,
          updated_at
        FROM agent_withdrawals
        WHERE agent_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `, [id]);

      const stats = statsResult.rows[0];

      res.json({
        success: true,

        agent: agentResult.rows[0],

        stats: {
          totalOrders: Number(stats.total_orders),
          paidOrders: Number(stats.paid_orders),
          deliveredOrders: Number(stats.delivered_orders),
          totalSales: Number(stats.total_sales),
          totalProfit: Number(stats.estimated_profit),
          estimatedProfit: Number(stats.estimated_profit)
        },

        orders: ordersResult.rows.map(order => ({
          ...order,
          amount: Number(order.amount),
          agent_base_price:
            order.agent_base_price === null
              ? null
              : Number(order.agent_base_price)
        })),

        withdrawals: withdrawalsResult.rows.map(item => ({
          ...item,
          amount: Number(item.amount)
        }))
      });

    } catch (error) {
      console.error("Owner agent details:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load agent details."
      });
    }
  }
);


// ============================================================
// END NEW OWNER DASHBOARD ROUTES
// ============================================================
// ============================================================
// OWNER: SAFELY RETRY A FAILED, ALREADY-PAID ORDER
// ============================================================

app.post(
  "/owner/orders/:reference/retry-delivery",
  requireOwner,
  async (req, res) => {
    const reference = String(
      req.params.reference || ""
    ).trim();

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid order reference."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
          SELECT
            reference,
            phone,
            network,
            bundle,
            amount,
            status,
            delivery_status,
            supplier_reference,
            supplier_response
          FROM orders
          WHERE reference = $1
          FOR UPDATE
        `,
        [reference]
      );

      if (!result.rowCount) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "Order not found."
        });
      }

      const order = result.rows[0];

      if (order.status !== "paid") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "This order is not confirmed as paid. No retry was started."
        });
      }

      if (
        ["delivered", "completed", "success", "successful"]
          .includes(String(order.delivery_status).toLowerCase())
      ) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "This order is already marked delivered. No new purchase was started."
        });
      }

      if (order.supplier_reference) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "A DataMart supplier reference already exists. Check its status before attempting another purchase.",
          supplier_reference: order.supplier_reference
        });
      }

      const savedResponse =
        order.supplier_response &&
        typeof order.supplier_response === "object"
          ? order.supplier_response
          : {};

      const errorMessage = String(
        savedResponse.message || ""
      ).toLowerCase();

      // Only automatically retry a clearly recorded insufficient-
      // balance failure. Other errors may have an uncertain outcome.
      const looksLikeInsufficientBalance =
        /insufficient|low balance|insufficient balance|wallet balance/
          .test(errorMessage);

      if (!looksLikeInsufficientBalance) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "The saved failure does not clearly establish that DataMart rejected the purchase for insufficient balance. Check DataMart before retrying to avoid duplicate delivery."
        });
      }

      // Claim this failed order so concurrent owner requests cannot
      // start simultaneous purchases.
      const claim = await client.query(
        `
          UPDATE orders
          SET delivery_status = 'processing',
              updated_at = NOW()
          WHERE reference = $1
            AND status = 'paid'
            AND delivery_status = 'failed'
            AND supplier_reference IS NULL
          RETURNING
            reference,
            phone,
            network,
            bundle,
            amount
        `,
        [reference]
      );

      if (!claim.rowCount) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "The order has changed or another request has claimed it. Refresh the order status."
        });
      }

      await client.query("COMMIT");

      // The original order reference is retained, so the same
      // idempotency key is generated by purchaseDataFromSupplier.
      const purchase = await purchaseDataFromSupplier(
        claim.rows[0]
      );

      await pool.query(
        `
          UPDATE orders
          SET supplier_reference = $1,
              supplier_response = $2::jsonb,
              delivery_status = 'processing',
              updated_at = NOW()
          WHERE reference = $3
            AND status = 'paid'
        `,
        [
          purchase.supplierReference,
          JSON.stringify(purchase.raw),
          reference
        ]
      );

      return res.json({
        success: true,
        paid: true,
        reference,
        delivery_status: "processing",
        supplier_reference: purchase.supplierReference,
        message:
          "DataMart accepted the retry. Check the supplier order status for delivery confirmation."
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      console.error(
        "Owner delivery retry:",
        reference,
        error.message
      );

      // Preserve the failure message without changing the payment
      // status or creating a new customer payment.
      await pool.query(
        `
          UPDATE orders
          SET delivery_status = 'failed',
              supplier_response = $1::jsonb,
              updated_at = NOW()
          WHERE reference = $2
            AND status = 'paid'
            AND delivery_status = 'processing'
            AND supplier_reference IS NULL
        `,
        [
          JSON.stringify({
            message: error.message
          }),
          reference
        ]
      ).catch(updateError => {
        console.error(
          "Could not save retry failure:",
          updateError.message
        );
      });

      return res.status(502).json({
        success: false,
        paid: true,
        reference,
        delivery_status: "failed",
        message:
          "The retry did not complete successfully. The customer must not pay again. Check DataMart before attempting another retry."
      });
    } finally {
      client.release();
    }
  }
);
// ======================================================
// OWNER DASHBOARD: TOP AGENTS RANKINGS
// ======================================================

app.get("/owner/agents/rankings", requireOwner, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.agent_code,
        a.full_name,
        a.business_name,
        a.status,

        COUNT(o.id)::int AS total_orders,

        COUNT(o.id) FILTER (
          WHERE LOWER(TRIM(COALESCE(o.status, ''))) = 'paid'
        )::int AS paid_orders,

        COALESCE(
          SUM(o.amount) FILTER (
            WHERE LOWER(TRIM(COALESCE(o.status, ''))) = 'paid'
          ),
          0
        ) AS paid_sales,

        COALESCE(
          SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(o.status, ''))) = 'paid'
               AND o.agent_base_price IS NOT NULL
               AND o.supplier_reference IS NOT NULL
               AND LOWER(TRIM(COALESCE(o.delivery_status, '')))
                   IN (
                     'processing',
                     'delivered',
                     'completed',
                     'success',
                     'successful'
                   )
              THEN o.amount - o.agent_base_price
              ELSE 0
            END
          ),
          0
        ) AS estimated_agent_margin

      FROM agents a

      LEFT JOIN orders o
        ON o.agent_id = a.id

      GROUP BY
        a.id,
        a.agent_code,
        a.full_name,
        a.business_name,
        a.status

      ORDER BY
        estimated_agent_margin DESC,
        paid_sales DESC,
        total_orders DESC

      LIMIT 20
    `);

    res.json({
      success: true,
      rankings: result.rows
    });

  } catch (error) {
    console.error("Owner agent rankings error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load agent rankings."
    });
  }
});
// ============================================================
// 14. BASIC API ROUTES
// ============================================================

app.get("/", (_req, res) => {
  res.json({
    service: "Kielmen 636 Dataplug API",
    status: "online",

    paymentsConfigured: Boolean(
      PAYSTACK_SECRET_KEY &&
      PAYSTACK_CUSTOMER_EMAIL
    ),

    supplierPurchasesEnabled: DATAMART_PURCHASES_ENABLED,

    note:
      "A successful payment is verified server-side. Supplier acceptance is not the same as SIM delivery."
  });
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      database: "connected"
    });
  } catch (_error) {
    res.status(503).json({
      success: false,
      database: "unavailable"
    });
  }
});

app.get("/prices", (_req, res) => {
  res.json({
    success: true,
    currency: "GHS",
    prices: PRICES
  });
});

// ============================================================
// 15. INITIALIZE PAYMENT
// ============================================================

app.post("/initialize-payment", async (req, res) => {
  try {
    if (!PAYSTACK_CUSTOMER_EMAIL) {
      return res.status(503).json({
        success: false,
        message:
          "Payments are not fully configured. Please contact support."
      });
    }

    const phone = normalizePhone(req.body?.phone);

const email = String(req.body?.email || "")
  .trim()
  .toLowerCase();

const network = normalizeNetwork(req.body?.network);
const bundle = normalizeBundle(req.body?.bundle);

if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  email.length > 255
) {
  return res.status(400).json({
    success: false,
    message: "Please enter a valid email address."
  });
}

    if (!validGhanaPhone(phone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Ghana phone number, for example 0241234567."
      });
    }

    if (
      !network ||
      !bundle ||
      !Object.prototype.hasOwnProperty.call(
        PRICES[network] || {},
        bundle
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Select a valid network and available data bundle."
      });
    }

    const agentCode = String(
      req.body?.agentCode ||
      req.body?.agent_code ||
      ""
    ).trim().toUpperCase();

    let agentId = null;
    let agentBasePrice = null;
    let amount = PRICES[network][bundle];

    // If checkout originates from an approved agent store,
    // use that agent's saved selling price.
    if (agentCode) {
      const agentResult = await pool.query(
        "SELECT id,status FROM agents WHERE agent_code = $1",
        [agentCode]
      );

      if (
        !agentResult.rowCount ||
        agentResult.rows[0].status !== "approved"
      ) {
        return res.status(404).json({
          success: false,
          message: "Agent store is not available."
        });
      }

      const priceResult = await pool.query(
        `
          SELECT selling_price
          FROM agent_prices
          WHERE agent_id = $1
            AND network = $2
            AND bundle = $3
        `,
        [
          agentResult.rows[0].id,
          network,
          bundle
        ]
      );

      if (!priceResult.rowCount) {
        return res.status(400).json({
          success: false,
          message:
            "This bundle is not available in this agent store."
        });
      }

      agentId = agentResult.rows[0].id;

      agentBasePrice =
        AGENT_BASE_PRICES[network]?.[bundle] ?? null;

      amount = Number(priceResult.rows[0].selling_price);
    }

    const reference =
      `K636-${Date.now()}-` +
      crypto.randomBytes(5).toString("hex");

    await pool.query(
      `
        INSERT INTO orders (
          reference,
          email,
          phone,
          network,
          bundle,
          amount,
          status,
          delivery_status,
          agent_id,
          agent_base_price
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          'pending',
          'not_started',
          $7,$8
        )
      `,
[
  reference,
  email,
  phone,
  network,
  bundle,
  amount,
  agentId,
  agentBasePrice
]
    );

    try {
      const payment = await paystackRequest(
        "/transaction/initialize",
        "POST",
        {
          email: email,
          amount: amountToPesewas(amount),
          currency: "GHS",
          reference,

          callback_url:
  `${FRONTEND_BASE_URL}/success.html?agentCode=${encodeURIComponent(agentCode)}`,

          metadata: {
            order_reference: reference,
            phone,
            network,
            bundle,
            agent_code: agentCode || null
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
        `
          UPDATE orders
          SET status = 'initialization_failed',
              updated_at = NOW()
          WHERE reference = $1
        `,
        [reference]
      );

      throw error;
    }
  } catch (error) {
    console.error("Initialize payment error:", error.message);

    res.status(500).json({
      success: false,
      message:
        "Could not start payment. Please try again or contact support."
    });
  }
});

// ============================================================
// VERIFY PAYMENT — ALSO USED BY THE SUCCESS PAGE
// ============================================================

app.post("/verify-payment", async (req, res) => {
  try {
    const reference = String(
      req.body?.reference || ""
    ).trim();

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        paid: false,
        message: "A valid payment reference is required."
      });
    }

    const result = await processSuccessfulPayment(reference);

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "Payment verification error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      paid: false,
      message:
        "Payment verification could not finish. Do not pay again; check your order status."
    });
  }
}); 

// ============================================================
// 17. ORDER STATUS
// ============================================================

app.get("/order-status/:reference", async (req, res) => {
  try {
    const reference = String(
      req.params.reference || ""
    ).trim();

    if (!reference || reference.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid order reference."
      });
    }

    const order = await getOrderByReference(reference);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    let supplier_status = null;
    let supplier_status_message = null;

    if (order.supplier_reference && DATAMART_API_KEY) {
      try {
        const path =
          `/api/developer/order-status/` +
          encodeURIComponent(order.supplier_reference);

        const supplierResult = await dataMartRequest(
          path,
          "GET"
        );

        supplier_status = supplierResult;
        console.log(
  "DATAMART STATUS RESPONSE:",
  JSON.stringify(supplierResult)
);

        const normalizedStatus = String(
  supplierResult.data?.orderStatus ||
  supplierResult.orderStatus ||
  supplierResult.data?.delivery_status ||
  supplierResult.delivery_status ||
  supplierResult.data?.status ||
  supplierResult.status ||
  ""
).trim().toLowerCase();

        if (
          [
            "delivered",
            "completed",
            "success",
            "successful"
          ].includes(normalizedStatus)
        ) {
          await pool.query(
            `
              UPDATE orders
              SET delivery_status = 'delivered',
    delivered_at = COALESCE(delivered_at, NOW()),
    supplier_response = $1::jsonb,
    updated_at = NOW()
              WHERE reference = $2
                AND status = 'paid'
            `,
            [
              JSON.stringify(supplierResult),
              reference
            ]
          );

          order.delivery_status = "delivered";
        } else if (
          [
            "failed",
            "rejected",
            "cancelled",
            "canceled"
          ].includes(normalizedStatus)
        ) {
          await pool.query(
            `
              UPDATE orders
              SET delivery_status = 'failed',
                  supplier_response = $1::jsonb,
                  updated_at = NOW()
              WHERE reference = $2
                AND status = 'paid'
            `,
            [
              JSON.stringify(supplierResult),
              reference
            ]
          );

          order.delivery_status = "failed";
        }
      } catch (supplierError) {
        supplier_status_message =
          "Could not refresh DataMart status; showing the last saved status.";

        console.error(
          "DataMart status check error:",
          supplierError.message
        );
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
      },

      ...(supplier_status
        ? { supplier_status }
        : {}),

      ...(supplier_status_message
        ? { supplier_status_message }
        : {})
    });
  } catch (error) {
    console.error("Order status error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not check order status right now."
    });
  }
});

// ============================================================
// ============================================================
// 18A. AGENT-SPECIFIC CUSTOMER ORDER TRACKING
// ============================================================

app.get(
  "/agents/store/:code/orders-by-phone/:phone",
  async (req, res) => {
    try {
      const code = String(req.params.code || "")
        .trim()
        .toUpperCase();

      const phone = normalizePhone(req.params.phone);

      if (!validGhanaPhone(phone)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Ghana phone number."
        });
      }

      const agentResult = await pool.query(
        `
          SELECT id
          FROM agents
          WHERE agent_code = $1
            AND status = 'approved'
        `,
        [code]
      );

      if (!agentResult.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Agent store not found or not active."
        });
      }

      const result = await pool.query(
        `
          SELECT
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
          WHERE agent_id = $1
            AND RIGHT(
              REGEXP_REPLACE(phone, '[^0-9]', '', 'g'),
              9
            ) = $2
          ORDER BY created_at DESC
          LIMIT 20
        `,
        [
          agentResult.rows[0].id,
          phone.slice(-9)
        ]
      );

      return res.json({
        success: true,
        orders: result.rows.map(order => ({
          ...order,
          amount: Number(order.amount)
        }))
      });
    } catch (error) {
      console.error(
        "Agent customer order lookup:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message: "Could not load orders. Please try again."
      });
    }
  }
);
// 18. LOOK UP ORDERS BY PHONE
// ============================================================

app.get("/orders-by-phone/:phone", async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);

    if (!validGhanaPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid phone number."
      });
    }

    const result = await pool.query(
      `
        SELECT
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
        WHERE RIGHT(
          REGEXP_REPLACE(phone, '[^0-9]', '', 'g'),
          9
        ) = $1
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [phone.slice(-9)]
    );

    res.json({
      success: true,

      orders: result.rows.map(order => ({
        ...order,
        amount: Number(order.amount)
      }))
    });
  } catch (error) {
    console.error("Order lookup:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not load orders."
    });
  }
});

// ============================================================
// 19. PAYSTACK WEBHOOK — AUTOMATIC PAYMENT PROCESSING
// ============================================================

app.post("/paystack-webhook", async (req, res) => {
  try {
    const signature = req.get("x-paystack-signature");

    if (!signature || !PAYSTACK_SECRET_KEY || !req.rawBody) {
      return res.sendStatus(401);
    }

    // Verify Paystack's HMAC-SHA512 signature.
    const expectedSignature = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(req.rawBody)
      .digest("hex");

    if (!safeEqualText(signature, expectedSignature)) {
      console.warn("Rejected invalid Paystack webhook signature.");
      return res.sendStatus(401);
    }

    const event = req.body;

    // Acknowledge unrelated events without processing them.
    if (event?.event !== "charge.success") {
      return res.sendStatus(200);
    }

    const reference = String(
      event?.data?.reference || ""
    ).trim();

    if (!reference || reference.length > 100) {
      return res.sendStatus(400);
    }

    // Respond promptly to Paystack. Processing continues
    // in the backend even if the customer has closed the page.
    res.sendStatus(200);

    // Verify payment against Paystack and trigger delivery.
    try {
      const result = await processSuccessfulPayment(reference);

      console.log(
        "Automatic Paystack processing:",
        reference,
        result.delivery_status,
        result.message
      );
    } catch (error) {
      console.error(
        "Paystack webhook processing failed:",
        reference,
        error.message
      );
    }
  } catch (error) {
    console.error(
      "Paystack webhook error:",
      error.message
    );

    if (!res.headersSent) {
      return res.sendStatus(400);
    }
  }
});

// ============================================================
// 20. ERROR HANDLER
// ============================================================

app.use((error, _req, res, _next) => {
  if (
    error &&
    error.message === "Origin not allowed by CORS"
  ) {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed."
    });
  }

  console.error(
    "Unhandled server error:",
    error && error.message
  );

  return res.status(500).json({
    success: false,
    message: "Unexpected server error."
  });
});

// ============================================================
// 21. START SERVER
// ============================================================

async function startServer() {
  if (!DATABASE_URL) {
    console.error(
      "Server cannot start without DATABASE_URL."
    );

    process.exit(1);
  }

  try {
    await createAgentTables();
await createOrdersTable();
    // ============================================
// KIELMEN 636 DATAPLUG - SMS CAMPAIGN API
// ============================================

app.get("/owner/sms/credits", requireOwner, async (req, res) => {
  try {
    if (!process.env.SAILUP_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "Sailup API key is not configured."
      });
    }

    const response = await fetch(
      "https://api.sailup.io/v1/sms/credits/",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.SAILUP_API_KEY}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: "Unable to retrieve Sailup credits.",
        details: data
      });
    }

    return res.json({
      success: true,
      balance: data.balance,
      autoTopup: data.auto_topup
    });

  } catch (error) {
    console.error("Sailup credits error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not connect to Sailup."
    });
  }
});


app.post("/owner/sms/send", requireOwner, async (req, res) => {
  try {
    const apiKey = process.env.SAILUP_API_KEY;
    const senderId = process.env.SAILUP_SENDER_ID;
    const senderApproved =
      process.env.SAILUP_SENDER_APPROVED === "true";

    if (!apiKey || !senderId) {
      return res.status(503).json({
        success: false,
        message: "Configure SAILUP_API_KEY and SAILUP_SENDER_ID in Render."
      });
    }

    if (!senderApproved) {
      return res.status(403).json({
        success: false,
        message:
          "SMS sending is disabled until your Sailup sender ID is approved. Confirm approval in Sailup, then set SAILUP_SENDER_APPROVED to true in Render."
      });
    }

    const message =
      typeof req.body.message === "string"
        ? req.body.message.trim()
        : "";

    const inputRecipients = req.body.recipients;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Enter an SMS message."
      });
    }

    if (!Array.isArray(inputRecipients)) {
      return res.status(400).json({
        success: false,
        message: "Recipients must be a list of phone numbers."
      });
    }

    if (
      inputRecipients.length < 1 ||
      inputRecipients.length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Send between 1 and 100 recipients per request."
      });
    }

    // Normalize Ghanaian mobile numbers.
    const recipients = [
      ...new Set(
        inputRecipients.map(number => {
          let phone = String(number).trim().replace(/[\s()-]/g, "");

          if (/^0\d{9}$/.test(phone)) {
            phone = "+233" + phone.slice(1);
          } else if (/^233\d{9}$/.test(phone)) {
            phone = "+" + phone;
          }

          return phone;
        })
      )
    ];

    if (
      recipients.some(
        phone => !/^\+233\d{9}$/.test(phone)
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "One or more phone numbers are invalid. Use Ghanaian numbers, such as 0241234567 or +233241234567."
      });
    }

    if (recipients.length > 100) {
      return res.status(400).json({
        success: false,
        message: "A maximum of 100 unique recipients is allowed per request."
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "The message cannot exceed 1000 characters."
      });
    }

    // Check available credits before sending.
    const creditResponse = await fetch(
      "https://api.sailup.io/v1/sms/credits/",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        }
      }
    );

    const credits = await creditResponse.json();

    if (!creditResponse.ok) {
      return res.status(502).json({
        success: false,
        message: "Could not verify your Sailup credit balance."
      });
    }

    // Conservative estimate; exact segments depend on encoding.
    const estimatedSegments =
      message.length <= 160
        ? 1
        : Math.ceil(message.length / 153);

    const estimatedCredits =
      recipients.length * estimatedSegments;

    if (
      credits.balance < estimatedCredits &&
      !credits.auto_topup?.enabled
    ) {
      return res.status(400).json({
        success: false,
        message: "Insufficient Sailup credits.",
        availableCredits: credits.balance,
        estimatedCredits
      });
    }

    const response = await fetch(
      "https://api.sailup.io/v1/sms/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          from: senderId,
          to: recipients,
          body: message
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Sailup send failed:", response.status, result);

      return res.status(502).json({
        success: false,
        message: "Sailup could not accept the SMS campaign.",
        details: result
      });
    }

    return res.status(202).json({
      success: true,
      message: "Sailup accepted the SMS campaign for processing.",
      campaign: result,
      recipientCount: recipients.length,
      estimatedCredits
    });

  } catch (error) {
    console.error("SMS campaign error:", error.message);

    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred while processing the SMS campaign."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Kielmen 636 Dataplug API listening on port ${PORT}`
  );
});
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error.message
    );

    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  await pool.end().catch(() => {});
  process.exit(0);
});

startServer();
