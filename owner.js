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
