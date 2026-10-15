"use strict";

/* ==========================================
   KIELMEN 636 DATAPLUG
   CUSTOMER SHOPPING AND CHECKOUT
   ========================================== */

/*
 * Customer-facing prices.
 * Confirm these prices before accepting orders.
 *
 * IMPORTANT:
 * The backend must independently validate the
 * official price before initializing payment.
 */

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

  Telecel: [
    { size: "10GB", price: 45.00 },
    { size: "15GB", price: 62.00 },
    { size: "20GB", price: 82.00 },
    { size: "25GB", price: 101.00 },
    { size: "30GB", price: 124.00 },
    { size: "40GB", price: 170.00 },
    { size: "50GB", price: 210.00 },
    { size: "100GB", price: 420.00 }
  ],

  AirtelTigo: [
    { size: "1GB", price: 5.00 },
    { size: "2GB", price: 9.20 },
    { size: "5GB", price: 22.00 },
    { size: "10GB", price: 41.00 },
    { size: "20GB", price: 78.00 },
    { size: "30GB", price: 115.00 },
    { size: "50GB", price: 188.00 }
  ]
};

const PAYMENT_API =
  "https://kielmen-dataplug-payment-api.onrender.com";

const WHATSAPP_CHANNEL =
  "https://whatsapp.com/channel/0029Vb9DCHl8aKvAqvYV743S";

const WHATSAPP_CONTACT =
  "https://wa.me/233533878548";

let selectedNetwork = "MTN";
let selectedBundle = null;
let checkoutInProgress = false;

/* ==========================================
   HELPERS
   ========================================== */

function getElement(id) {
  return document.getElementById(id);
}

function money(amount) {
  return "GH₵" +
    Number(amount).toFixed(2).replace(/\.00$/, "");
}

function showMessage(message, type = "error") {
  const element = getElement("checkoutMessage");

  if (!element) return;

  element.textContent = message;
  element.className = "status show " + type;
}

function clearMessage() {
  const element = getElement("checkoutMessage");

  if (!element) return;

  element.textContent = "";
  element.className = "status";
}

function updateSelectedBundle() {
  const name = getElement("selectedName");
  const price = getElement("selectedPrice");

  if (!name || !price) return;

  if (!selectedBundle) {
    name.textContent = "No bundle selected";
    price.textContent = "Choose a bundle above.";
    return;
  }

  name.textContent =
    selectedBundle.network + " " + selectedBundle.size;

  price.textContent =
    "Total: " + money(selectedBundle.price);
}

/* ==========================================
   NETWORK SELECTION
   ========================================== */

function setNetwork(network) {
  if (!Object.prototype.hasOwnProperty.call(PRODUCTS, network)) {
    return;
  }

  selectedNetwork = network;
  selectedBundle = null;

  document.querySelectorAll(".network-tab").forEach(button => {
    const active = button.dataset.network === network;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  updateSelectedBundle();
  clearMessage();
  renderBundles();
}

/* ==========================================
   BUNDLE DISPLAY
   ========================================== */

function renderBundles() {
  const grid = getElement("bundleGrid");
  const search = getElement("bundleSearch");
  const resultCount = getElement("resultCount");

  if (!grid) return;

  const query = search
    ? search.value.trim().toLowerCase()
    : "";

  const bundles = (PRODUCTS[selectedNetwork] || []).filter(bundle => {
    const searchable = (
      selectedNetwork + " " +
      bundle.size + " " +
      bundle.price
    ).toLowerCase();

    return searchable.includes(query);
  });

  if (resultCount) {
    resultCount.textContent =
      bundles.length +
      " bundles available for " +
      selectedNetwork;
  }

  grid.replaceChildren();

  if (bundles.length === 0) {
    const empty = document.createElement("div");

    empty.className = "empty-state";
    empty.textContent = "No matching bundles found.";

    grid.appendChild(empty);
    return;
  }

  bundles.forEach(bundle => {
    const card = document.createElement("article");

    card.className = "bundle-card";
    card.dataset.network = selectedNetwork;

    const main = document.createElement("div");
    main.className = "bundle-main";

    const network = document.createElement("div");
    network.className = "bundle-network";

    const networkLabels = {
      MTN: "🟡 MTN",
      Telecel: "🔴 TELECEL",
      AirtelTigo: "🔵 AIRTELTIGO"
    };

    network.textContent = networkLabels[selectedNetwork];

    const size = document.createElement("div");
    size.className = "bundle-size";
    size.textContent = bundle.size;

    const description = document.createElement("div");
    description.className = "bundle-description";
    description.textContent = "Data Bundle";

    main.append(network, size, description);

    const footer = document.createElement("div");
    footer.className = "bundle-footer";

    const price = document.createElement("div");
    price.className = "bundle-price";
    price.textContent = money(bundle.price);

    const buyButton = document.createElement("button");

    buyButton.type = "button";
    buyButton.className = "buy-button";
    buyButton.textContent = "Buy Now";

    buyButton.addEventListener("click", () => {
      selectedBundle = {
        network: selectedNetwork,
        size: bundle.size,
        price: bundle.price
      };

      updateSelectedBundle();
      clearMessage();

      const checkout = getElement("checkout");

      if (checkout) {
        checkout.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });

    footer.append(price, buyButton);
    card.append(main, footer);

    grid.appendChild(card);
  });
}

/* ==========================================
   NETWORK BUTTON EVENTS
   ========================================== */

function initialiseNetworkButtons() {
  document.querySelectorAll(".network-tab").forEach(button => {
    button.addEventListener("click", () => {
      setNetwork(button.dataset.network);
    });
  });
}

/* ==========================================
   CUSTOMER CHECKOUT
   ========================================== */

function normalizePhone(phone) {
  return phone.replace(/[\s()-]/g, "");
}

function isValidGhanaPhone(phone) {
  return /^(?:\+233|233|0)\d{9}$/.test(phone);
}

async function submitCheckout(event) {
  event.preventDefault();

  if (checkoutInProgress) return;

  clearMessage();

  if (!selectedBundle) {
    showMessage("Please select a data bundle first.");
    return;
  }

  const emailInput = getElement("customerEmail");
  const phoneInput = getElement("recipientPhone");
  const paymentButton = getElement("paymentButton");

  if (!emailInput || !phoneInput || !paymentButton) {
    showMessage("The checkout form is incomplete.");
    return;
  }

  const email = emailInput.value.trim();
  const phone = normalizePhone(phoneInput.value.trim());

  const emailValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!emailValid) {
    showMessage("Please enter a valid email address.");
    emailInput.focus();
    return;
  }

  if (!isValidGhanaPhone(phone)) {
    showMessage(
      "Enter a valid Ghanaian phone number, e.g. 0241234567."
    );

    phoneInput.focus();
    return;
  }

  checkoutInProgress = true;
  paymentButton.disabled = true;
  paymentButton.textContent = "Connecting to Payment...";

  try {
    const response = await fetch(
      PAYMENT_API + "/initialize-payment",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          email: email,
          phone: phone,
          network: selectedBundle.network,
          bundle: selectedBundle.size,

          /*
           * The server must verify this amount against
           * its own price list. Do not trust browser prices.
           */
          amount: selectedBundle.price
        })
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The payment server returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Unable to start payment. Please try again."
      );
    }

    if (
      !data.authorization_url ||
      !data.authorization_url.startsWith(
        "https://checkout.paystack.com/"
      )
    ) {
      throw new Error(
        "A valid Paystack checkout link was not returned."
      );
    }

    window.location.assign(data.authorization_url);

  } catch (error) {
    showMessage(
      error.message ||
      "Connection failed. Please try again."
    );

    checkoutInProgress = false;
    paymentButton.disabled = false;
    paymentButton.textContent = "Proceed to Payment";
  }
}

function initialiseCheckout() {
  const form = getElement("checkoutForm");

  if (!form) return;

  form.addEventListener("submit", submitCheckout);
}

/* ==========================================
   MOBILE MENU
   ========================================== */

function initialiseMenu() {
  const menuButton = getElement("menuButton");
  const mobileMenu = getElement("mobileMenu");

  if (!menuButton || !mobileMenu) return;

  menuButton.addEventListener("click", () => {
    const opened = mobileMenu.classList.toggle("open");

    menuButton.setAttribute(
      "aria-expanded",
      String(opened)
    );

    menuButton.textContent = opened ? "✕" : "☰";
  });

  mobileMenu.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");

      menuButton.setAttribute("aria-expanded", "false");
      menuButton.textContent = "☰";
    });
  });
}

/* ==========================================
   WHATSAPP ANNOUNCEMENT POPUP
   ========================================== */

function closeAnnouncement() {
  const dialog = getElement("announcement");

  if (dialog && dialog.open) {
    dialog.close();
  }

  try {
    sessionStorage.setItem(
      "kielmenAnnouncementSeen",
      "yes"
    );
  } catch (_) {
    // Popup can still close if storage is unavailable.
  }
}

function initialiseAnnouncement() {
  const dialog = getElement("announcement");
  const closeButton = getElement("closeAnnouncement");
  const continueButton = getElement("continueShopping");

  if (!dialog) return;

  if (closeButton) {
    closeButton.addEventListener("click", closeAnnouncement);
  }

  if (continueButton) {
    continueButton.addEventListener("click", () => {
      closeAnnouncement();

      const shop = getElement("shop");

      if (shop) {
        shop.scrollIntoView({
          behavior: "smooth"
        });
      }
    });
  }

  let alreadySeen = false;

  try {
    alreadySeen =
      sessionStorage.getItem("kielmenAnnouncementSeen") === "yes";
  } catch (_) {
    alreadySeen = false;
  }

  if (!alreadySeen && typeof dialog.showModal === "function") {
    window.setTimeout(() => {
      if (!dialog.open) {
        dialog.showModal();
      }
    }, 500);
  }
}

/* ==========================================
   FOOTER YEAR
   ========================================== */

function updateFooterYear() {
  const year = getElement("currentYear");

  if (year) {
    year.textContent = new Date().getFullYear();
  }
}

/* ==========================================
   INITIALISE THE WEBSITE
   ========================================== */

function initialiseKielmenWebsite() {
  initialiseNetworkButtons();
  initialiseCheckout();
  initialiseMenu();
  initialiseAnnouncement();
  updateFooterYear();

  renderBundles();
  updateSelectedBundle();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initialiseKielmenWebsite
  );
} else {
  initialiseKielmenWebsite();
}
