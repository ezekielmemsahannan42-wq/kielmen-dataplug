"use strict";

const API_URL =
  "https://kielmen-dataplug-payment-api.onrender.com";

const OWNER_TOKEN_KEY = "kielmen_owner_token";

let ownerToken = sessionStorage.getItem(OWNER_TOKEN_KEY);

function formatMoney(amount) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS"
  }).format(Number(amount) || 0);
}

async function ownerRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(ownerToken
        ? { Authorization: `Bearer ${ownerToken}` }
        : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || "Request failed. Please try again."
    );
  }

  return data;
}

function showOwnerMessage(message) {
  let element = document.getElementById("ownerMessage");

  if (!element) {
    element = document.createElement("p");
    element.id = "ownerMessage";
    element.setAttribute("role", "status");

    document.body.prepend(element);
  }

  element.textContent = message;
}

function showLoginForm() {
  document.body.innerHTML = `
    <main style="
      max-width:420px;
      margin:60px auto;
      padding:24px;
      font-family:Arial,sans-serif;
      background:#111827;
      color:white;
      border-radius:16px;
      box-sizing:border-box;
    ">
      <h1 style="color:#4ade80">
        Kielmen 636 Dataplug
      </h1>

      <h2>Owner Login</h2>

      <form id="ownerLoginForm">
        <label for="ownerPassword">Owner password</label>

        <input
          id="ownerPassword"
          type="password"
          required
          autocomplete="current-password"
          style="
            display:block;
            box-sizing:border-box;
            width:100%;
            padding:12px;
            margin:12px 0;
            border-radius:8px;
          "
        >

        <button
          type="submit"
          style="
            width:100%;
            padding:12px;
            background:#16a34a;
            color:white;
            border:0;
            border-radius:8px;
            font-weight:bold;
          "
        >
          Log In
        </button>

        <p id="loginMessage" role="status"></p>
      </form>
    </main>
  `;

  document
    .getElementById("ownerLoginForm")
    .addEventListener("submit", handleOwnerLogin);
}

async function handleOwnerLogin(event) {
  event.preventDefault();

  const passwordInput =
    document.getElementById("ownerPassword");

  const message =
    document.getElementById("loginMessage");

  const password = passwordInput.value;

  message.textContent = "Signing in…";

  try {
    const response = await fetch(`${API_URL}/owner/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success || !data.token) {
      throw new Error(data.message || "Login failed.");
    }

    ownerToken = data.token;

    sessionStorage.setItem(
      OWNER_TOKEN_KEY,
      ownerToken
    );

    passwordInput.value = "";

    await loadOwnerDashboard();
  } catch (error) {
    message.textContent =
      error.message || "Unable to log in.";
  }
}

function renderDashboard(stats) {
  document.body.innerHTML = `
    <main style="
      max-width:1000px;
      margin:24px auto;
      padding:16px;
      font-family:Arial,sans-serif;
      color:#f9fafb;
      background:#030712;
      box-sizing:border-box;
    ">
      <header style="
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      ">
        <div>
          <h1 style="color:#4ade80">
            Kielmen 636 Dataplug
          </h1>
          <p>Owner Dashboard</p>
        </div>

        <button id="ownerLogoutButton" style="
          padding:10px 16px;
          background:#dc2626;
          color:white;
          border:0;
          border-radius:8px;
        ">
          Log Out
        </button>
      </header>

      <h2>Business Overview</h2>

      <section style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
        gap:16px;
      ">
        <article class="owner-card">
          <h3>Total Orders</h3>
          <p>${Number(stats.totalOrders) || 0}</p>
        </article>

        <article class="owner-card">
          <h3>Paid Orders</h3>
          <p>${Number(stats.paidOrders) || 0}</p>
        </article>

        <article class="owner-card">
          <h3>Successful Deliveries</h3>
          <p>${Number(stats.successfulDeliveries) || 0}</p>
        </article>

        <article class="owner-card">
          <h3>Processing Orders</h3>
          <p>${Number(stats.processingOrders) || 0}</p>
        </article>

        <article class="owner-card">
          <h3>Failed Deliveries</h3>
          <p>${Number(stats.failedDeliveries) || 0}</p>
        </article>

        <article class="owner-card">
          <h3>Paid Revenue</h3>
          <p>${formatMoney(stats.totalRevenue)}</p>
        </article>
      </section>

      <p style="color:#fbbf24">
        Revenue is not profit. Supplier costs and other expenses
        must be recorded to calculate profit.
      </p>

      <p id="dashboardMessage" role="status"></p>
    </main>

    <style>
      .owner-card {
        padding:18px;
        background:#111827;
        border:1px solid #374151;
        border-radius:14px;
        overflow-wrap:anywhere;
      }

      .owner-card h3 {
        color:#4ade80;
        font-size:16px;
      }

      .owner-card p {
        font-size:24px;
        font-weight:bold;
      }

      button {
        cursor:pointer;
      }
    </style>
  `;

  document
    .getElementById("ownerLogoutButton")
    .addEventListener("click", logoutOwner);
}

async function loadOwnerDashboard() {
  try {
    const result = await ownerRequest("/owner/stats");

    if (!result.success || !result.stats) {
      throw new Error("Could not load dashboard statistics.");
    }

    renderDashboard(result.stats);
  } catch (error) {
    ownerToken = null;

    sessionStorage.removeItem(OWNER_TOKEN_KEY);

    showLoginForm();

    const message = document.getElementById("loginMessage");

    if (message) {
      message.textContent =
        error.message || "Please log in again.";
    }
  }
}

async function logoutOwner() {
  try {
    await ownerRequest("/owner/logout", {
      method: "POST"
    });
  } catch (_error) {
    // Clear the local session even if the server is unavailable.
  }

  ownerToken = null;

  sessionStorage.removeItem(OWNER_TOKEN_KEY);

  showLoginForm();
}

document.addEventListener("DOMContentLoaded", () => {
  if (ownerToken) {
    loadOwnerDashboard();
  } else {
    showLoginForm();
  }
});
"use strict";

/* ==========================================
   KIELMEN 636 DATAPLUG
   OWNER DASHBOARD SCRIPT
   ========================================== */

const OWNER_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const money = (amount) =>
  "GH₵" + Number(amount || 0).toFixed(2);

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function displayMessage(message) {
  alert(message);
}

/*
 SECURITY NOTICE:
 Do not put a password, Paystack secret key, or owner API
 secret in this public JavaScript file.

 The dashboard must only display private records after the
 backend verifies an authenticated owner session.
*/

function renderOrders(orders) {
  const table = byId("ordersTable");
  if (!table) return;

  table.replaceChildren();

  if (!Array.isArray(orders) || orders.length === 0) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.className = "empty";
    cell.textContent = "No orders found.";
    return;
  }

  orders.forEach((order) => {
    const row = table.insertRow();

    const values = [
      order.reference || order.id || "—",
      order.phone || "—",
      order.network || "—",
      order.bundle || "—",
      money(order.amount),
      order.status || "—",
      order.delivery_status || "—"
    ];

    values.forEach((value) => {
      const cell = row.insertCell();
      cell.textContent = String(value);
    });
  });
}

function renderAgents(agents) {
  const table = byId("agentsTable");
  if (!table) return;

  table.replaceChildren();

  if (!Array.isArray(agents) || agents.length === 0) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = "empty";
    cell.textContent = "No agent records found.";
    return;
  }

  agents.forEach((agent) => {
    const row = table.insertRow();

    [
      agent.name || "—",
      agent.phone || agent.email || "—",
      money(agent.total_sales),
      money(agent.available_earnings),
      agent.status || "—"
    ].forEach((value) => {
      const cell = row.insertCell();
      cell.textContent = String(value);
    });
  });
}

function renderWithdrawals(withdrawals) {
  const table = byId("withdrawalsTable");
  if (!table) return;

  table.replaceChildren();

  if (
    !Array.isArray(withdrawals) ||
    withdrawals.length === 0
  ) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = "empty";
    cell.textContent = "No withdrawal requests found.";
    return;
  }

  withdrawals.forEach((request) => {
    const row = table.insertRow();

    [
      request.agent_name || request.agent || "—",
      money(request.amount),
      request.mobile_money_number || "—",
      request.created_at
        ? new Date(request.created_at).toLocaleString()
        : "—",
      request.status || "—"
    ].forEach((value) => {
      const cell = row.insertCell();
      cell.textContent = String(value);
    });
  });
}

/*
 These statistics are updated only from data returned by
 an authenticated backend endpoint.
*/

function updateStatistics(stats = {}) {
  setText("totalSales", money(stats.total_sales));
  setText("totalProfit", money(stats.total_profit));
  setText("totalOrders", stats.total_orders || 0);
  setText(
    "successfulDeliveries",
    stats.successful_deliveries || 0
  );
  setText("pendingOrders", stats.pending_orders || 0);
  setText("failedOrders", stats.failed_orders || 0);
  setText("registeredAgents", stats.registered_agents || 0);
  setText("pendingWithdrawals", stats.pending_withdrawals || 0);
}

/*
 We intentionally do not request private data yet.
 The current backend needs authenticated owner endpoints
 before this dashboard can safely retrieve business records.
*/

function showBackendStatus(message) {
  console.info("[Owner Dashboard]", message);
}

function initializeOwnerDashboard() {
  showBackendStatus(
    "Dashboard layout loaded. Secure owner login and backend endpoints are still required."
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeOwnerDashboard
  );
} else {
  initializeOwnerDashboard();
}
