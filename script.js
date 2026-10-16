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

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

function formatMoney(amount) {
  return "GH₵" + Number(amount).toFixed(2);
}

function getElement(id) {
  return document.getElementById(id);
}

function showMessage(message, type = "info") {
  const element = getElement("checkoutMessage");

  if (!element) {
    alert(message);
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

/* ==========================================
   NETWORK SELECTION
   ========================================== */

function selectNetwork(network) {
  const normalized = String(network)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  if (!PRODUCTS[normalized]) {
    return;
  }

  selectedNetwork = normalized;
  selectedBundle = null;

  document.querySelectorAll(".network-tab").forEach((tab) => {
    const tabNetwork = String(
      tab.dataset.network || tab.textContent
    )
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

    const active =
      tabNetwork === selectedNetwork ||
      (selectedNetwork === "AIRTELTIGO" &&
        tabNetwork.includes("AIRTEL"));

    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  renderBundles();
  updateSelectedBundle();
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

  const bundles = PRODUCTS[selectedNetwork] || [];

  const filteredBundles = bundles.filter((bundle) => {
    const text = (
      bundle.size + " " + formatMoney(bundle.price)
    ).toLowerCase();

    return text.includes(searchText.toLowerCase());
  });

  grid.innerHTML = "";

  if (filteredBundles.length === 0) {
    grid.innerHTML =
      '<p class="empty-state">No matching bundles found.</p>';
  }

  filteredBundles.forEach((bundle) => {
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

    card.innerHTML = `
      <span class="bundle-size"></span>
      <span class="bundle-price"></span>
      <span class="bundle-label">Select bundle</span>
    `;

    card.querySelector(".bundle-size").textContent = bundle.size;
    card.querySelector(".bundle-price").textContent =
      formatMoney(bundle.price);

    card.addEventListener("click", () => {
  selectedBundle = {
    network: selectedNetwork,
    size: bundle.size,
    price: bundle.price
  };

  renderBundles();
  updateSelectedBundle();

  const checkout = document.getElementById("checkout");

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
      (filteredBundles.length === 1 ? " bundle" : " bundles");
  }
}

/* ==========================================
   UPDATE SELECTED BUNDLE
   ========================================== */

function updateSelectedBundle() {
  const name = getElement("selectedName");
  const price = getElement("selectedPrice");
  const checkout = getElement("checkout");

  if (selectedBundle) {
    if (name) {
      name.textContent =
        selectedBundle.network + " " + selectedBundle.size;
    }

    if (price) {
      price.textContent = formatMoney(selectedBundle.price);
    }

    if (checkout) {
      checkout.style.display = "";
    }
  } else {
    if (name) {
      name.textContent = "No bundle selected";
    }

    if (price) {
      price.textContent = "GH₵0.00";
    }
  }
}

/* ==========================================
   CHECKOUT AND PAYSTACK
   ========================================== */

async function handleCheckout(event) {
  event.preventDefault();

  if (!selectedBundle) {
    showMessage("Please select a data bundle first.", "error");
    return;
  }

  
  const phoneInput = getElement("recipientPhone");
const paymentButton = getElement("paymentButton");

if (!phoneInput) {
  showMessage("Phone number field is missing.", "error");
  return;
}

const phone = phoneInput.value.trim();

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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
  phone: phone,
  network: selectedBundle.network,
  bundle: selectedBundle.size,
  amount: selectedBundle.price
})
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("The payment server returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Unable to initialize payment."
      );
    }

    if (!data.authorization_url) {
      throw new Error("Paystack did not return a payment link.");
    }

    showMessage("Opening Paystack payment page...", "success");

    window.location.href = data.authorization_url;

  } catch (error) {
    console.error("Checkout error:", error);

    showMessage(
      error.message ||
      "Payment could not be started. Please try again.",
      "error"
    );

    if (paymentButton) {
      paymentButton.disabled = false;
      paymentButton.textContent = "Pay Now";
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

  search.addEventListener("input", (event) => {
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

  menuButton.addEventListener("click", () => {
    const isOpen =
      mobileMenu.classList.toggle("open");

    menuButton.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );
  });

  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    });
  });
}

/* ==========================================
   WHATSAPP ANNOUNCEMENT POPUP
   ========================================== */

function initializeAnnouncement() {
  const announcement = getElement("announcement");
  const closeButton = getElement("closeAnnouncement");
  const continueButton = getElement("continueShopping");

  if (!announcement) {
    return;
  }

  function closeAnnouncement() {
    try {
      sessionStorage.setItem(
        "kielmenAnnouncementSeen",
        "true"
      );
    } catch (error) {
      console.warn("Could not save popup preference.");
    }

    if (typeof announcement.close === "function") {
      if (announcement.open) {
        announcement.close();
      }
    } else {
      announcement.style.display = "none";
    }
  }

  if (closeButton) {
    closeButton.addEventListener(
      "click",
      closeAnnouncement
    );
  }

  if (continueButton) {
    continueButton.addEventListener(
      "click",
      closeAnnouncement
    );
  }

  let alreadySeen = false;

  try {
    alreadySeen =
      sessionStorage.getItem(
        "kielmenAnnouncementSeen"
      ) === "true";
  } catch (error) {
    console.warn("Could not read popup preference.");
  }

  if (!alreadySeen) {
    window.setTimeout(() => {
      if (
        typeof announcement.showModal === "function" &&
        !announcement.open
      ) {
        announcement.showModal();
      } else if (
        typeof announcement.showModal !== "function"
      ) {
        announcement.style.display = "block";
      }
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
   INITIALIZE WEBSITE
   ========================================== */

function initializeWebsite() {
  document.querySelectorAll(".network-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const network = tab.dataset.network || tab.textContent;
      selectNetwork(network);
    });
  });

  const checkoutForm = getElement("checkoutForm");

  if (checkoutForm) {
    checkoutForm.addEventListener(
      "submit",
      handleCheckout
    );
  }

  initializeSearch();
  initializeMobileMenu();
  initializeAnnouncement();
  initializeFooter();

  selectNetwork("MTN");
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeWebsite
  );
} else {
  initializeWebsite();
   }
