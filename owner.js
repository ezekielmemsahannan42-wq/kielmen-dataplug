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
   POST /owner/login
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
   This does not send Mobile Money.
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

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  if (ownerToken) {
    refreshTimer = setInterval(() => {
      loadDashboard().catch(error => {
        showMessage(error.message);
      });
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
     // Owner dashboard navigation
  const navLinks = document.querySelectorAll(".owner-nav .nav-link");

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

  // Restore a saved token if one exists.
  ownerToken = sessionStorage.getItem(TOKEN_KEY);

  if (ownerToken) {
    startDashboard().catch(error => {
      showMessage(error.message);
    });
  } else {
    showLogin();
  }
}

/* =========================================
   INITIALIZE
========================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeOwnerDashboard
  );
} else {
  initializeOwnerDashboard();
   }
// ========================================
// SMS CUSTOMER FILE UPLOAD
// ========================================

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("smsContactFile");
  const recipientsBox = document.getElementById("smsRecipients");
  const recipientCount = document.getElementById("smsRecipientCount");

  if (!fileInput || !recipientsBox) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];

    if (!file) return;

    const allowedExtensions = /\.(txt|csv)$/i;

    if (!allowedExtensions.test(file.name)) {
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

      // Extract Ghanaian phone numbers from the file.
      const numbers = content.match(
        /(?:\+233|00233|233|0)\s*[\d\s()-]{9,15}/g
      ) || [];

      const cleanedNumbers = numbers
        .map(number => number.replace(/[\s()-]/g, ""))
        .map(number => {
          if (number.startsWith("00233")) {
            return "+" + number.slice(2);
          }

          if (number.startsWith("233")) {
            return "+" + number;
          }

          return number;
        })
        .filter(number => /^(?:0\d{9}|\+233\d{9})$/.test(number));

      const existingNumbers = recipientsBox.value
        .split(/\r?\n/)
        .map(number => number.trim())
        .filter(Boolean);

      const combinedNumbers = [
        ...new Set([...existingNumbers, ...cleanedNumbers])
      ];

      recipientsBox.value = combinedNumbers.join("\n");

      if (recipientCount) {
        recipientCount.textContent =
          "Recipients: " + combinedNumbers.length;
      }

      alert(
        cleanedNumbers.length +
        " phone numbers found in the file.\n" +
        combinedNumbers.length +
        " unique numbers are now in your recipient list."
      );

    } catch (error) {
      alert("Unable to read the file. Please try another TXT or CSV file.");
    }

    fileInput.value = "";
  });
});
// ============================================
// KIELMEN 636 DATAPLUG - SMS CAMPAIGN CONTROLS
// ============================================

(() => {
  const initSmsCampaign = () => {
    const messageBox = document.getElementById("smsMessage");
    const recipientsBox = document.getElementById("smsRecipients");
    const recipientCount = document.getElementById("smsRecipientCount");
    const estimateButton = document.getElementById("estimateSmsCost");
    const sendButton = document.getElementById("sendSmsCampaign");
    const statusBox = document.getElementById("smsCampaignStatus");

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

    // Get unique, valid Ghanaian phone numbers.
    const getRecipients = () => {
      const numbers = recipientsBox.value
        .split(/[\n,;]+/)
        .map(number => number.trim().replace(/[\s()-]/g, ""))
        .filter(Boolean)
        .map(number => {
          if (/^0\d{9}$/.test(number)) {
            return "+233" + number.slice(1);
          }

          if (/^233\d{9}$/.test(number)) {
            return "+" + number;
          }

          return number;
        });

      return {
        all: [...new Set(numbers)],
        valid: [...new Set(numbers.filter(number => /^\+233\d{9}$/.test(number)))],
        invalid: [...new Set(numbers.filter(number => !/^\+233\d{9}$/.test(number)))]
      };
    };

    // Count recipients whenever the list changes.
    const updateCount = () => {
      const result = getRecipients();

      recipientCount.textContent =
        `Recipients: ${result.valid.length}` +
        (result.invalid.length
          ? ` | Invalid numbers: ${result.invalid.length}`
          : "");

      return result;
    };

    recipientsBox.addEventListener("input", updateCount);

    // Update the estimate when the message changes.
    messageBox.addEventListener("input", () => {
      statusBox.textContent = "";
    });

    // Calculate the estimated SMS cost.
    estimateButton.addEventListener("click", () => {
      const message = messageBox.value.trim();
      const result = updateCount();

      if (!message) {
        statusBox.textContent = "Please enter your SMS message.";
        return;
      }

      if (result.invalid.length) {
        statusBox.textContent =
          `Please correct ${result.invalid.length} invalid phone number(s) before estimating.`;
        return;
      }

      if (!result.valid.length) {
        statusBox.textContent = "Please enter or upload customer phone numbers.";
        return;
      }

      // Conservative estimate: GSM-7 is normally 160 characters
      // for one segment and 153 characters per segment thereafter.
      // Unicode messages can have smaller segment limits.
      const gsm7Pattern = /^[\x00-\x7F€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#$%&'()*+,\-./0-9:;<=>?@A-Z\[\\\]^_`a-z{|}~\r\n]*$/;
      const isGsm7 = gsm7Pattern.test(message);

      const segments = isGsm7
        ? (message.length <= 160 ? 1 : Math.ceil(message.length / 153))
        : (message.length <= 70 ? 1 : Math.ceil(message.length / 67));

      const estimatedCost = result.valid.length * segments * 0.02;

      statusBox.textContent =
        `Estimated cost: GH₵${estimatedCost.toFixed(2)}. ` +
        `${result.valid.length} recipient(s), ${segments} SMS segment(s) per recipient. ` +
        "This is an estimate; Sailup's actual charge may differ.";

    });

    // Submit campaign to the authenticated backend.
    sendButton.addEventListener("click", async () => {
      const message = messageBox.value.trim();
      const result = updateCount();

      if (!message) {
        statusBox.textContent = "Please enter your SMS message.";
        return;
      }

      if (message.length > 1000) {
        statusBox.textContent = "Your message cannot exceed 1000 characters.";
        return;
      }

      if (result.invalid.length) {
        statusBox.textContent =
          `Please correct ${result.invalid.length} invalid phone number(s).`;
        return;
      }

      if (!result.valid.length) {
        statusBox.textContent = "Please enter or upload recipient numbers.";
        return;
      }

      if (result.valid.length > 100) {
        statusBox.textContent =
          "Please send no more than 100 recipients per campaign request.";
        return;
      }

      const estimatedSegments =
        message.length <= 160 ? 1 : Math.ceil(message.length / 153);
      const estimate = result.valid.length * estimatedSegments * 0.02;

      const confirmed = confirm(
        `Send this SMS campaign to ${result.valid.length} recipients?\n\n` +
        `Estimated cost: GH₵${estimate.toFixed(2)}\n\n` +
        "Only continue if these recipients consented to receive your messages."
      );

      if (!confirmed) return;

      const ownerToken = localStorage.getItem("kielmen_owner_token");

      if (!ownerToken) {
        statusBox.textContent =
          "Your owner session has expired. Please log in again.";
        return;
      }

      sendButton.disabled = true;
      estimateButton.disabled = true;
      statusBox.textContent = "Submitting campaign to Sailup…";

      try {
        const response = await fetch(
          "https://kielmen-dataplug-payment-api.onrender.com/owner/sms/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${ownerToken}`
            },
            body: JSON.stringify({
              message,
              recipients: result.valid
            })
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || "Sailup could not accept the campaign."
          );
        }

        statusBox.textContent =
          `✅ ${data.message} ` +
          `Recipients: ${data.recipientCount}. ` +
          `Estimated credits: ${data.estimatedCredits}.`;

      } catch (error) {
        statusBox.textContent = `❌ ${error.message}`;
      } finally {
        sendButton.disabled = false;
        estimateButton.disabled = false;
      }
    });

    // Show the initial count.
    updateCount();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSmsCampaign);
  } else {
    initSmsCampaign();
  }
})();
