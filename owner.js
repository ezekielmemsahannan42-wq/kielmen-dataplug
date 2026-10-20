"use strict";

/*
 * KIELMEN 636 DATAPLUG
 * OWNER DASHBOARD
 *
 * BACKEND: Render
 */

const OWNER_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const TOKEN_KEY = "kielmen_owner_token";

let ownerToken = sessionStorage.getItem(TOKEN_KEY);
let refreshTimer = null;

/* =========================================
   GENERAL HELPERS
========================================= */

function byId(id) {
  return document.getElementById(id);
}

function money(amount) {
  return "GH₵" + Number(amount || 0).toFixed(2);
}

function showMessage(message) {
  const element = byId("ownerMessage");

  if (element) {
    element.textContent = message;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* =========================================
   AUTHENTICATED API REQUESTS
========================================= */

async function ownerRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (ownerToken) {
    headers.Authorization = "Bearer " + ownerToken;
  }

  const response = await fetch(OWNER_API + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    ownerToken = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  if (!response.ok) {
    throw new Error(
      data.message || "The request could not be completed."
    );
  }

  return data;
}

/* =========================================
   OWNER LOGIN
   Endpoint: POST /owner/login
========================================= */

function showLogin() {
  let overlay = byId("ownerLoginOverlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ownerLoginOverlay";

    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:99999;
      background:#030712;
      color:white;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:20px;
      font-family:Arial,sans-serif;
    `;

    overlay.innerHTML = `
      <form id="ownerLoginForm" style="
        width:100%;
        max-width:420px;
        padding:25px;
        background:#111827;
        border:1px solid #374151;
        border-radius:16px;
      ">
        <h1 style="color:#eab308">
          KIELMEN 636 DATAPLUG
        </h1>

        <h2>Owner Login</h2>

        <p>Sign in to manage your business.</p>

        <label for="ownerPassword">
          Owner password
        </label>

        <input
          id="ownerPassword"
          type="password"
          autocomplete="current-password"
          required
          maxlength="500"
          style="
            display:block;
            width:100%;
            padding:13px;
            margin:12px 0;
            box-sizing:border-box;
            border-radius:8px;
          "
        >

        <button
          id="ownerLoginButton"
          type="submit"
          style="
            width:100%;
            padding:13px;
            border:0;
            border-radius:8px;
            background:#16a34a;
            color:white;
            font-weight:bold;
          "
        >
          Log In
        </button>

        <p id="ownerLoginMessage" role="status"></p>
      </form>
    `;

    document.body.appendChild(overlay);

    byId("ownerLoginForm").addEventListener(
      "submit",
      handleLogin
    );
  }

  overlay.style.display = "flex";
}

async function handleLogin(event) {
  event.preventDefault();

  const passwordInput = byId("ownerPassword");
  const message = byId("ownerLoginMessage");
  const button = byId("ownerLoginButton");

  button.disabled = true;
  button.textContent = "Signing in...";
  message.textContent = "";

  try {
    const response = await fetch(
      OWNER_API + "/owner/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password: passwordInput.value
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success || !data.token) {
      throw new Error(data.message || "Login failed.");
    }

    ownerToken = data.token;

    sessionStorage.setItem(TOKEN_KEY, ownerToken);

    passwordInput.value = "";

    byId("ownerLoginOverlay").style.display = "none";

    await startDashboard();

  } catch (error) {
    message.textContent = error.message || "Unable to sign in.";
  } finally {
    button.disabled = false;
    button.textContent = "Log In";
  }
}

/* =========================================
   DASHBOARD STATISTICS
   Endpoint: GET /owner/stats
========================================= */

function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent = String(value ?? 0);
  }
}

async function loadStatistics() {
  const data = await ownerRequest("/owner/stats");

  if (!data.success || !data.stats) {
    throw new Error("Dashboard statistics are unavailable.");
  }

  const stats = data.stats;

  setText("totalSales", money(
    stats.totalSales ?? stats.totalRevenue
  ));

  setText("totalProfit", money(
    stats.totalProfit ?? stats.totalAgentProfit
  ));

  setText("totalOrders", stats.totalOrders);

  setText(
    "successfulDeliveries",
    stats.successfulDeliveries ?? stats.deliveredOrders
  );

  setText(
    "pendingOrders",
    stats.pendingOrders ?? stats.processingOrders
  );

  setText(
    "failedOrders",
    stats.failedOrders ?? stats.failedDeliveries
  );

  setText(
    "registeredAgents",
    stats.registeredAgents ?? "Unavailable"
  );

  setText(
    "pendingWithdrawals",
    stats.pendingWithdrawals ?? "Unavailable"
  );
}

/* =========================================
   CUSTOMER ORDER MANAGEMENT
   Endpoint: GET /owner/orders
========================================= */

async function loadOrders() {
  const tbody = byId("ordersTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading orders...</td></tr>';

  const params = new URLSearchParams();

  const search = byId("orderSearch")?.value.trim() || "";
  const payment = byId("orderPaymentFilter")?.value || "";
  const delivery = byId("orderDeliveryFilter")?.value || "";

  if (search) params.set("search", search);
  if (payment) params.set("status", payment);
  if (delivery) params.set("delivery_status", delivery);

  params.set("limit", "100");

  try {
    const data = await ownerRequest(
      "/owner/orders?" + params.toString()
    );

    const orders = data.orders || [];

    if (!orders.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No orders found.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(order => `
      <tr>
        <td>${escapeHTML(order.reference)}</td>
        <td>${escapeHTML(order.phone)}</td>
        <td>${escapeHTML(order.network)}</td>
        <td>${escapeHTML(order.bundle)}</td>
        <td>${money(order.amount)}</td>
        <td>${escapeHTML(order.status)}</td>
        <td>${escapeHTML(order.delivery_status)}</td>
      </tr>
    `).join("");

  } catch (error) {
    tbody.innerHTML =
      `<tr><td colspan="7">${escapeHTML(error.message)}</td></tr>`;
  }
}

/* =========================================
   AGENT MANAGEMENT
   Endpoint: GET /owner/agents
========================================= */

async function loadAgents() {
  const tbody = byId("agentsTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading agents...</td></tr>';

  try {
    const data = await ownerRequest("/owner/agents");

    let agents = data.agents || [];

    const search = (
      byId("agentSearch")?.value || ""
    ).trim().toLowerCase();

    if (search) {
      agents = agents.filter(agent =>
        [
          agent.agent_code,
          agent.full_name,
          agent.business_name,
          agent.email,
          agent.phone
        ].some(value =>
          String(value || "").toLowerCase().includes(search)
        )
      );
    }

    if (!agents.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No agents found.</td></tr>';
      return;
    }

    tbody.innerHTML = agents.map(agent => `
      <tr>
        <td>${escapeHTML(agent.agent_code)}</td>
        <td>${escapeHTML(agent.full_name)}</td>
        <td>${escapeHTML(agent.business_name)}</td>
        <td>${escapeHTML(agent.status)}</td>
        <td>${escapeHTML(agent.total_orders)}</td>
        <td>${money(agent.paid_sales)}</td>
        <td>
          <button
            type="button"
            class="button refresh"
            data-agent-details="${escapeHTML(agent.id)}"
          >
            View
          </button>
        </td>
      </tr>
    `).join("");

  } catch (error) {
    tbody.innerHTML =
      `<tr><td colspan="7">${escapeHTML(error.message)}</td></tr>`;
  }
}

/* =========================================
   INDIVIDUAL AGENT DETAILS
   Endpoint: GET /owner/agents/:id/details
========================================= */

async function loadAgentDetails(id) {
  const panel = byId("agentDetails");

  if (!panel) return;

  panel.textContent = "Loading agent details...";

  try {
    const data = await ownerRequest(
      "/owner/agents/" + encodeURIComponent(id) + "/details"
    );

    const agent = data.agent || {};
    const stats = data.stats || {};

    const orders = data.orders || [];
    const withdrawals = data.withdrawals || [];

    panel.innerHTML = `
      <h3>${escapeHTML(agent.business_name)}</h3>

      <p>Name: ${escapeHTML(agent.full_name)}</p>
      <p>Agent code: ${escapeHTML(agent.agent_code)}</p>
      <p>Status: ${escapeHTML(agent.status)}</p>

      <p>Total orders: ${escapeHTML(stats.totalOrders)}</p>
      <p>Paid orders: ${escapeHTML(stats.paidOrders)}</p>
      <p>Delivered orders: ${escapeHTML(stats.deliveredOrders)}</p>
      <p>Total sales: ${money(stats.totalSales)}</p>
      <p>Estimated profit: ${money(
        stats.estimatedProfit ?? stats.totalProfit
      )}</p>

      <h4>Recent Orders</h4>

      <div style="overflow-x:auto">
        <table style="width:100%;min-width:600px">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Network</th>
              <th>Bundle</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Delivery</th>
            </tr>
          </thead>
          <tbody>
            ${orders.length ? orders.map(order => `
              <tr>
                <td>${escapeHTML(order.reference)}</td>
                <td>${escapeHTML(order.network)}</td>
                <td>${escapeHTML(order.bundle)}</td>
                <td>${money(order.amount)}</td>
                <td>${escapeHTML(order.status)}</td>
                <td>${escapeHTML(order.delivery_status)}</td>
              </tr>
            `).join("") : `
              <tr><td colspan="6">No orders found.</td></tr>
            `}
          </tbody>
        </table>
      </div>

      <h4>Withdrawal History</h4>

      <div style="overflow-x:auto">
        <table style="width:100%;min-width:500px">
          <thead>
            <tr>
              <th>Amount</th>
              <th>MoMo Number</th>
              <th>Provider</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${withdrawals.length ? withdrawals.map(item => `
              <tr>
                <td>${money(item.amount)}</td>
                <td>${escapeHTML(item.phone)}</td>
                <td>${escapeHTML(item.provider)}</td>
                <td>${escapeHTML(item.status)}</td>
              </tr>
            `).join("") : `
              <tr><td colspan="4">No withdrawal history.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    `;

  } catch (error) {
    panel.textContent = error.message;
  }
}

/* =========================================
   WITHDRAWAL MANAGEMENT
   Endpoint: GET /owner/withdrawals
========================================= */

async function loadWithdrawals() {
  const tbody = byId("withdrawalsTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading withdrawals...</td></tr>';

  try {
    const data = await ownerRequest("/owner/withdrawals");

    const withdrawals = data.withdrawals || [];

    if (!withdrawals.length)
