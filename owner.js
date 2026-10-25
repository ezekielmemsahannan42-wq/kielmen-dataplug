"use strict";

/* =========================================
   KIELMEN 636 DATAPLUG
   OWNER DASHBOARD
   Backend: Render
========================================= */

const OWNER_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const TOKEN_KEY = "kielmen_owner_token";

let ownerToken = null;
let refreshTimer = null;
let dashboardLoading = false;

/* =========================================
   GENERAL HELPERS
========================================= */

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  const amount = Number(value);
  return "GH₵" + (
    Number.isFinite(amount) ? amount : 0
  ).toFixed(2);
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
  if (element) element.textContent = message;
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value ?? 0);
}

function showDashboard() {
  const content = byId("ownerDashboardContent");
  if (content) content.style.display = "block";
}

function hideDashboard() {
  const content = byId("ownerDashboardContent");
  if (content) content.style.display = "none";
}

/* =========================================
   API REQUESTS
========================================= */

async function ownerRequest(path, options = {}) {
  if (!ownerToken) {
    throw new Error("Please log in to your owner account.");
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: "Bearer " + ownerToken
  };

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
      "Cannot connect to the server. Check your internet connection."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    ownerToken = null;
    sessionStorage.removeItem(TOKEN_KEY);
    hideDashboard();

    throw new Error(
      "Your owner session has expired. Please log in again."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message || `Request failed with HTTP ${response.status}.`
    );
  }

  return data;
}

/* =========================================
   OWNER LOGIN
========================================= */

function showLogin() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

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

        <label for="ownerPassword">Owner password</label>

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

  const passwordInput = byId("ownerPassword");

  if (passwordInput) {
    passwordInput.value = "";
    passwordInput.focus();
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const passwordInput = byId("ownerPassword");
  const message = byId("ownerLoginMessage");
  const button = byId("ownerLoginButton");

  if (!passwordInput || !message || !button) return;

  const password = passwordInput.value;

  if (!password) {
    message.textContent = "Please enter your password.";
    return;
  }

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

    if (!response.ok || !data.success || !data.token) {
      throw new Error(
        data.message || "Login failed. Check your password."
      );
    }

    ownerToken = data.token;
    sessionStorage.setItem(TOKEN_KEY, ownerToken);
    passwordInput.value = "";

    byId("ownerLoginOverlay").style.display = "none";
    showDashboard();
    showMessage("Login successful. Loading dashboard...");

    await startDashboard();

  } catch (error) {
    ownerToken = null;
    sessionStorage.removeItem(TOKEN_KEY);
    hideDashboard();

    message.textContent =
      error.message || "Unable to sign in. Please try again.";

    byId("ownerLoginOverlay").style.display = "flex";

  } finally {
    button.disabled = false;
    button.textContent = "Log In";
  }
}

/* =========================================
   STATISTICS
========================================= */

async function loadStatistics() {
  const data = await ownerRequest("/owner/stats");

  if (!data.success || !data.stats) {
    throw new Error("Statistics could not be loaded.");
  }

  const stats = data.stats;

  setText(
    "totalSales",
    money(stats.totalSales ?? stats.totalRevenue)
  );

  setText(
    "totalProfit",
    stats.totalProfit != null ||
    stats.totalAgentProfit != null
      ? money(stats.totalProfit ?? stats.totalAgentProfit)
      : "Not available"
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
   CUSTOMER ORDERS
========================================= */

async function loadOrders() {
  const tbody = byId("ordersTableBody");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading orders...</td></tr>';

  const params = new URLSearchParams();

  const search = byId("orderSearch")?.value.trim() || "";
  const paymentStatus = byId("orderPaymentFilter")?.value || "";
  const deliveryStatus = byId("orderDeliveryFilter")?.value || "";

  if (search) params.set("search", search);
  if (paymentStatus) params.set("status", paymentStatus);

  if (deliveryStatus) {
    params.set("delivery_status", deliveryStatus);
  }

  params.set("limit", "100");

  try {
    const data = await ownerRequest(
      "/owner/orders?" + params.toString()
    );

    if (!data.success) {
      throw new Error("Could not retrieve orders.");
    }

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
    tbody.innerHTML = `
      <tr><td colspan="7">${escapeHTML(error.message)}</td></tr>
    `;
    throw error;
  }
}

/* =========================================
   AGENT MANAGEMENT
========================================= */

async function loadAgents() {
  const tbody = byId("agentsTableBody");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading agents...</td></tr>';

  try {
    const data = await ownerRequest("/owner/agents");

    if (!data.success) {
      throw new Error("Could not retrieve agents.");
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
      <tr><td colspan="7">${escapeHTML(error.message)}</td></tr>
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
      "/owner/agents/" + encodeURIComponent(id) + "/details"
    );

    if (!data.success) {
      throw new Error("Could not load agent details.");
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
   OWNER WITHDRAWAL MANAGEMENT
========================================= */

async function loadWithdrawals() {
  const tbody = byId("withdrawalsTableBody");
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7">Loading withdrawals...</td></tr>';

  try {
    const data = await ownerRequest("/owner/withdrawals");

    if (!data.success) {
      throw new Error("Could not retrieve withdrawals.");
    }

    const withdrawals = data.withdrawals || [];

    const pending = withdrawals.filter(item =>
      String(item.status).toLowerCase() === "pending"
    );

    setText("ownerPendingCount", pending.length);

    setText(
      "ownerPendingAmount",
      money(pending.reduce(
        (total, item) => total + Number(item.amount || 0),
        0
      ))
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
      <tr><td colspan="7">${escapeHTML(error.message)}</td></tr>
    `;
    throw error;
  }
}

/* =========================================
   UPDATE WITHDRAWAL STATUS
========================================= */

async function updateWithdrawalStatus(id, status) {
  const promptMessage = status === "paid"
    ? "Have you already sent the money successfully through Mobile Money?"
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

    showMessage(data.message || "Withdrawal status updated.");

    await Promise.all([
      loadStatistics(),
      loadWithdrawals()
    ]);

  } catch (error) {
    showMessage(error.message);
  }
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

    const failed = results.filter(
      result => result.status === "rejected"
    );

    if (failed.length) {
      showMessage(
        "Some sections could not load. Check the affected section."
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

  if (refreshTimer) clearInterval(refreshTimer);

  if (ownerToken) {
    refreshTimer = setInterval(() => {
      loadDashboard().catch(error => showMessage(error.message));
    }, 60000);
  }
}

/* =========================================
   OWNER LOGOUT
========================================= */

async function logoutOwner() {
  const oldToken = ownerToken;

  ownerToken = null;
  sessionStorage.removeItem(TOKEN_KEY);

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  hideDashboard();
  showLogin();

  if (oldToken) {
    try {
      await fetch(OWNER_API + "/owner/logout", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + oldToken
        }
      });
    } catch (_error) {
      // Local logout is already complete.
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
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  byId("ownerLogoutButton")?.addEventListener(
    "click",
    logoutOwner
  );

  byId("refreshDashboard")?.addEventListener(
    "click",
    () => loadDashboard().catch(error => showMessage(error.message))
  );

  byId("searchOrders")?.addEventListener(
    "click",
    () => loadOrders().catch(error => showMessage(error.message))
  );

  byId("orderSearch")?.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadOrders().catch(error => showMessage(error.message));
      }
    }
  );

  byId("agentSearch")?.addEventListener(
    "input",
    () => loadAgents().catch(error => showMessage(error.message))
  );

  byId("agentsTableBody")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-agent-details]");

      if (button) {
        loadAgentDetails(button.dataset.agentDetails);
      }
    }
  );

  byId("withdrawalsTableBody")?.addEventListener(
    "click",
    event => {
      const paidButton = event.target.closest("[data-withdrawal-paid]");
      const rejectButton = event.target.closest("[data-withdrawal-reject]");

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

  ownerToken = sessionStorage.getItem(TOKEN_KEY);

  if (ownerToken) {
    startDashboard().catch(error => showMessage(error.message));
  } else {
    showLogin();
  }
}

/* =========================================
   SMS PHONE NUMBER HELPERS
========================================= */

function normalizeGhanaPhone(value) {
  let phone = String(value || "").trim().replace(/[\s()-]/g, "");

  if (/^00233\d{9}$/.test(phone)) {
    phone = "+" + phone.slice(2);
  } else if (/^233\d{9}$/.test(phone)) {
    phone = "+" + phone;
  } else if (/^0\d{9}$/.test(phone)) {
    phone = "+233" + phone.slice(1);
  }

  return phone;
}

function parseSmsRecipients(value) {
  const entries = String(value || "")
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);

  const normalized = [...new Set(entries.map(normalizeGhanaPhone))];

  return {
    valid: normalized.filter(number => /^\+233\d{9}$/.test(number)),
    invalid: normalized.filter(number => !/^\+233\d{9}$/.test(number))
  };
}

/* =========================================
   SMS FILE UPLOAD
   Accepts TXT and CSV files.
========================================= */

function initializeSmsFileUpload() {
  const fileInput = byId("smsContactFile");
  const recipientsBox = byId("smsRecipients");

  if (!fileInput || !recipientsBox) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];

    if (!file) return;

    if (!/\.(txt|csv)$/i.test(file.name)) {
      alert("Please select a TXT or CSV file.");
      fileInput.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert("The file must be smaller than 2 MB.");
      fileInput.value = "";
      return;
    }

    try {
      const content = await file.text();

      const found = content.match(
        /(?:\+233|00233|233|0)\s*[\d\s()-]{9,15}/g
      ) || [];

      const imported = found
        .map(normalizeGhanaPhone)
        .filter(number => /^\+233\d{9}$/.test(number));

      const existing = parseSmsRecipients(recipientsBox.value).valid;
      const combined = [...new Set([...existing, ...imported])];

      recipientsBox.value = combined.join("\n");

      recipientsBox.dispatchEvent(
        new Event("input", { bubbles: true })
      );

      alert(
        `${imported.length} valid number(s) found in the file.\n` +
        `${combined.length} unique valid recipient(s) are now in the list.`
      );

    } catch (_error) {
      alert("Unable to read this file. Please try another TXT or CSV file.");
    } finally {
      fileInput.value = "";
    }
  });
}

/* =========================================
   SMS COST ESTIMATION
========================================= */

// Conservative character-set estimate.
// Actual encoding and charges depend on Sailup.
function getSmsSegmentCount(message) {
  const gsm7Characters =
    /^[@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#$%&'()*+,\-./:;<=>?¡A-ZÄÖÑÜ¿a-zäöñüà\r\n^{}\\[\]~|€]*$/;

  const isGsm7 = gsm7Characters.test(message);

  if (isGsm7) {
    return message.length <= 160
      ? 1
      : Math.ceil(message.length / 153);
  }

  return message.length <= 70
    ? 1
    : Math.ceil(message.length / 67);
}

/* =========================================
   SMS CAMPAIGN CONTROLS
========================================= */

function initializeSmsCampaign() {
  const messageBox = byId("smsMessage");
  const recipientsBox = byId("smsRecipients");
  const recipientCount = byId("smsRecipientCount");
  const estimateButton = byId("estimateSmsCost");
  const sendButton = byId("sendSmsCampaign");
  const statusBox = byId("smsCampaignStatus");

  if (
    !messageBox ||
    !recipientsBox ||
    !recipientCount ||
    !estimateButton ||
    !sendButton ||
    !statusBox
  ) {
    return;
  }

  const BATCH_SIZE = 100;

  // Provisional only. Verify the actual price in Sailup.
  const PROVISIONAL_RATE_GHS = 0.02;

  let campaignRunning = false;

  function updateRecipientCount() {
    const recipients = parseSmsRecipients(recipientsBox.value);

    recipientCount.textContent =
      `Recipients: ${recipients.valid.length}` +
      (recipients.invalid.length
        ? ` | Invalid numbers: ${recipients.invalid.length}`
        : "");

    return recipients;
  }

  function createEstimate() {
    const message = messageBox.value.trim();
    const recipients = updateRecipientCount();

    if (!message) {
      statusBox.textContent = "Please enter an SMS message.";
      return null;
    }

    if (message.length > 1000) {
      statusBox.textContent =
        "Your message cannot exceed 1000 characters.";
      return null;
    }

    if (recipients.invalid.length) {
      statusBox.textContent =
        `Correct ${recipients.invalid.length} invalid phone number(s) first.`;
      return null;
    }

    if (!recipients.valid.length) {
      statusBox.textContent =
        "Please enter or upload customer phone numbers.";
      return null;
    }

    const segments = getSmsSegmentCount(message);
    const total = recipients.valid.length;
    const batches = Math.ceil(total / BATCH_SIZE);
    const estimatedCost =
      total * segments * PROVISIONAL_RATE_GHS;

    statusBox.textContent =
      `Estimated cost: GH₵${estimatedCost.toFixed(2)}. ` +
      `${total} recipients; ${segments} SMS segment(s) each; ` +
      `${batches} batch(es). ` +
      "This is a provisional estimate, not a confirmed Sailup quote.";

    return {
      message,
      recipients: recipients.valid,
      segments,
      batches,
      estimatedCost
    };
  }

  recipientsBox.addEventListener("input", () => {
    updateRecipientCount();
    statusBox.textContent = "";
  });

  messageBox.addEventListener("input", () => {
    statusBox.textContent = "";
  });

  estimateButton.addEventListener("click", createEstimate);

  sendButton.addEventListener("click", async () => {
    if (campaignRunning) {
      statusBox.textContent = "A campaign is already running.";
      return;
    }

    const estimate = createEstimate();

    if (!estimate) return;

    if (estimate.recipients.length > 1000) {
      statusBox.textContent =
        "This campaign exceeds 1,000 recipients. Split it into smaller campaigns and verify your provider limits first.";
      return;
    }

    const token = sessionStorage.getItem(TOKEN_KEY);

    if (!token) {
      statusBox.textContent =
        "Your owner session has expired. Log in again.";
      return;
    }

    const confirmed = window.confirm(
      `Submit this SMS campaign?\n\n` +
      `Recipients: ${estimate.recipients.length}\n` +
      `Batches: ${estimate.batches}\n` +
      `Estimated cost: GH₵${estimate.estimatedCost.toFixed(2)}\n\n` +
      `This is an estimate only. Sending may incur charges. ` +
      `Continue only if your sender ID is approved and all recipients consented.`
    );

    if (!confirmed) return;

    campaignRunning = true;
    sendButton.disabled = true;
    estimateButton.disabled = true;

    let acceptedRecipients = 0;
    let completedBatches = 0;

    const campaignId =
      "sms-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8);

    try {
      for (
        let start = 0;
        start < estimate.recipients.length;
        start += BATCH_SIZE
      ) {
        const batch = estimate.recipients.slice(
          start,
          start + BATCH_SIZE
        );

        const batchNumber = completedBatches + 1;

        statusBox.textContent =
          `Submitting batch ${batchNumber} of ${estimate.batches}. ` +
          `Previously accepted: ${acceptedRecipients}.`;

        const response = await fetch(
          OWNER_API + "/owner/sms/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
              "Idempotency-Key": `${campaignId}-${batchNumber}`
            },
            body: JSON.stringify({
              message: estimate.message,
              recipients: batch,
              campaignId,
              batchNumber
            })
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          statusBox.textContent =
            `Stopped at batch ${batchNumber} of ${estimate.batches}. ` +
            `${data.message || "The server did not confirm acceptance."} ` +
            `Previously accepted: ${acceptedRecipients}. ` +
            "Check provider records before retrying to avoid duplicates.";
          return;
        }

        acceptedRecipients += batch.length;
        completedBatches++;

        statusBox.textContent =
          `Progress: ${completedBatches}/${estimate.batches} batches accepted. ` +
          `${acceptedRecipients}/${estimate.recipients.length} recipients accepted.`;
      }

      statusBox.textContent =
        `All ${completedBatches} batches were accepted for processing. ` +
        `${acceptedRecipients} recipients submitted. ` +
        "Acceptance does not guarantee delivery.";

    } catch (error) {
      statusBox.textContent =
        `Campaign interrupted after ${completedBatches} accepted batch(es). ` +
        `${error.message} Check provider records before retrying.`;

    } finally {
      campaignRunning = false;
      sendButton.disabled = false;
      estimateButton.disabled = false;
    }
  });

  updateRecipientCount();
}

/* =========================================
   INITIALIZE
========================================= */

function initializeOwnerDashboard() {
  hideDashboard();

  const navLinks = document.querySelectorAll(
    ".owner-nav .nav-link"
  );

  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  byId("ownerLogoutButton")?.addEventListener(
    "click",
    logoutOwner
  );

  byId("refreshDashboard")?.addEventListener(
    "click",
    () => loadDashboard().catch(error => showMessage(error.message))
  );

  byId("searchOrders")?.addEventListener(
    "click",
    () => loadOrders().catch(error => showMessage(error.message))
  );

  byId("orderSearch")?.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadOrders().catch(error => showMessage(error.message));
      }
    }
  );

  byId("agentSearch")?.addEventListener(
    "input",
    () => loadAgents().catch(error => showMessage(error.message))
  );

  byId("agentsTableBody")?.addEventListener(
    "click",
    event => {
      const button = event.target.closest("[data-agent-details]");

      if (button) {
        loadAgentDetails(button.dataset.agentDetails);
      }
    }
  );

  byId("withdrawalsTableBody")?.addEventListener(
    "click",
    event => {
      const paidButton = event.target.closest("[data-withdrawal-paid]");
      const rejectButton = event.target.closest("[data-withdrawal-reject]");

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

  ownerToken = sessionStorage.getItem(TOKEN_KEY);

  if (ownerToken) {
    startDashboard().catch(error => showMessage(error.message));
  } else {
    showLogin();
  }
}

function initializeAllFeatures() {
  initializeOwnerDashboard();
  initializeSmsFileUpload();
  initializeSmsCampaign();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeAllFeatures,
    { once: true }
  );
} else {
  initializeAllFeatures();
       }
