"use strict";

/* ==========================================
   KIELMEN 636 DATAPLUG
   CUSTOMER WEBSITE SCRIPT
   ========================================== */

const PAYMENT_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

/* ==========================================
   APPROVED CUSTOMER-FACING PRICES
   ========================================== */

const PRODUCTS = {
  MTN: [
    { size: "1GB", price: 4.70 },
    { size: "2GB", price: 9.70 },
    { size: "3GB", price: 14.50 },
    { size: "4GB", price: 20.00 },
    { size: "5GB", price: 26.00 },
    { size: "6GB", price: 32.00 },
    { size: "8GB", price: 43.00 },
    { size: "10GB", price: 49.00 },
    { size: "15GB", price: 69.00 },
    { size: "20GB", price: 99.00 },
    { size: "25GB", price: 140.00 },
    { size: "30GB", price: 155.00 },
    { size: "40GB", price: 199.00 },
    { size: "50GB", price: 240.00 }
  ],

  TELECEL: [
    { size: "10GB", price: 45.00 },
    { size: "15GB", price: 62.00 },
    { size: "20GB", price: 82.00 },
    { size: "25GB", price: 101.00 },
    { size: "30GB", price: 124.00 },
    { size: "40GB", price: 170.00 },
    { size: "50GB", price: 210.00 },
    { size: "100GB", price: 420.00 }
  ],

  AIRTELTIGO: [
    { size: "1GB", price: 5.00 },
    { size: "2GB", price: 9.20 },
    { size: "5GB", price: 22.00 },
    { size: "10GB", price: 41.00 },
    { size: "20GB", price: 78.00 },
    { size: "30GB", price: 115.00 },
    { size: "50GB", price: 188.00 }
  ]
};

/* ==========================================
   WEBSITE STATE
   ========================================== */

let selectedNetwork = "MTN";
let selectedBundle = null;
let searchText = "";

let networkAvailability = {
  MTN: true,
  TELECEL: true,
  AIRTELTIGO: true
};

let announcementSettings = {
  enabled: false,
  message: ""
};

let announcementInitialized = false;

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

function getElement(id) {
  return document.getElementById(id);
}

function formatMoney(amount) {
  return "GH₵" + Number(amount).toFixed(2);
}

function showMessage(message, type = "info") {
  const element = getElement("checkoutMessage");

  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.style.display = "block";

  element.style.color =
    type === "error"
      ? "#ff6b6b"
      : type === "success"
      ? "#4ade80"
      : "#ffffff";
}

function isNetworkAvailable(network) {
  const key = String(network || "").toUpperCase();

  /*
   * A network is unavailable only when the settings
   * explicitly say false.
   */
  return (
    Object.prototype.hasOwnProperty.call(PRODUCTS, key) &&
    networkAvailability[key] !== false
  );
}

function getFirstAvailableNetwork() {
  return Object.keys(PRODUCTS).find(isNetworkAvailable) || null;
}

function formatNetworkName(network) {
  if (network === "AIRTELTIGO") return "AirtelTigo";
  if (network === "TELECEL") return "Telecel";
  return network;
}

/* ==========================================
   LOAD PUBLIC WEBSITE SETTINGS
   ========================================== */

async function loadPublicWebsiteSettings() {
  try {
    const response = await fetch(
      PAYMENT_API + "/website-settings",
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        "Website settings request failed: HTTP " + response.status
      );
    }

    const result = await response.json();

    if (!result.success || !result.settings) {
      throw new Error("Website settings were not returned.");
    }

    const settings = result.settings;

    /*
     * Do not interpret missing network settings as disabled.
     * Only an explicit false means unavailable.
     */
    networkAvailability = {
      MTN: settings.networkAvailability?.MTN !== false,
      TELECEL: settings.networkAvailability?.TELECEL !== false,
      AIRTELTIGO: settings.networkAvailability?.AIRTELTIGO !== false
    };

    announcementSettings = {
      enabled: settings.announcementEnabled === true,
      message: String(settings.announcement || "").trim()
    };

    /*
     * Keep the existing public website integration working
     * with the owner settings script in index.html.
     */
    applyAvailableNetworks();

    applyAnnouncementFromSettings();

    console.log("Website settings loaded successfully.");
  } catch (error) {
    /*
     * A settings API failure must not freeze the website.
     * Keep all networks available by default.
     */
    console.warn(
      "Could not load website settings. Using defaults.",
      error
    );

    networkAvailability = {
      MTN: true,
      TELECEL: true,
      AIRTELTIGO: true
    };

    applyAvailableNetworks();
    applyAnnouncementFromSettings();
  }
}

/* ==========================================
   NETWORK SELECTION
   ========================================== */

function selectNetwork(network) {
  const normalized = String(network || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  if (!PRODUCTS[normalized]) {
    return;
  }

  if (!isNetworkAvailable(normalized)) {
    showMessage(
      formatNetworkName(normalized) +
        " is temporarily unavailable. Please select another network.",
      "error"
    );

    return;
  }

  selectedNetwork = normalized;
  selectedBundle = null;

  const selectedNetworkInput = getElement("selectedNetwork");

  if (selectedNetworkInput) {
    selectedNetworkInput.value = normalized;
  }

  document.querySelectorAll(".network-tab").forEach(tab => {
    const tabNetwork = String(
      tab.dataset.network || tab.textContent || ""
    )
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

    const active = tabNetwork === normalized;

    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  renderBundles();
  updateSelectedBundle();

  const message = getElement("checkoutMessage");

  if (message) {
    message.textContent = "";
  }
}

/* ==========================================
   APPLY NETWORK AVAILABILITY
   ========================================== */

function applyAvailableNetworks() {
  const tabs = Array.from(
    document.querySelectorAll(".network-tab")
  );

  tabs.forEach(tab => {
    const network = String(tab.dataset.network || "")
      .toUpperCase();

    if (!PRODUCTS[network]) {
      return;
    }

    const available = isNetworkAvailable(network);

    tab.hidden = !available;
    tab.disabled = !available;

    tab.setAttribute(
      "aria-disabled",
      available ? "false" : "true"
    );

    if (!available) {
      tab.classList.remove("active");
    }
  });

  const availableNetwork = getFirstAvailableNetwork();

  const grid = getElement("bundleGrid");
  const resultCount = getElement("resultCount");
  const paymentButton = getElement("paymentButton");

  if (!availableNetwork) {
    selectedBundle = null;

    if (grid) {
      grid.replaceChildren();

      const notice = document.createElement("p");

      notice.className = "empty-state";
      notice.textContent =
        "All networks are temporarily unavailable. Please check again later.";

      grid.appendChild(notice);
    }

    if (resultCount) {
      resultCount.textContent = "No networks currently available.";
    }

    if (paymentButton) {
      paymentButton.disabled = true;
    }

    updateSelectedBundle();

    return;
  }

  if (paymentButton) {
    paymentButton.disabled = false;
  }

  /*
   * If the currently selected network has been disabled,
   * automatically switch to the first available network.
   */
  if (!isNetworkAvailable(selectedNetwork)) {
    selectNetwork(availableNetwork);
    return;
  }

  /*
   * If no network tab is active, restore the current valid one.
   */
  const activeTab = tabs.find(
    tab =>
      tab.dataset.network === selectedNetwork &&
      !tab.disabled
  );

  if (!activeTab) {
    selectNetwork(availableNetwork);
    return;
  }

  renderBundles();
}

/* ==========================================
   DISPLAY DATA BUNDLES
   ========================================== */

function renderBundles() {
  const grid = getElement("bundleGrid");

  if (!grid) {
    console.error("Missing HTML element: bundleGrid");
    return;
  }

  if (!isNetworkAvailable(selectedNetwork)) {
    grid.replaceChildren();

    const notice = document.createElement("p");
    notice.className = "empty-state";
    notice.textContent =
      "This network is temporarily unavailable.";

    grid.appendChild(notice);

    const resultCount = getElement("resultCount");

    if (resultCount) {
      resultCount.textContent = "Network unavailable.";
    }

    return;
  }

  const bundles = PRODUCTS[selectedNetwork] || [];

  const filteredBundles = bundles.filter(bundle => {
    const text = (
      bundle.size + " " + formatMoney(bundle.price)
    ).toLowerCase();

    return text.includes(searchText.toLowerCase());
  });

  grid.replaceChildren();

  if (filteredBundles.length === 0) {
    const empty = document.createElement("p");

    empty.className = "empty-state";
    empty.textContent = "No matching bundles found.";

    grid.appendChild(empty);
  }

  filteredBundles.forEach(bundle => {
    const card = document.createElement("button");

    card.type = "button";
    card.className = "bundle-card";

    if (
      selectedBundle &&
      selectedBundle.network === selectedNetwork &&
      selectedBundle.size === bundle.size
    ) {
      card.classList.add("selected");
    }

    const sizeElement = document.createElement("span");
    sizeElement.className = "bundle-size";
    sizeElement.textContent = bundle.size;

    const priceElement = document.createElement("span");
    priceElement.className = "bundle-price";
    priceElement.textContent = formatMoney(bundle.price);

    const labelElement = document.createElement("span");
    labelElement.className = "bundle-label";
    labelElement.textContent = "Select bundle";

    card.append(sizeElement, priceElement, labelElement);

    card.addEventListener("click", () => {
      if (!isNetworkAvailable(selectedNetwork)) {
        showMessage(
          "This network is currently unavailable.",
          "error"
        );

        return;
      }

      selectedBundle = {
        network: selectedNetwork,
        size: bundle.size,
        price: bundle.price
      };

      renderBundles();
      updateSelectedBundle();

      const checkout = getElement("checkout");

      if (checkout) {
        checkout.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });

    grid.appendChild(card);
  });

  const resultCount = getElement("resultCount");

  if (resultCount) {
    resultCount.textContent =
      filteredBundles.length +
      (filteredBundles.length === 1 ? " bundle" : " bundles") +
      " available";
  }
}

/* ==========================================
   UPDATE SELECTED BUNDLE
   ========================================== */

function updateSelectedBundle() {
  const name =
    getElement("selectedBundle") ||
    getElement("selectedName");

  const price = getElement("selectedPrice");
  const selectedNetworkInput = getElement("selectedNetwork");
  const selectedSizeInput = getElement("selectedSize");

  if (selectedBundle) {
    if (name) {
      name.textContent =
        selectedBundle.network + " " + selectedBundle.size;
    }

    if (price) {
      price.textContent = formatMoney(selectedBundle.price);
    }

    if (selectedNetworkInput) {
      selectedNetworkInput.value = selectedBundle.network;
    }

    if (selectedSizeInput) {
      selectedSizeInput.value = selectedBundle.size;
    }
  } else {
    if (name) {
      name.textContent = "Choose a bundle above";
    }

    if (price) {
      price.textContent = "GH₵0.00";
    }

    if (selectedSizeInput) {
      selectedSizeInput.value = "";
    }

    if (selectedNetworkInput) {
      selectedNetworkInput.value = selectedNetwork;
    }
  }
}

/* ==========================================
   CHECKOUT AND PAYSTACK
   ========================================== */

async function handleCheckout(event) {
  event.preventDefault();

  if (!selectedBundle) {
    showMessage(
      "Please select a data bundle first.",
      "error"
    );

    return;
  }

  /*
   * Final client-side protection.
   * The backend must also enforce availability.
   */
  if (!isNetworkAvailable(selectedBundle.network)) {
    showMessage(
      "This network is currently unavailable. Please select another network.",
      "error"
    );

    applyAvailableNetworks();
    return;
  }

  const phoneInput =
    getElement("customerPhone") ||
    getElement("recipientPhone");

  const emailInput = getElement("customerEmail");
  const paymentButton = getElement("paymentButton");

  if (!phoneInput) {
    showMessage("Phone number field is missing.", "error");
    return;
  }

  const phone = phoneInput.value.trim();
  const email = emailInput ? emailInput.value.trim() : "";

  if (!emailInput || !email) {
    showMessage("Please enter your email address.", "error");

    if (emailInput) {
      emailInput.focus();
    }

    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage("Please enter a valid email address.", "error");
    emailInput.focus();
    return;
  }

  if (!/^0\d{9}$/.test(phone)) {
    showMessage(
      "Enter a valid 10-digit Ghana phone number, e.g. 0241234567.",
      "error"
    );

    phoneInput.focus();
    return;
  }

  if (paymentButton) {
    paymentButton.disabled = true;
    paymentButton.textContent = "Connecting to Paystack...";
  }

  showMessage("Preparing your secure payment...");

  try {
    const response = await fetch(
      PAYMENT_API + "/initialize-payment",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          phone,
          email,
          network: selectedBundle.network,
          bundle: selectedBundle.size,
          amount: selectedBundle.price
        })
      }
    );

    let data;

    try {
      data = await response.json();
    } catch (_error) {
      throw new Error(
        "The payment server returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Unable to initialize payment."
      );
    }

    if (!data.authorization_url) {
      throw new Error(
        "Paystack did not return a payment link."
      );
    }

    showMessage(
      "Opening Paystack payment page...",
      "success"
    );

    window.location.assign(data.authorization_url);
  } catch (error) {
    console.error("Checkout error:", error);

    showMessage(
      error.message ||
      "Payment could not be started. Please try again.",
      "error"
    );

    if (paymentButton) {
      paymentButton.disabled = false;
      paymentButton.textContent = "Continue to Paystack";
    }
  }
}

/* ==========================================
   BUNDLE SEARCH
   ========================================== */

function initializeSearch() {
  const search = getElement("bundleSearch");

  if (!search) {
    return;
  }

  search.addEventListener("input", event => {
    searchText = event.target.value.trim();
    renderBundles();
  });
}

/* ==========================================
   MOBILE MENU
   ========================================== */

function initializeMobileMenu() {
  const menuButton = getElement("menuButton");
  const mobileMenu = getElement("mobileMenu");

  if (!menuButton || !mobileMenu) {
    return;
  }

  /*
   * Use the same display property as the HTML menu.
   * This avoids conflicts with another script toggling .open.
   */
  menuButton.addEventListener("click", () => {
    const isOpen = mobileMenu.style.display === "block";

    mobileMenu.style.display = isOpen ? "none" : "block";

    menuButton.setAttribute(
      "aria-expanded",
      isOpen ? "false" : "true"
    );

    menuButton.setAttribute(
      "aria-label",
      isOpen ? "Open menu" : "Close menu"
    );

    menuButton.textContent = isOpen ? "☰" : "✕";
  });

  mobileMenu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      mobileMenu.style.display = "none";
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open menu");
      menuButton.textContent = "☰";
    });
  });
}

/* ==========================================
   ANNOUNCEMENT POPUP
   ========================================== */

function applyAnnouncementFromSettings() {
  const dialog = getElement("announcement");
  const messageElement = getElement("announcementMessage");

  if (!dialog) {
    return;
  }

  const enabled =
    announcementSettings.enabled === true &&
    Boolean(announcementSettings.message);

  /*
   * If the owner switches announcements off, close and hide
   * the popup. Do not let this script reopen it.
   */
  if (!enabled) {
    if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
    }

    dialog.hidden = true;
    dialog.style.display = "none";

    return;
  }

  if (messageElement) {
    messageElement.textContent = announcementSettings.message;
  } else {
    const paragraph = dialog.querySelector("p");

    if (paragraph) {
      paragraph.textContent = announcementSettings.message;
    }
  }

  dialog.hidden = false;
  dialog.style.display = "";

  if (!announcementInitialized) {
    initializeAnnouncement();
  }
}

function initializeAnnouncement() {
  if (announcementInitialized) {
    return;
  }

  announcementInitialized = true;

  const dialog = getElement("announcement");
  const continueButton = getElement("continueShopping");
  const closeButton = getElement("closeAnnouncement");

  if (!dialog) {
    return;
  }

  function hasBeenSeen() {
    try {
      return (
        sessionStorage.getItem("kielmenAnnouncementSeen") === "true" ||
        sessionStorage.getItem("kielmenAnnouncementShown") === "yes"
      );
    } catch (_error) {
      return false;
    }
  }

  function markAsSeen() {
    try {
      sessionStorage.setItem("kielmenAnnouncementSeen", "true");
      sessionStorage.setItem("kielmenAnnouncementShown", "yes");
    } catch (_error) {}
  }

  function closeAnnouncement() {
    markAsSeen();

    if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.hidden = true;
      dialog.style.display = "none";
    }
  }

  if (continueButton) {
    continueButton.addEventListener(
      "click",
      closeAnnouncement
    );
  }

  if (closeButton) {
    closeButton.addEventListener(
      "click",
      closeAnnouncement
    );
  }

  /*
   * Never open the popup when the owner has disabled it.
   */
  if (
    announcementSettings.enabled !== true ||
    !announcementSettings.message
  ) {
    dialog.hidden = true;
    dialog.style.display = "none";
    return;
  }

  if (!hasBeenSeen()) {
    window.setTimeout(() => {
      if (
        announcementSettings.enabled !== true ||
        !announcementSettings.message ||
        hasBeenSeen()
      ) {
        return;
      }

      if (
        typeof dialog.showModal === "function" &&
        !dialog.open
      ) {
        try {
          dialog.showModal();
        } catch (_error) {
          dialog.style.display = "block";
        }
      } else if (typeof dialog.showModal !== "function") {
        dialog.style.display = "block";
      }

      markAsSeen();
    }, 500);
  }
}

/* ==========================================
   FOOTER YEAR
   ========================================== */

function initializeFooter() {
  const year = getElement("currentYear");

  if (year) {
    year.textContent = new Date().getFullYear();
  }
}

/* ==========================================
   CUSTOMER ORDER TRACKING
   ========================================== */

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[char];
  });
}

function initializeOrderTracking() {
  const form = getElement("trackOrderForm");

  if (!form || form.dataset.trackingInitialized === "yes") {
    return;
  }

  form.dataset.trackingInitialized = "yes";

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const phoneInput = getElement("trackPhone");
    const message = getElement("trackOrderMessage");
    const results = getElement("trackOrderResults");
    const button = getElement("trackOrderButton");

    if (!phoneInput || !message || !results || !button) {
      return;
    }

    const phone = phoneInput.value.trim().replace(/\D/g, "");

    message.textContent = "";
    results.replaceChildren();

    if (!/^0\d{9}$/.test(phone)) {
      message.textContent =
        "Enter a valid 10-digit Ghana phone number.";

      return;
    }

    button.disabled = true;
    button.textContent = "Checking...";

    try {
      const response = await fetch(
        PAYMENT_API +
          "/orders-by-phone/" +
          encodeURIComponent(phone),
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json"
          }
        }
      );

      let data;

      try {
        data = await response.json();
      } catch (_error) {
        throw new Error(
          "The server returned an invalid response."
        );
      }

      if (!response.ok || !data.success) {
        message.textContent =
          data.message ||
          "No orders found. Please check the number.";
        return;
      }

      if (!Array.isArray(data.orders) || data.orders.length === 0) {
        message.textContent =
          "No orders found for this phone number.";
        return;
      }

      results.innerHTML = data.orders.map(order => {
        const date = order.created_at
          ? new Date(order.created_at).toLocaleString(
              "en-GB",
              { timeZone: "Africa/Accra" }
            )
          : "Date unavailable";

        return `
          <div class="order-result">
            <p><strong>Order Date:</strong> ${escapeHTML(date)}</p>
            <p><strong>Reference:</strong> ${escapeHTML(order.reference || "")}</p>
            <p><strong>Network:</strong> ${escapeHTML(order.network || "")}</p>
            <p><strong>Bundle:</strong> ${escapeHTML(order.bundle || "")}</p>
            <p><strong>Amount:</strong> GH₵${Number(order.amount || 0).toFixed(2)}</p>
            <p><strong>Payment:</strong> ${escapeHTML(order.payment_status || "")}</p>
            <p><strong>Delivery:</strong> ${escapeHTML(order.delivery_status || "")}</p>
          </div>
        `;
      }).join("");
    } catch (error) {
      console.error("Order tracking error:", error);

      message.textContent =
        "Unable to check orders right now. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Find My Orders";
    }
  });
}

/* ==========================================
   INITIALIZE WEBSITE
   ========================================== */

function initializeWebsite() {
  /*
   * Attach network listeners only once.
   */
  document.querySelectorAll(".network-tab").forEach(tab => {
    if (tab.dataset.networkListenerAdded === "yes") {
      return;
    }

    tab.dataset.networkListenerAdded = "yes";

    tab.addEventListener("click", () => {
      if (tab.disabled || tab.hidden) {
        return;
      }

      selectNetwork(tab.dataset.network);
    });
  });

  const checkoutForm = getElement("checkoutForm");

  if (
    checkoutForm &&
    checkoutForm.dataset.checkoutListenerAdded !== "yes"
  ) {
    checkoutForm.dataset.checkoutListenerAdded = "yes";

    checkoutForm.addEventListener("submit", handleCheckout);
  }

  initializeSearch();
  initializeMobileMenu();
  initializeFooter();
  initializeOrderTracking();

  /*
   * Start with MTN unless it has been disabled.
   */
  const firstNetwork = getFirstAvailableNetwork();

  if (firstNetwork) {
    selectNetwork(firstNetwork);
  } else {
    applyAvailableNetworks();
  }

  /*
   * Load settings after the page has initialized.
   * Failure to load settings does not stop the page.
   */
  loadPublicWebsiteSettings();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeWebsite,
    { once: true }
  );
} else {
  initializeWebsite();
  }
