"use strict";

/* =========================================
   KIELMEN 636 DATAPLUG
   OWNER DASHBOARD
   Login, Statistics, Orders, Agents,
   Withdrawals and SMS Campaigns
========================================= */

const OWNER_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const TOKEN_KEY = "kielmen_owner_token";
const SMS_BATCH_SIZE = 100;
const SMS_MAX_FILE_SIZE = 2 * 1024 * 1024;

let ownerToken = null;
let refreshTimer = null;
let dashboardLoading = false;
let smsCampaignRunning = false;
let loginRunning = false;

/* =========================================
   GENERAL HELPERS
========================================= */

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "—";
  }

  return "GH₵" + amount.toFixed(2);
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

function showMessage(message) {
  const element = byId("ownerMessage");

  if (element) {
    element.textContent = String(message || "");
  }
}

function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent =
      value === null || value === undefined || value === ""
        ? "—"
        : String(value);
  }
}

function showDashboard() {
  const element = byId("ownerDashboardContent");

  if (element) {
    element.style.display = "block";
  }
}

function hideDashboard() {
  const element = byId("ownerDashboardContent");

  if (element) {
    element.style.display = "none";
  }
}

function getSavedToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function saveToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch (_error) {
    throw new Error("Your browser could not save the login session.");
  }
}

function clearToken() {
  ownerToken = null;

  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch (_error) {
    // The local session is still cleared.
  }
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/* =========================================
   API REQUEST HELPER
========================================= */

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (ownerToken) {
    headers.Authorization = "Bearer " + ownerToken;
  }

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;

  try {
    response = await fetch(OWNER_API + path, {
      ...options,
      headers
    });
  } catch (_error) {
    throw new Error(
      "Cannot connect to the backend. Check your internet connection or Render service."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (
    (response.status === 401 || response.status === 403) &&
    path !== "/owner/login"
  ) {
    clearToken();
    stopRefreshTimer();
    hideDashboard();

    throw new Error(
      "Your owner session has expired. Please log in again."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Server request failed with HTTP ${response.status}.`
    );
  }

  return data;
}

async function ownerRequest(path, options = {}) {
  if (!ownerToken) {
    throw new Error("Please log in to your owner account.");
  }

  return apiRequest(path, options);
}

/* =========================================
   OWNER LOGIN
   POST /owner/login
========================================= */

function showLogin(messageText = "") {
  stopRefreshTimer();
  hideDashboard();

  let overlay = byId("ownerLoginOverlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ownerLoginOverlay";

    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:999999;
      background:#030712;
      color:#ffffff;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:20px;
      font-family:Arial,sans-serif;
      overflow-y:auto;
      box-sizing:border-box;
    `;

    overlay.innerHTML = `
      <form id="ownerLoginForm" style="
        width:100%;
        max-width:420px;
        padding:25px;
        background:#111827;
        border:1px solid #374151;
        border-radius:16px;
        box-sizing:border-box;
      ">

        <h1 style="color:#eab308;font-size:25px">
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
            cursor:pointer;
          "
        >
          Log In
        </button>

        <p
          id="ownerLoginMessage"
          role="status"
          aria-live="polite"
          style="overflow-wrap:anywhere"
        ></p>

      </form>
    `;

    document.body.appendChild(overlay);

    byId("ownerLoginForm").addEventListener(
      "submit",
      handleLogin
    );
  }

  overlay.style.display = "flex";

  const message = byId("ownerLoginMessage");

  if (message) {
    message.textContent = messageText;
  }

  const passwordInput = byId("ownerPassword");

  if (passwordInput) {
    passwordInput.value = "";
  }
}

async function handleLogin(event) {
  event.preventDefault();

  if (loginRunning) return;

  const passwordInput = byId("ownerPassword");
  const message = byId("ownerLoginMessage");
  const button = byId("ownerLoginButton");

  if (!passwordInput || !message || !button) return;

  const password = passwordInput.value;

  if (!password) {
    message.textContent = "Please enter your owner password.";
    return;
  }

  loginRunning = true;
  button.disabled = true;
  button.textContent = "Signing in...";
  message.textContent = "";

  try {
    const response = await fetch(OWNER_API + "/owner/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        `Login failed with HTTP ${response.status}.`
      );
    }

    if (!data.success || !data.token) {
      throw new Error(
        data.message ||
        "The server did not return a valid login token. Check /owner/login in server.js."
      );
    }

    saveToken(data.token);
    ownerToken = data.token;

    passwordInput.value = "";

    byId("ownerLoginOverlay").style.display = "none";

    showDashboard();
    showMessage("Login successful. Loading your business data...");

    await startDashboard();

  } catch (error) {
    clearToken();
    hideDashboard();

    message.textContent =
      error.message || "Login failed. Please try again.";

    byId("ownerLoginOverlay").style.display = "flex";

  } finally {
    loginRunning = false;
    button.disabled = false;
    button.textContent = "Log In";
  }
}

/* =========================================
   OWNER STATISTICS
   GET /owner/stats
========================================= */

async function loadStatistics() {
    const data = await ownerRequest("/owner/stats");

  if (!data.success) {
    throw new Error(
      data.message || "Could not load dashboard statistics."
    );
  }

  // Support both nested and direct statistics responses.
  const stats = data.stats || data;

  if (
    stats.totalOrders == null &&
    stats.totalSales == null &&
    stats.totalRevenue == null
  ) {
    throw new Error(
      "The backend response is missing the expected statistics."
    );
  }

  // Do not replace missing values with false zeroes.
  setText(
    "totalSales",
    stats.totalSales ?? stats.totalRevenue ?? "—"
  );

  if (
    stats.totalSales != null ||
    stats.totalRevenue != null
  ) {
    setText(
      "totalSales",
      money(stats.totalSales ?? stats.totalRevenue)
    );
  }

  const profit =
    stats.totalProfit ?? stats.totalAgentProfit;

  setText(
    "totalProfit",
    profit == null ? "Not available" : money(profit)
  );

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
  setText("registeredAgents", stats.registeredAgents);
  setText("pendingWithdrawals", stats.pendingWithdrawals);
}

/* =========================================
   CUSTOMER ORDERS
   GET /owner/orders
   Includes Retry Delivery for failed orders
========================================= */

async function loadOrders() {
  const tbody = byId("ordersTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="8">Loading orders...</td></tr>';

  const params = new URLSearchParams();

  const search =
    byId("orderSearch")?.value.trim() || "";

  const paymentStatus =
    byId("orderPaymentFilter")?.value || "";

  const deliveryStatus =
    byId("orderDeliveryFilter")?.value || "";

  if (search) params.set("search", search);

  if (paymentStatus) {
    params.set("status", paymentStatus);
  }

  if (deliveryStatus) {
    params.set("delivery_status", deliveryStatus);
  }

  params.set("limit", "100");

  try {
    const data = await ownerRequest(
      "/owner/orders?" + params.toString()
    );

    if (!data.success) {
      throw new Error(
        data.message || "Could not retrieve orders."
      );
    }

    const orders = data.orders || [];

    if (!orders.length) {
      tbody.innerHTML =
        '<tr><td colspan="8">No orders found.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(order => {
      const payment = String(
        order.status || ""
      ).toLowerCase();

      const delivery = String(
        order.delivery_status || ""
      ).toLowerCase();

      const canRetry =
        payment === "paid" &&
        delivery === "failed";

      return `
        <tr>
          <td>${escapeHTML(order.reference)}</td>
          <td>${escapeHTML(order.phone)}</td>
          <td>${escapeHTML(order.network)}</td>
          <td>${escapeHTML(order.bundle)}</td>
          <td>${money(order.amount)}</td>
          <td>${escapeHTML(order.status)}</td>
          <td>${escapeHTML(order.delivery_status)}</td>
          <td>
            ${
              canRetry
                ? `
                  <button
                    type="button"
                    class="button"
                    style="
                      background:#ca8a04;
                      color:#030712;
                      padding:9px 12px;
                    "
                    data-retry-delivery="${escapeHTML(
                      order.reference
                    )}"
                  >
                    Retry Delivery
                  </button>
                `
                : "—"
            }
          </td>
        </tr>
      `;
    }).join("");

  } catch (error) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">${escapeHTML(error.message)}</td>
      </tr>
    `;

    throw error;
  }
}

/* =========================================
   RETRY FAILED DATA DELIVERY
========================================= */

async function retryOrderDelivery(reference, button) {
  if (!ownerToken) {
    showLogin();
    return;
  }

  const confirmed = window.confirm(
    "Retry delivery for this order?\n\n" +
    "Reference: " + reference + "\n\n" +
    "The customer has already paid. No new payment will be taken.\n\n" +
    "Before continuing, ensure DataMart did not already accept " +
    "the original purchase. A retry may risk duplicate delivery " +
    "if the supplier processed it despite the earlier error.\n\n" +
    "Do you want to continue?"
  );

  if (!confirmed) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Retrying...";
  }

  showMessage(
    "Retrying DataMart delivery for " + reference + "..."
  );

  try {
    const data = await ownerRequest(
      "/owner/orders/" +
      encodeURIComponent(reference) +
      "/retry-delivery",
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );

    showMessage(
      data.message ||
      "Retry request processed. Refresh the order status."
    );

    await loadOrders();

  } catch (error) {
    showMessage(
      "Retry result: " + error.message +
      " Check the order and DataMart status before retrying again."
    );

    await loadOrders().catch(() => {});
  }
         }

/* =========================================
   AGENT MANAGEMENT
   GET /owner/agents
========================================= */

async function loadAgents() {
  const tbody = byId("agentsTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading agents...</td></tr>';

  try {
    const data = await ownerRequest("/owner/agents");

    if (!data.success) {
      throw new Error(data.message || "Could not retrieve agents.");
    }

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
            data-agent-details="${escapeHTML(agent.id)}"
          >
            View Details
          </button>
        </td>
      </tr>
    `).join("");

  } catch (error) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">${escapeHTML(error.message)}</td>
      </tr>
    `;

    throw error;
  }
}

/* =========================================
   INDIVIDUAL AGENT DETAILS
========================================= */

async function loadAgentDetails(id) {
  const panel = byId("agentDetails");

  if (!panel) return;

  panel.textContent = "Loading agent details...";

  try {
    const data = await ownerRequest(
      "/owner/agents/" +
      encodeURIComponent(id) +
      "/details"
    );

    if (!data.success) {
      throw new Error(
        data.message || "Could not load agent details."
      );
    }

    const agent = data.agent || {};
    const stats = data.stats || {};
    const orders = data.orders || [];
    const withdrawals = data.withdrawals || [];

    panel.innerHTML = `
      <h3>${escapeHTML(agent.business_name)}</h3>

      <p>Name: ${escapeHTML(agent.full_name)}</p>
      <p>Agent code: ${escapeHTML(agent.agent_code)}</p>
      <p>Email: ${escapeHTML(agent.email)}</p>
      <p>Phone: ${escapeHTML(agent.phone)}</p>
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
              <th>Phone</th>
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
                <td>${escapeHTML(order.phone)}</td>
                <td>${escapeHTML(order.network)}</td>
                <td>${escapeHTML(order.bundle)}</td>
                <td>${money(order.amount)}</td>
                <td>${escapeHTML(order.status)}</td>
                <td>${escapeHTML(order.delivery_status)}</td>
              </tr>
            `).join("") : `
              <tr><td colspan="7">No orders found.</td></tr>
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
   GET /owner/withdrawals
========================================= */

async function loadWithdrawals() {
  const tbody = byId("withdrawalsTableBody");

  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading withdrawals...</td></tr>';

  try {
    const data = await ownerRequest("/owner/withdrawals");

    if (!data.success) {
      throw new Error(
        data.message || "Could not retrieve withdrawals."
      );
    }

    const withdrawals = data.withdrawals || [];

    const pending = withdrawals.filter(item =>
      String(item.status).toLowerCase() === "pending"
    );

    setText("ownerPendingCount", pending.length);

    setText(
      "ownerPendingAmount",
      money(
        pending.reduce(
          (total, item) => total + Number(item.amount || 0),
          0
        )
      )
    );

    if (!withdrawals.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No withdrawal requests found.</td></tr>';
      return;
    }

    tbody.innerHTML = withdrawals.map(item => {
      const isPending =
        String(item.status).toLowerCase() === "pending";

      return `
        <tr>
          <td>${escapeHTML(item.id)}</td>
          <td>${escapeHTML(
            item.business_name ||
            item.full_name ||
            item.agent_code
          )}</td>
          <td>${money(item.amount)}</td>
          <td>${escapeHTML(item.phone)}</td>
          <td>${escapeHTML(item.provider)}</td>
          <td>${escapeHTML(item.status)}</td>
          <td>
            ${isPending ? `
              <button
                type="button"
                data-withdrawal-paid="${escapeHTML(item.id)}"
              >Mark Paid</button>

              <button
                type="button"
                data-withdrawal-reject="${escapeHTML(item.id)}"
              >Reject</button>
            ` : escapeHTML(item.status)}
          </td>
        </tr>
      `;
    }).join("");

  } catch (error) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">${escapeHTML(error.message)}</td>
      </tr>
    `;

    throw error;
  }
}

/* =========================================
   UPDATE WITHDRAWAL STATUS
   This does NOT send Mobile Money.
========================================= */

async function updateWithdrawalStatus(id, status) {
  const promptMessage = status === "paid"
    ? "Have you already sent this money successfully through Mobile Money?"
    : "Are you sure you want to reject this withdrawal?";

  if (!window.confirm(promptMessage)) return;

  try {
    const data = await ownerRequest(
      "/owner/withdrawals/" +
      encodeURIComponent(id) +
      "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status })
      }
    );

    showMessage(
      data.message || "Withdrawal status updated."
    );

    await Promise.all([
      loadStatistics(),
      loadWithdrawals()
    ]);

  } catch (error) {
    showMessage(error.message);
  }
}

/* =========================================
   SMS PHONE NUMBER NORMALIZATION
========================================= */

function normalizeGhanaNumber(value) {
  let number = String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");

  if (number.startsWith("00233")) {
    number = "+" + number.slice(2);
  } else if (number.startsWith("233")) {
    number = "+" + number;
  } else if (/^0\d{9}$/.test(number)) {
    number = "+233" + number.slice(1);
  }

  return number;
}

function getSmsRecipients() {
  const box = byId("smsRecipients");

  if (!box) {
    return { valid: [], invalid: [] };
  }

  const numbers = box.value
    .split(/[\n,;]+/)
    .map(normalizeGhanaNumber)
    .filter(Boolean);

  const unique = [...new Set(numbers)];

  return {
    valid: unique.filter(number => /^\+233\d{9}$/.test(number)),
    invalid: unique.filter(number => !/^\+233\d{9}$/.test(number))
  };
}

function updateSmsRecipientCount() {
  const count = byId("smsRecipientCount");
  const result = getSmsRecipients();

  if (count) {
    count.textContent =
      `Recipients: ${result.valid.length}` +
      (
        result.invalid.length
          ? ` | Invalid numbers: ${result.invalid.length}`
          : ""
      );
  }

  return result;
}

/* =========================================
   SMS CONTACT FILE UPLOAD
   Supports TXT and CSV files
========================================= */

async function handleSmsFileUpload(event) {
  const input = event.target;
  const file = input.files && input.files[0];

  if (!file) return;

  const recipientsBox = byId("smsRecipients");
  const statusBox = byId("smsCampaignStatus");

  if (!recipientsBox) {
    input.value = "";
    return;
  }

  if (!/\.(txt|csv)$/i.test(file.name)) {
    alert("Please select a TXT or CSV file.");
    input.value = "";
    return;
  }

  if (file.size > SMS_MAX_FILE_SIZE) {
    alert("The file must be smaller than 2 MB.");
    input.value = "";
    return;
  }

  try {
    const content = await file.text();

    // Find Ghanaian numbers without consuming a whole CSV row.
    const matches = content.match(
      /(?:\+233|00233|233|0)\s*[\d\s()-]{8,18}/g
    ) || [];

    const extracted = matches
      .map(normalizeGhanaNumber)
      .filter(number => /^\+233\d{9}$/.test(number));

    const existing = getSmsRecipients().valid;

    const combined = [
      ...new Set([...existing, ...extracted])
    ];

    recipientsBox.value = combined.join("\n");

    recipientsBox.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    updateSmsRecipientCount();

    const resultMessage =
      `${extracted.length} valid phone number(s) found. ` +
      `${combined.length} unique number(s) are now in your list.`;

    if (statusBox) {
      statusBox.textContent = resultMessage;
    }

    alert(resultMessage);

  } catch (_error) {
    alert("Unable to read this file. Please try another TXT or CSV file.");
  } finally {
    input.value = "";
  }
}

/* =========================================
   SMS SEGMENT ESTIMATION
   Estimate only; not Sailup's official price.
========================================= */

function estimateSmsSegments(message) {
  const gsmCharacters =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ " +
    "!\"#$%&'()*+,-./0123456789:;<=>?¡" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿" +
    "abcdefghijklmnopqrstuvwxyzäöñüà";

  const gsmExtensionCharacters = "^{}\\[~]|€";

  let gsm7 = true;
  let units = 0;

  for (const char of message) {
    if (gsmCharacters.includes(char)) {
      units += 1;
    } else if (gsmExtensionCharacters.includes(char)) {
      units += 2;
    } else {
      gsm7 = false;
      break;
    }
  }

  if (!gsm7) {
    return message.length <= 70
      ? 1
      : Math.ceil(message.length / 67);
  }

  return units <= 160
    ? 1
    : Math.ceil(units / 153);
}

/* =========================================
   SMS COST ESTIMATION
========================================= */

function estimateSmsCampaign() {
  const message = byId("smsMessage")?.value.trim() || "";
  const status = byId("smsCampaignStatus");
  const recipients = updateSmsRecipientCount();

  if (!status) return null;

  if (!message) {
    status.textContent = "Please enter your SMS message.";
    return null;
  }

  if (recipients.invalid.length) {
    status.textContent =
      `Please correct ${recipients.invalid.length} invalid number(s).`;
    return null;
  }

  if (!recipients.valid.length) {
    status.textContent =
      "Please enter or upload customer phone numbers.";
    return null;
  }

  const segments = estimateSmsSegments(message);

  const batches = Math.ceil(
    recipients.valid.length / SMS_BATCH_SIZE
  );

  /*
   * Do not invent a price per SMS.
   * The backend/provider must supply the actual rate
   * before a reliable monetary estimate can be shown.
   */

  status.textContent =
    `Recipients: ${recipients.valid.length}. ` +
    `Estimated SMS segments per recipient: ${segments}. ` +
    `Batches: ${batches}. ` +
    "The actual cost must be confirmed using your Sailup account rate.";

  return {
    message,
    recipients: recipients.valid,
    segments,
    batches
  };
}

/* =========================================
   SEND SMS CAMPAIGN
   POST /owner/sms/send
========================================= */

async function sendSmsCampaign() {
  if (smsCampaignRunning) {
    return;
  }

  const status = byId("smsCampaignStatus");
  const sendButton = byId("sendSmsCampaign");
  const estimateButton = byId("estimateSmsCost");

  if (!status || !sendButton) return;

  if (!ownerToken) {
    status.textContent =
      "Please log in to your owner account before sending SMS.";
    showLogin();
    return;
  }

  const campaign = estimateSmsCampaign();

  if (!campaign) return;

  if (campaign.message.length > 1000) {
    status.textContent =
      "Your message cannot exceed 1,000 characters.";
    return;
  }

  const consentConfirmed = window.confirm(
    `Send this SMS campaign?\n\n` +
    `Recipients: ${campaign.recipients.length}\n` +
    `Batches: ${campaign.batches}\n\n` +
    `Only send messages to people who agreed to receive them. ` +
    `SMS charges may apply. Continue?`
  );

  if (!consentConfirmed) return;

  smsCampaignRunning = true;
  sendButton.disabled = true;

  if (estimateButton) {
    estimateButton.disabled = true;
  }

  let accepted = 0;
  let failedBatch = 0;

  const campaignId =
    "sms-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 8);

  try {
    for (
      let start = 0;
      start < campaign.recipients.length;
      start += SMS_BATCH_SIZE
    ) {
      const batchNumber =
        Math.floor(start / SMS_BATCH_SIZE) + 1;

      const batch = campaign.recipients.slice(
        start,
        start + SMS_BATCH_SIZE
      );

      status.textContent =
        `Submitting batch ${batchNumber} of ${campaign.batches}...`;

      let data;

      try {
        data = await ownerRequest("/owner/sms/send", {
          method: "POST",
          headers: {
            "Idempotency-Key":
              `${campaignId}-${batchNumber}`
          },
          body: JSON.stringify({
            message: campaign.message,
            recipients: batch,
            campaignId,
            batchNumber
          })
        });
      } catch (error) {
        failedBatch = batchNumber;

        status.textContent =
          `Campaign stopped at batch ${batchNumber}. ` +
          `${error.message} Previously accepted recipients: ${accepted}. ` +
          "Check your Sailup records before retrying.";
        break;
      }

      if (!data.success) {
        failedBatch = batchNumber;

        status.textContent =
          `Batch ${batchNumber} was not confirmed. ` +
          `${data.message || "The server did not confirm acceptance."} ` +
          `Previously accepted recipients: ${accepted}.`;
        break;
      }

      accepted += Number(
        data.recipientCount ?? batch.length
      );

      status.textContent =
        `Progress: ${batchNumber}/${campaign.batches} batches accepted. ` +
        `${accepted} recipients accepted for processing.`;
    }

    if (!failedBatch) {
      status.textContent =
        `Campaign submission completed. ${accepted} recipients were ` +
        "accepted for processing. This does not guarantee delivery.";
    }

  } finally {
    smsCampaignRunning = false;
    sendButton.disabled = false;

    if (estimateButton) {
      estimateButton.disabled = false;
    }
  }
}

/* =========================================
   SMS INITIALIZATION
========================================= */

function initializeSmsCampaign() {
  const fileInput = byId("smsContactFile");
  const recipientsBox = byId("smsRecipients");
  const messageBox = byId("smsMessage");
  const estimateButton = byId("estimateSmsCost");
  const sendButton = byId("sendSmsCampaign");

  if (fileInput && !fileInput.dataset.ownerBound) {
    fileInput.dataset.ownerBound = "true";

    fileInput.addEventListener(
      "change",
      handleSmsFileUpload
    );
  }

  if (recipientsBox && !recipientsBox.dataset.ownerBound) {
    recipientsBox.dataset.ownerBound = "true";

    recipientsBox.addEventListener("input", () => {
      updateSmsRecipientCount();

      const status = byId("smsCampaignStatus");

      if (status) status.textContent = "";
    });
  }

  if (messageBox && !messageBox.dataset.ownerBound) {
    messageBox.dataset.ownerBound = "true";

    messageBox.addEventListener("input", () => {
      const status = byId("smsCampaignStatus");

      if (status) status.textContent = "";
    });
  }

  if (estimateButton && !estimateButton.dataset.ownerBound) {
    estimateButton.dataset.ownerBound = "true";

    estimateButton.addEventListener(
      "click",
      estimateSmsCampaign
    );
  }

  if (sendButton && !sendButton.dataset.ownerBound) {
    sendButton.dataset.ownerBound = "true";

    sendButton.addEventListener(
      "click",
      sendSmsCampaign
    );
  }

  updateSmsRecipientCount();
}

/* =========================================
   DASHBOARD REFRESH
========================================= */

async function loadDashboard() {
  if (!ownerToken) {
    showLogin();
    return;
  }

  if (dashboardLoading) return;

  dashboardLoading = true;
  showMessage("Refreshing dashboard...");

  try {
    const results = await Promise.allSettled([
      loadStatistics(),
      loadOrders(),
      loadAgents(),
      loadWithdrawals()
    ]);

    const names = [
      "Statistics",
      "Orders",
      "Agents",
      "Withdrawals"
    ];

    const failures = results
      .map((result, index) => ({
        result,
        name: names[index]
      }))
      .filter(item => item.result.status === "rejected");

    if (failures.length) {
      showMessage(
        "Some sections failed: " +
        failures.map(item =>
          `${item.name}: ${item.result.reason?.message || "Unknown error"}`
        ).join(" | ")
      );
    } else {
      showMessage("Dashboard updated successfully.");
    }

  } finally {
    dashboardLoading = false;
  }
}

/* =========================================
   START DASHBOARD
========================================= */

async function startDashboard() {
  if (!ownerToken) {
    showLogin();
    return;
  }

  showDashboard();

  await loadDashboard();

  stopRefreshTimer();

  if (ownerToken) {
    refreshTimer = setInterval(() => {
      loadDashboard().catch(error => {
        showMessage(error.message);
      });
    }, 60000);
  }
}

/* =========================================
   LOGOUT
========================================= */

async function logoutOwner() {
  const oldToken = ownerToken;

  clearToken();
  stopRefreshTimer();

  hideDashboard();

  // Immediately return to login.
  showLogin("You have been logged out successfully.");

  if (oldToken) {
    try {
      await fetch(OWNER_API + "/owner/logout", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + oldToken
        }
      });
    } catch (_error) {
      // The local logout has already completed.
    }
  }
}

/* =========================================
   EVENT LISTENERS
========================================= */

function initializeOwnerDashboard() {
  hideDashboard();

  const navLinks = document.querySelectorAll(
    ".owner-nav .nav-link"
  );

  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      navLinks.forEach(item =>
        item.classList.remove("active")
      );

      link.classList.add("active");
    });
  });

  byId("ownerLogoutButton")?.addEventListener(
    "click",
    logoutOwner
  );

  byId("refreshDashboard")?.addEventListener(
    "click",
    () => {
      loadDashboard().catch(error => {
        showMessage(error.message);
      });
    }
  );

  byId("searchOrders")?.addEventListener(
    "click",
    () => {
      loadOrders().catch(error => {
        showMessage(error.message);
      });
    }
  );
   byId("ordersTableBody")?.addEventListener(
  "click",
  event => {
    const button = event.target.closest(
      "[data-retry-delivery]"
    );

    if (!button || button.disabled) return;

    retryOrderDelivery(
      button.dataset.retryDelivery,
      button
    );
  }
);

  byId("orderSearch")?.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();

        loadOrders().catch(error => {
          showMessage(error.message);
        });
      }
    }
  );

  byId("agentSearch")?.addEventListener(
    "input",
    () => {
      loadAgents().catch(error => {
        showMessage(error.message);
      });
    }
  );

  byId("agentsTableBody")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest(
        "[data-agent-details]"
      );

      if (button) {
        loadAgentDetails(button.dataset.agentDetails);
      }
    }
  );

  byId("withdrawalsTableBody")?.addEventListener(
    "click",
    event => {
      const paidButton = event.target.closest(
        "[data-withdrawal-paid]"
      );

      const rejectButton = event.target.closest(
        "[data-withdrawal-reject]"
      );

      if (paidButton) {
        updateWithdrawalStatus(
          paidButton.dataset.withdrawalPaid,
          "paid"
        );
      }

      if (rejectButton) {
        updateWithdrawalStatus(
          rejectButton.dataset.withdrawalReject,
          "rejected"
        );
      }
    }
  );

  initializeSmsCampaign();

  // Restore the owner session if available.
  ownerToken = getSavedToken();

  if (ownerToken) {
    startDashboard().catch(error => {
      showMessage(error.message);
    });
  } else {
    showLogin();
  }
}

/* =========================================
   INITIALIZE ONCE
========================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeOwnerDashboard,
    { once: true }
  );
} else {
  initializeOwnerDashboard();
     }
