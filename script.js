"use strict";

/* ==========================================
   KIELMEN 636 DATAPLUG
   CUSTOMER WEBSITE SCRIPT
   NETWORK-COLOURED BUNDLE CARDS
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
let checkoutInProgress = false;
let settingsLoaded = false;

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

function getElement(id) {
  return document.getElementById(id);
}

function formatMoney(amount) {
  const number = Number(amount);

  return "GH₵" + (
    Number.isFinite(number) ? number : 0
  ).toFixed(2);
}

function showMessage(message, type = "info") {
  const element = getElement("checkoutMessage");

  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.style.display = "block";

  if (type === "error") {
    element.style.color = "#b91c1c";
    element.style.backgroundColor = "#fef2f2";
  } else if (type === "success") {
    element.style.color = "#166534";
    element.style.backgroundColor = "#f0fdf4";
  } else {
    element.style.color = "#000000";
    element.style.backgroundColor = "#f3f4f6";
  }
}

function normalizeNetwork(value) {
  const network = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  if (network.includes("MTN")) return "MTN";

  if (
    network.includes("TELECEL") ||
    network.includes("VODAFONE")
  ) {
    return "TELECEL";
  }

  if (
    network.includes("AIRTELTIGO") ||
    network === "AIRTEL" ||
    network === "TIGO"
  ) {
    return "AIRTELTIGO";
  }

  return network;
}

function formatNetworkName(network) {
  const normalized = normalizeNetwork(network);

  if (normalized === "AIRTELTIGO") return "AirtelTigo";
  if (normalized === "TELECEL") return "Telecel";

  return normalized;
}

function isNetworkAvailable(network) {
  const key = normalizeNetwork(network);

  return (
    Object.prototype.hasOwnProperty.call(PRODUCTS, key) &&
    networkAvailability[key] !== false
  );
}

function getFirstAvailableNetwork() {
  return Object.keys(PRODUCTS).find(isNetworkAvailable) || null;
}

function getNetworkClass(network) {
  const normalized = normalizeNetwork(network);

  if (normalized === "MTN") return "mtn";
  if (normalized === "TELECEL") return "telecel";
  if (normalized === "AIRTELTIGO") return "airteltigo";

  return "";
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
        "Website settings request failed: HTTP " +
        response.status
      );
    }

    const result = await response.json();

    if (!result.success || !result.settings) {
      throw new Error(
        "Website settings were not returned."
      );
    }

    const settings = result.settings;

    /*
     * Only an explicit false disables a network.
     * Missing settings do not disable a network.
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

    settingsLoaded = true;

    applyAvailableNetworks();
    applyAnnouncementFromSettings();

    console.log("Website settings loaded successfully.");
  } catch (error) {
    console.warn(
      "Could not load website settings. Using default network availability.",
      error
    );

    /*
     * Fail safely on the public page.
     * The backend must still enforce its own availability rules.
     */
    networkAvailability = {
      MTN: true,
      TELECEL: true,
      AIRTELTIGO: true
    };

    settingsLoaded = false;

    applyAvailableNetworks();
    applyAnnouncementFromSettings();
  }
}

/* ==========================================
   NETWORK TAB SELECTION
   ========================================== */

function selectNetwork(network) {
  const normalized = normalizeNetwork(network);

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
    const tabNetwork = normalizeNetwork(
      tab.dataset.network || tab.textContent
    );

    const active = tabNetwork === normalized;

    tab.classList.toggle("active", active);

    tab.setAttribute(
      "aria-selected",
      active ? "true" : "false"
    );
  });

  renderBundles();
  updateSelectedBundle();

  const message = getElement("checkoutMessage");

  if (message) {
    message.textContent = "";
    message.style.display = "none";
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
    const network = normalizeNetwork(tab.dataset.network);

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
      tab.setAttribute("aria-selected", "false");
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
      resultCount.textContent =
        "No networks currently available.";
    }

    if (paymentButton) {
      paymentButton.disabled = true;
    }

    updateSelectedBundle();

    return;
  }

  /*
   * Switch only if the current network is no longer available.
   */
  if (!isNetworkAvailable(selectedNetwork)) {
    selectNetwork(availableNetwork);
    return;
  }

  const activeTab = tabs.find(tab =>
    normalizeNetwork(tab.dataset.network) === selectedNetwork &&
    !tab.disabled &&
    !tab.hidden
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

  const network = normalizeNetwork(selectedNetwork);
  const networkClass = getNetworkClass(network);

  /*
   * Add the network class to the grid so the stylesheet
   * can apply the right colours to every bundle card.
   */
  grid.classList.remove("mtn", "telecel", "airteltigo");

  if (networkClass) {
    grid.classList.add(networkClass);
  }

  grid.dataset.network = network;

  if (!isNetworkAvailable(network)) {
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

  const bundles = PRODUCTS[network] || [];

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

    /*
     * These identifiers connect the network to the CSS.
     * This is the important fix for network-coloured boxes.
     */
    card.dataset.network = network;
    card.dataset.bundle = bundle.size;
    card.classList.add(networkClass);

    card.setAttribute(
      "aria-label",
      network + " " + bundle.size + " for " +
      formatMoney(bundle.price)
    );

    card.setAttribute(
      "aria-pressed",
      String(
        Boolean(
          selectedBundle &&
          selectedBundle.network === network &&
          selectedBundle.size === bundle.size
        )
      )
    );

    const isSelected =
      selectedBundle &&
      selectedBundle.network === network &&
      selectedBundle.size === bundle.size;

    if (isSelected) {
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
    labelElement.textContent = isSelected
      ? "Selected ✓"
      : "Select bundle";

    card.append(
      sizeElement,
      priceElement,
      labelElement
    );

    card.addEventListener("click", () => {
      if (!isNetworkAvailable(network)) {
        showMessage(
          "This network is currently unavailable.",
          "error"
        );

        return;
      }

      selectedBundle = {
        network,
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
      (
        filteredBundles.length === 1
          ? " bundle available"
          : " bundles available"
      );
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
  const paymentButton = getElement("paymentButton");

  if (selectedBundle) {
    if (name) {
      name.textContent =
        formatNetworkName(selectedBundle.network) +
        " " +
        selectedBundle.size;
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

    if (paymentButton && !checkoutInProgress) {
      paymentButton.disabled = false;
      paymentButton.textContent = "Continue to Paystack";
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

    if (paymentButton && !checkoutInProgress) {
      paymentButton.disabled = true;
      paymentButton.textContent = "Select a Bundle First";
    }
  }
}

/* ==========================================
   CHECKOUT AND PAYSTACK
   ========================================== */

async function handleCheckout(event) {
  event.preventDefault();

  if (checkoutInProgress) {
    return;
  }

  if (!selectedBundle) {
    showMessage(
      "Please select a data bundle first.",
      "error"
    );

    return;
  }

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
  const email = emailInput
    ? emailInput.value.trim()
    : "";

  if (!emailInput || !email) {
    showMessage(
      "Please enter your email address.",
      "error"
    );

    if (emailInput) {
      emailInput.focus();
    }

    return;
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    showMessage(
      "Please enter a valid email address.",
      "error"
    );

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

  const confirmed = window.confirm(
    "Please confirm your order:\n\n" +
    "Network: " + formatNetworkName(selectedBundle.network) + "\n" +
    "Bundle: " + selectedBundle.size + "\n" +
    "Amount: " + formatMoney(selectedBundle.price) + "\n" +
    "Recipient: " + phone + "\n\n" +
    "Continue to payment?"
  );

  if (!confirmed) {
    return;
  }

  checkoutInProgress = true;

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

          /*
           * The server must calculate and verify the amount
           * from its own approved price list. This amount is
           * informational only and must not be trusted by
           * the backend as proof of the correct price.
           */
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

    /*
     * Require HTTPS and a recognised Paystack checkout host.
     */
    let paymentURL;

    try {
      paymentURL = new URL(data.authorization_url);
    } catch (_error) {
      throw new Error(
        "The payment server returned an invalid checkout link."
      );
    }

    const host = paymentURL.hostname.toLowerCase();

    const isPaystackHost =
      host === "paystack.com" ||
      host.endsWith(".paystack.com");

    if (
      paymentURL.protocol !== "https:" ||
      !isPaystackHost
    ) {
      throw new Error(
        "The payment link is not a recognised secure Paystack URL."
      );
    }

    showMessage(
      "Opening Paystack payment page...",
      "success"
    );

    window.location.assign(paymentURL.href);
  } catch (error) {
    console.error("Checkout error:", error);

    showMessage(
      error.message ||
      "Payment could not be started. Please try again.",
      "error"
    );

    checkoutInProgress = false;

    if (paymentButton) {
      paymentButton.disabled = !selectedBundle;
      paymentButton.textContent = selectedBundle
        ? "Continue to Paystack"
        : "Select a Bundle First";
    }
  }
}

/* ==========================================
   BUNDLE SEARCH
   ========================================== */

function initializeSearch() {
  const search = getElement("bundleSearch");

  if (!search || search.dataset.searchInitialized === "yes") {
    return;
  }

  search.dataset.searchInitialized = "yes";

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

  if (menuButton.dataset.menuInitialized === "yes") {
    return;
  }

  menuButton.dataset.menuInitialized = "yes";

  /*
   * Use the stylesheet's .open class rather than setting
   * display styles that can conflict with responsive CSS.
   */
  mobileMenu.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open menu");

  menuButton.addEventListener("click", () => {
    const isOpen = mobileMenu.classList.toggle("open");

    menuButton.setAttribute(
      "aria-expanded",
      String(isOpen)
    );

    menuButton.setAttribute(
      "aria-label",
      isOpen ? "Close menu" : "Open menu"
    );

    menuButton.textContent = isOpen ? "✕" : "☰";
  });

  mobileMenu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
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

  if (!enabled) {
    if (
      dialog.open &&
      typeof dialog.close === "function"
    ) {
      dialog.close();
    }

    dialog.hidden = true;
    dialog.style.display = "none";

    return;
  }

  if (messageElement) {
    messageElement.textContent =
      announcementSettings.message;
  } else {
    const paragraph = dialog.querySelector("p");

    if (paragraph) {
      paragraph.textContent =
        announcementSettings.message;
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
      sessionStorage.setItem(
        "kielmenAnnouncementSeen",
        "true"
      );

      sessionStorage.setItem(
        "kielmenAnnouncementShown",
        "yes"
      );
    } catch (_error) {}
  }

  function closeAnnouncement() {
    markAsSeen();

    if (
      dialog.open &&
      typeof dialog.close === "function"
    ) {
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
      } else if (
        typeof dialog.showModal !== "function"
      ) {
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

  if (
    !form ||
    form.dataset.trackingInitialized === "yes"
  ) {
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

    const phone = phoneInput.value
      .trim()
      .replace(/\D/g, "");

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

      if (
        !Array.isArray(data.orders) ||
        data.orders.length === 0
      ) {
        message.textContent =
          "No orders found for this phone number.";

        return;
      }

      message.textContent =
        data.orders.length +
        (data.orders.length === 1
          ? " order found."
          : " orders found.");

      data.orders.forEach(order => {
        const card = document.createElement("div");
        card.className = "order-result";

        const date = order.created_at
          ? new Date(order.created_at).toLocaleString(
              "en-GB",
              { timeZone: "Africa/Accra" }
            )
          : "Date unavailable";

        const fields = [
          ["Order Date", date],
          ["Reference", order.reference || ""],
          ["Network", formatNetworkName(order.network || "")],
          ["Bundle", order.bundle || ""],
          ["Amount", formatMoney(order.amount || 0)],
          ["Payment", order.payment_status || ""],
          ["Delivery", order.delivery_status || ""]
        ];

        fields.forEach(([label, value]) => {
          const paragraph = document.createElement("p");
          const strong = document.createElement("strong");

          strong.textContent = label + ": ";

          paragraph.appendChild(strong);
          paragraph.appendChild(
            document.createTextNode(String(value))
          );

          card.appendChild(paragraph);
        });

        results.appendChild(card);
      });
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
   * Network buttons.
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

  /*
   * Checkout form.
   */
  const checkoutForm = getElement("checkoutForm");

  if (
    checkoutForm &&
    checkoutForm.dataset.checkoutListenerAdded !== "yes"
  ) {
    checkoutForm.dataset.checkoutListenerAdded = "yes";

    checkoutForm.addEventListener(
      "submit",
      handleCheckout
    );
  }

  initializeSearch();
  initializeMobileMenu();
  initializeFooter();
  initializeOrderTracking();

  /*
   * Render the initial store immediately so the page
   * remains interactive while public settings load.
   */
  try {
    const firstNetwork = getFirstAvailableNetwork();

    if (firstNetwork) {
      selectNetwork(firstNetwork);
    } else {
      applyAvailableNetworks();
    }
  } catch (error) {
    console.error(
      "Network initialization error:",
      error
    );

    selectedNetwork = "MTN";
    renderBundles();
    updateSelectedBundle();
  }

  /*
   * Load owner-controlled settings without blocking
   * initial page rendering.
   */
  try {
    Promise.resolve(
      loadPublicWebsiteSettings()
    ).catch(error => {
      console.error(
        "Website settings could not load:",
        error
      );
    });
  } catch (error) {
    console.error(
      "Website settings error:",
      error
    );
  }
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
