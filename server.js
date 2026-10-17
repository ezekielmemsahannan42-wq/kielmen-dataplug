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
// ========================================
// KIELMEN 636 AGENT SYSTEM - DATABASE
// ========================================

const AGENT_TOKEN_SECRET = process.env.AGENT_TOKEN_SECRET;

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
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
      store_description VARCHAR(200) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_prices (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      network VARCHAR(30) NOT NULL,
      bundle VARCHAR(30) NOT NULL,
      selling_price NUMERIC(10,2) NOT NULL CHECK (selling_price >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agent_id, network, bundle)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS agents_status_idx
    ON agents(status)
  `);
}
  // Associate customer orders with agents.
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS agent_id BIGINT
    REFERENCES agents(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS orders_agent_id_idx
    ON orders(agent_id)
  `);

  // Record withdrawal requests.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_withdrawals (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT NOT NULL REFERENCES agents(id),
      amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
      phone VARCHAR(20) NOT NULL,
      provider VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Track the supplier cost used to calculate agent margins.
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS supplier_cost NUMERIC(10,2)
  `);
// ========================================
// AGENT AUTHENTICATION HELPERS
// ========================================

const agentSessions = new Map();

function hashAgentPassword(password) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, AGENT_TOKEN_SECRET, 64, (error, key) => {
      if (error) return reject(error);
      resolve(key.toString("hex"));
    });
  });
}

async function verifyAgentPassword(password, storedHash) {
  const suppliedHash = await hashAgentPassword(password);

  const supplied = Buffer.from(suppliedHash, "hex");
  const stored = Buffer.from(storedHash, "hex");

  return stored.length === supplied.length &&
    crypto.timingSafeEqual(stored, supplied);
}

function requireAgent(req, res, next) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Please log in."
    });
  }

  const token = authorization.slice(7);
  const session = agentSessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    agentSessions.delete(token);

    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please log in again."
    });
  }

  req.agentId = session.agentId;
  next();
}

async function requireApprovedAgent(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT id, status
       FROM agents
       WHERE id = $1`,
      [req.agentId]
    );

    if (
      result.rowCount === 0 ||
      result.rows[0].status !== "approved"
    ) {
      return res.status(403).json({
        success: false,
        message: "Your agent account is not approved."
      });
    }

    next();
  } catch (error) {
    console.error("Agent authentication error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not verify your agent account."
    });
  }
}
// ========================================
// AGENT REGISTRATION
// ========================================

app.post("/agents/register", async (req, res) => {
  try {
    if (!AGENT_TOKEN_SECRET || AGENT_TOKEN_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message: "Agent registration is not configured securely."
      });
    }

    const fullName = String(req.body?.fullName || "").trim();
    const businessName = String(req.body?.businessName || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || "");
    const storeDescription =
      String(req.body?.storeDescription || "").trim();

    if (
      fullName.length < 2 || fullName.length > 100 ||
      businessName.length < 2 || businessName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 255 ||
      !validPhone(phone) ||
      password.length < 12 || password.length > 128 ||
      storeDescription.length > 200
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter valid details. Passwords must be at least 12 characters."
      });
    }

    const passwordHash = await hashAgentPassword(password);

    const agentCode =
      "K636-" + crypto.randomBytes(6).toString("hex").toUpperCase();

    const result = await pool.query(
      `INSERT INTO agents
       (agent_code, full_name, business_name, email, phone,
        password_hash, store_description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       RETURNING id, agent_code, full_name, business_name,
                 email, phone, status, created_at`,
      [
        agentCode,
        fullName,
        businessName,
        email,
        phone,
        passwordHash,
        storeDescription
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful. Your account is awaiting owner approval.",
      agent: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "That email address or phone number is already registered."
      });
    }

    console.error("Agent registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again."
    });
  }
});
// ========================================
// AGENT LOGIN
// ========================================

app.post("/agents/login", async (req, res) => {
  try {
    if (!AGENT_TOKEN_SECRET || AGENT_TOKEN_SECRET.length < 32) {
      return res.status(503).json({
        success: false,
        message: "Agent login is not configured."
      });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password || email.length > 255 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Enter your email address and password."
      });
    }

    const result = await pool.query(
      `SELECT id, agent_code, full_name, business_name,
              email, phone, password_hash, status
       FROM agents
       WHERE email = $1`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const agent = result.rows[0];

    const passwordMatches = await verifyAgentPassword(
      password,
      agent.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    if (agent.status !== "approved") {
      return res.status(403).json({
        success: false,
        status: agent.status,
        message: agent.status === "pending"
          ? "Your account is awaiting owner approval."
          : "Your account cannot log in. Contact the owner."
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    agentSessions.set(token, {
      agentId: agent.id,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      token,
      expiresIn: 14400,
      agent: {
        id: agent.id,
        agentCode: agent.agent_code,
        fullName: agent.full_name,
        businessName: agent.business_name,
        email: agent.email,
        phone: agent.phone,
        status: agent.status
      }
    });
  } catch (error) {
    console.error("Agent login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not log in. Please try again."
    });
  }
});
// ========================================
// AGENT PROFILE
// ========================================

app.get(
  "/agents/me",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, agent_code, full_name, business_name,
                email, phone, status, store_description, created_at
         FROM agents
         WHERE id = $1`,
        [req.agentId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Agent account not found."
        });
      }

      return res.json({
        success: true,
        agent: result.rows[0]
      });
    } catch (error) {
      console.error("Agent profile error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not load your profile."
      });
    }
  }
);

// ========================================
// AGENT LOGOUT
// ========================================

app.post("/agents/logout", requireAgent, (req, res) => {
  const token = req.headers.authorization.slice(7);

  agentSessions.delete(token);

  return res.json({
    success: true,
    message: "Logged out successfully."
  });
});
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
// OWNER DASHBOARD STATISTICS
app.get("/owner/stats", requireOwner, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (
          WHERE status = 'paid'
        )::int AS paid_orders,
        COUNT(*) FILTER (
          WHERE delivery_status = 'delivered'
        )::int AS successful_deliveries,
        COUNT(*) FILTER (
          WHERE delivery_status = 'processing'
        )::int AS processing_orders,
        COUNT(*) FILTER (
          WHERE delivery_status = 'failed'
        )::int AS failed_deliveries,
        COALESCE(
          SUM(amount) FILTER (
            WHERE status = 'paid'
          ), 0
        )::numeric(12,2) AS total_revenue
      FROM orders
    `);

    const stats = result.rows[0];

    return res.json({
      success: true,
      stats: {
        totalOrders: stats.total_orders,
        paidOrders: stats.paid_orders,
        successfulDeliveries: stats.successful_deliveries,
        processingOrders: stats.processing_orders,
        failedDeliveries: stats.failed_deliveries,
        totalRevenue: Number(stats.total_revenue)
      }
    });
  } catch (error) {
    console.error("Owner statistics error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load dashboard statistics."
    });
  }
});
// ========================================
// OWNER: AGENT MANAGEMENT
// ========================================

// List agents.
app.get("/owner/agents", requireOwner, async (_req, res) => {
  try {
    const result = await pool.query(`
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
      LEFT JOIN orders o ON o.agent_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);

    res.json({ success: true, agents: result.rows });
  } catch (error) {
    console.error("List agents:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not load agents."
    });
  }
});

// Approve or reject an agent.
app.patch(
  "/owner/agents/:id/status",
  requireOwner,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body?.status || "");

      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid agent ID."
        });
      }

      if (!["approved", "rejected", "suspended"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid agent status."
        });
      }

      const result = await pool.query(
        `UPDATE agents
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, agent_code, full_name, status`,
        [status, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Agent not found."
        });
      }

      // Invalidate existing sessions for this agent.
      for (const [token, session] of agentSessions.entries()) {
        if (String(session.agentId) === String(id)) {
          agentSessions.delete(token);
        }
      }

      res.json({
        success: true,
        agent: result.rows[0]
      });
    } catch (error) {
      console.error("Update agent status:", error.message);
      res.status(500).json({
        success: false,
        message: "Could not update agent status."
      });
    }
  }
);
// ========================================
// AGENT: SELLING PRICES
// ========================================

app.get(
  "/agents/prices",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT network, bundle, selling_price
         FROM agent_prices
         WHERE agent_id = $1
         ORDER BY network, bundle`,
        [req.agentId]
      );

      res.json({
        success: true,
        prices: result.rows
      });
    } catch (error) {
      console.error("Get agent prices:", error.message);
      res.status(500).json({
        success: false,
        message: "Could not load selling prices."
      });
    }
  }
);

app.put(
  "/agents/prices",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    const prices = req.body?.prices;

    if (!Array.isArray(prices) || prices.length < 1 || prices.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Provide between 1 and 100 prices."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const item of prices) {
        const network = normalizeNetwork(item.network);
        const bundle = normalizeBundle(item.bundle);
        const sellingPrice = Number(item.sellingPrice);
        const basePrice = PRICES[network]?.[bundle];

        if (
          !network ||
          basePrice === undefined ||
          !Number.isFinite(sellingPrice) ||
          sellingPrice < basePrice ||
          Math.round(sellingPrice * 100) !== sellingPrice * 100
        ) {
          throw new Error(
            `Invalid price for ${item.network || "network"} ${item.bundle || "bundle"}.`
          );
        }

        await client.query(
          `INSERT INTO agent_prices
           (agent_id, network, bundle, selling_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id, network, bundle)
           DO UPDATE SET
             selling_price = EXCLUDED.selling_price,
             updated_at = NOW()`,
          [req.agentId, network, bundle, sellingPrice]
        );
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Selling prices saved."
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res.status(400).json({
        success: false,
        message: error.message || "Could not save prices."
      });
    } finally {
      client.release();
    }
  }
);
// ========================================
// AGENT: SALES STATISTICS
// ========================================

app.get(
  "/agents/stats",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*)::int AS total_orders,
           COUNT(*) FILTER (
             WHERE status = 'paid'
           )::int AS paid_orders,
           COUNT(*) FILTER (
             WHERE delivery_status = 'delivered'
           )::int AS delivered_orders,
           COUNT(*) FILTER (
             WHERE delivery_status = 'processing'
           )::int AS processing_orders,
           COUNT(*) FILTER (
             WHERE delivery_status = 'failed'
           )::int AS failed_orders,
           COALESCE(
             SUM(amount) FILTER (WHERE status = 'paid'),
             0
           )::numeric(12,2) AS total_sales,
           COALESCE(
             SUM(amount - supplier_cost)
             FILTER (
               WHERE status = 'paid'
               AND delivery_status = 'delivered'
               AND supplier_cost IS NOT NULL
             ),
             0
           )::numeric(12,2) AS recorded_margin,
           COUNT(DISTINCT phone)::int AS customers
         FROM orders
         WHERE agent_id = $1`,
        [req.agentId]
      );

      const row = result.rows[0];

      res.json({
        success: true,
        stats: {
          totalOrders: row.total_orders,
          paidOrders: row.paid_orders,
          deliveredOrders: row.delivered_orders,
          processingOrders: row.processing_orders,
          failedOrders: row.failed_orders,
          totalSales: Number(row.total_sales),
          recordedMargin: Number(row.recorded_margin),
          customers: row.customers,
          marginComplete: false
        }
      });
    } catch (error) {
      console.error("Agent statistics:", error.message);
      res.status(500).json({
        success: false,
        message: "Could not load sales statistics."
      });
    }
  }
);
// ========================================
// AGENT: REQUEST WITHDRAWAL
// ========================================

app.post(
  "/agents/withdrawals",
  requireAgent,
  requireApprovedAgent,
  async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      const phone = normalizePhone(req.body?.phone);
      const provider = String(req.body?.provider || "")
        .trim()
        .toUpperCase();

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.round(amount * 100) !== amount * 100 ||
        !validPhone(phone) ||
        !["MTN", "TELECEL", "AIRTELTIGO"].includes(provider)
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid amount, Ghana phone number and Mobile Money provider."
        });
      }

      const result = await pool.query(
        `INSERT INTO agent_withdrawals
         (agent_id, amount, phone, provider)
         VALUES ($1, $2, $3, $4)
         RETURNING id, amount, phone, provider, status, created_at`,
        [req.agentId, amount, phone, provider]
      );

      res.status(201).json({
        success: true,
        message: "Withdrawal request submitted for owner review.",
        withdrawal: result.rows[0]
      });
    } catch (error) {
      console.error("Withdrawal request:", error.message);
      res.status(500).json({
        success: false,
        message: "Could not submit withdrawal request."
      });
    }
  }
);
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
    await createAgentTables();

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
