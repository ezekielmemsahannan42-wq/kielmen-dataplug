"use strict";

/*
 * KIELMEN 636 DATAPLUG
 * OWNER DASHBOARD
 */

const OWNER_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const TOKEN_KEY = "kielmen_owner_token";

let ownerToken = sessionStorage.getItem(TOKEN_KEY);
let refreshTimer = null;

/* HTML element helper */
function byId(id) {
  return document.getElementById(id);
}

/* Format Ghana cedis */
function money(amount) {
  return "GH₵" + Number(amount || 0).toFixed(2);
}

/* Display a message safely */
function showMessage(message) {
  let element = byId("ownerMessage");

  if (!element) {
    element = document.createElement("p");
    element.id = "ownerMessage";
    element.setAttribute("role", "status");
    element.style.cssText =
      "padding:12px;margin:12px 0;border-radius:8px;";

    document.body.prepend(element);
  }

  element.textContent = message;
}

/* Make authenticated backend requests */
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

/* Create the login screen without replacing the dashboard HTML */
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
      box-sizing:border-box;
      font-family:Arial,sans-serif;
    `;

    overlay.innerHTML = `
      <form id="ownerLoginForm" style="
        width:100%;
        max-width:420px;
        padding:25px;
        box-sizing:border-box;
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
            box-sizing:border-box;
            padding:13px;
            margin:12px 0;
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

/* Authenticate the owner */
async function handleLogin(event) {
  event.preventDefault();

  const passwordInput = byId("ownerPassword");
  const message = byId("ownerLoginMessage");
  const button = byId("ownerLoginButton");

  const password = passwordInput.value;

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
      throw new Error(data.message || "Login failed.");
    }

    ownerToken = data.token;

    sessionStorage.setItem(TOKEN_KEY, ownerToken);

    passwordInput.value = "";

    byId("ownerLoginOverlay").style.display = "none";

    await loadStatistics();

  } catch (error) {
    message.textContent =
      error.message || "Unable to sign in.";

  } finally {
    button.disabled = false;
    button.textContent = "Log In";
  }
}

/* Update a dashboard card */
function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent = String(value);
  }
}

/* Load real statistics from the backend */
async function loadStatistics() {
  try {
    const data = await ownerRequest("/owner/stats");

    if (!data.success || !data.stats) {
      throw new Error("Dashboard statistics are unavailable.");
    }

    const stats = data.stats;

    /*
     * These IDs match the existing dashboard layout.
     * Total revenue is displayed as Total Sales.
     */
    setText(
      "totalSales",
      money(stats.totalRevenue)
    );

    setText(
      "totalOrders",
      stats.totalOrders
    );

    setText(
      "successfulDeliveries",
      stats.successfulDeliveries
    );

    setText(
      "pendingOrders",
      stats.processingOrders
    );

    setText(
      "failedOrders",
      stats.failedDeliveries
    );

    /*
     * Profit, registered agents and withdrawals are not
     * supplied by the current /owner/stats endpoint.
     * Do not display invented figures.
     */
    setText("totalProfit", "Not available");
    setText("registeredAgents", "Not connected");
    setText("pendingWithdrawals", "Not connected");

    /*
     * Hide the old setup warning after successful login.
     */
    document.querySelectorAll("body *").forEach(element => {
      if (
        element.children.length === 0 &&
        element.textContent.includes(
          "This is the initial dashboard layout"
        )
      ) {
        const warning = element.closest(
          ".notice, .alert, .warning, section, div"
        );

        if (warning) {
          warning.style.display = "none";
        }
      }
    });

    showMessage("Owner dashboard connected successfully.");

  } catch (error) {
    showMessage(error.message || "Unable to load statistics.");

    if (!ownerToken) {
      showLogin();
    }
  }
}

/* Log out */
async function logoutOwner() {
  try {
    await ownerRequest("/owner/logout", {
      method: "POST"
    });
  } catch (_error) {
    // Clear the local session even if the API is unavailable.
  }

  ownerToken = null;

  sessionStorage.removeItem(TOKEN_KEY);

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  showLogin();
}

/* Add a logout button without changing the existing layout */
function addLogoutButton() {
  if (byId("ownerLogoutButton")) {
    return;
  }

  const button = document.createElement("button");

  button.id = "ownerLogoutButton";
  button.textContent = "Owner Log Out";

  button.style.cssText = `
    padding:10px 16px;
    margin:12px;
    border:0;
    border-radius:8px;
    background:#dc2626;
    color:white;
    font-weight:bold;
  `;

  button.addEventListener("click", logoutOwner);

  document.body.prepend(button);
}

/* Start dashboard */
async function initializeOwnerDashboard() {
  if (!ownerToken) {
    showLogin();
    return;
  }

  try {
    await loadStatistics();

    if (ownerToken) {
      addLogoutButton();

      refreshTimer = setInterval(() => {
        if (ownerToken) {
          loadStatistics();
        }
      }, 60000);
    }

  } catch (error) {
    showMessage(error.message || "Dashboard initialization failed.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeOwnerDashboard
  );
} else {
  initializeOwnerDashboard();
}
