"use strict";

/* =========================================================
KIELMEN 636 DATAPLUG
CUSTOMER WEBSITE SCRIPT
Compatible with the current index.html
========================================================= */

const PAYMENT_API =
"https://kielmen-dataplug-payment-api.onrender.com";

/* =========================================================
CUSTOMER-FACING PRICES
The backend must independently validate every price.
========================================================= */

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

/* =========================================================
WEBSITE STATE
========================================================= */

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

let checkoutInProgress = false;
let trackingInProgress = false;
let settingsLoaded = false;
let menuInitialized = false;
let announcementInitialized = false;
let announcementDismissed = false;
let navigationInitialized = false;

/* =========================================================
HELPERS
========================================================= */

function getElement(id) {
return document.getElementById(id);
}

function formatMoney(amount) {
const number = Number(amount);

return "GH₵" +
(Number.isFinite(number) ? number : 0).toFixed(2);
}

function normalizeNetwork(value) {
const network = String(value || "")
.toUpperCase()
.replace(/[^A-Z]/g, "");

if (network.includes("MTN")) {
return "MTN";
}

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
if (normalized === "MTN") return "MTN";

return normalized;
}

function getNetworkClass(network) {
const normalized = normalizeNetwork(network);

if (normalized === "MTN") return "mtn";
if (normalized === "TELECEL") return "telecel";
if (normalized === "AIRTELTIGO") return "airteltigo";

return "";
}

function isNetworkAvailable(network) {
const normalized = normalizeNetwork(network);

return Boolean(
PRODUCTS[normalized] &&
networkAvailability[normalized] !== false
);
}

function getFirstAvailableNetwork() {
return Object.keys(PRODUCTS).find(isNetworkAvailable) || null;
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
type === "error" ? "#b91c1c" :
type === "success" ? "#166534" :
"#111827";

element.style.backgroundColor =
type === "error" ? "#fef2f2" :
type === "success" ? "#f0fdf4" :
"#f3f4f6";
}

function clearMessage() {
const element = getElement("checkoutMessage");

if (element) {
element.textContent = "";
element.style.display = "none";
}
}

function normalizeGhanaPhone(value) {
let phone = String(value || "")
.trim()
.replace(/[\s()-]/g, "");

if (phone.startsWith("+233")) {
phone = "0" + phone.slice(4);
} else if (phone.startsWith("233")) {
phone = "0" + phone.slice(3);
}

return phone;
}

function isValidGhanaPhone(value) {
return /^0\d{9}$/.test(normalizeGhanaPhone(value));
}

function safeSessionGet(key) {
try {
return sessionStorage.getItem(key);
} catch (_) {
return null;
}
}

function safeSessionSet(key, value) {
try {
sessionStorage.setItem(key, value);
} catch (_) {}
}

async function readJSONResponse(response) {
try {
return await response.json();
} catch (_) {
throw new Error(
"The server returned an invalid response. Please try again."
);
}
}

/* =========================================================
LOAD PUBLIC WEBSITE SETTINGS
========================================================= */

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

const result = await readJSONResponse(response);

if (!response.ok || !result.success || !result.settings) {
  throw new Error(
    result.message ||
    "Website settings could not be loaded."
  );
}

const settings = result.settings;
const availability = settings.networkAvailability || {};

networkAvailability = {
  MTN: availability.MTN !== false,
  TELECEL: availability.TELECEL !== false,
  AIRTELTIGO: availability.AIRTELTIGO !== false
};

announcementSettings = {
  enabled: settings.announcementEnabled === true,
  message: String(settings.announcement || "").trim()
};

settingsLoaded = true;

applyAvailableNetworks();
applyAnnouncementFromSettings();

console.log("Public website settings loaded.");

} catch (error) {
console.warn(
"Could not load public website settings. Using default settings.",
error
);

/*
 * The page stays usable if the settings request fails.
 * The backend must still enforce network availability
 * and approved prices during payment initialization.
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

/* =========================================================
NETWORK TABS
========================================================= */

function updateNetworkTabStates() {
document.querySelectorAll(".network-tab[data-network]").forEach(tab => {
const network = normalizeNetwork(tab.dataset.network);
const available = isNetworkAvailable(network);
const active = available && network === selectedNetwork;

tab.hidden = !available;
tab.disabled = !available;

tab.classList.toggle("active", active);

tab.setAttribute("aria-disabled", String(!available));
tab.setAttribute("aria-selected", String(active));

});
}

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

const networkInput = getElement("selectedNetwork");

if (networkInput) {
networkInput.value = normalized;
}

updateNetworkTabStates();
renderBundles();
updateSelectedBundle();
clearMessage();
}

function applyAvailableNetworks() {
updateNetworkTabStates();

const availableNetwork = getFirstAvailableNetwork();
const grid = getElement("bundleGrid");
const resultCount = getElement("resultCount");

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

updateSelectedBundle();
return;

}

if (!isNetworkAvailable(selectedNetwork)) {
selectedNetwork = availableNetwork;
selectedBundle = null;
}

updateNetworkTabStates();
renderBundles();
updateSelectedBundle();
}

/* =========================================================
BUNDLE DISPLAY
========================================================= */

function renderBundles() {
const grid = getElement("bundleGrid");

if (!grid) {
console.error("The HTML element #bundleGrid was not found.");
return;
}

const network = normalizeNetwork(selectedNetwork);
const networkClass = getNetworkClass(network);

grid.replaceChildren();

grid.classList.remove("mtn", "telecel", "airteltigo");

if (networkClass) {
grid.classList.add(networkClass);
}

grid.dataset.network = network;

const resultCount = getElement("resultCount");

if (!isNetworkAvailable(network)) {
const notice = document.createElement("p");
notice.className = "empty-state";
notice.textContent = "This network is temporarily unavailable.";

grid.appendChild(notice);

if (resultCount) {
  resultCount.textContent = "Network unavailable.";
}

return;

}

const bundles = PRODUCTS[network] || [];

const filteredBundles = bundles.filter(bundle => {
const searchContent = (
bundle.size + " " + formatMoney(bundle.price)
).toLowerCase();

return searchContent.includes(searchText.toLowerCase());

});

if (!filteredBundles.length) {
const empty = document.createElement("p");
empty.className = "empty-state";
empty.textContent = "No matching bundles found.";

grid.appendChild(empty);

}

filteredBundles.forEach(bundle => {
const card = document.createElement("button");

card.type = "button";
card.className = "bundle-card";
card.dataset.network = network;
card.dataset.bundle = bundle.size;

if (networkClass) {
  card.classList.add(networkClass);
}

const isSelected = Boolean(
  selectedBundle &&
  selectedBundle.network === network &&
  selectedBundle.size === bundle.size
);

card.classList.toggle("selected", isSelected);
card.setAttribute("aria-pressed", String(isSelected));

card.setAttribute(
  "aria-label",
  formatNetworkName(network) + " " +
  bundle.size + " for " + formatMoney(bundle.price)
);

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
  : "Tap to select";

card.append(sizeElement, priceElement, labelElement);

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
  clearMessage();

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

if (resultCount) {
resultCount.textContent =
filteredBundles.length +
(filteredBundles.length === 1
? " bundle available"
: " bundles available");
}
}

/* =========================================================
UPDATE CHECKOUT SUMMARY
========================================================= */

function updateSelectedBundle() {
const name = getElement("selectedBundle");
const price = getElement("selectedPrice");
const networkInput = getElement("selectedNetwork");
const sizeInput = getElement("selectedSize");
const paymentButton = getElement("paymentButton");

if (selectedBundle) {
if (name) {
name.textContent =
formatNetworkName(selectedBundle.network) +
" " + selectedBundle.size;
}

if (price) {
  price.textContent = formatMoney(selectedBundle.price);
}

if (networkInput) {
  networkInput.value = selectedBundle.network;
}

if (sizeInput) {
  sizeInput.value = selectedBundle.size;
}

if (paymentButton && !checkoutInProgress) {
  paymentButton.disabled = false;
  paymentButton.textContent = "Continue to Paystack";
}

return;

}

if (name) {
name.textContent = "Choose a bundle above";
}

if (price) {
price.textContent = "GH₵0.00";
}

if (networkInput) {
networkInput.value = selectedNetwork;
}

if (sizeInput) {
sizeInput.value = "";
}

if (paymentButton && !checkoutInProgress) {
paymentButton.disabled = true;
paymentButton.textContent = "Select a Bundle First";
}
}

/* =========================================================
CHECKOUT
========================================================= */

async function handleCheckout(event) {
event.preventDefault();

if (checkoutInProgress) {
return;
}

if (!selectedBundle) {
showMessage("Please select a data bundle first.", "error");
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

const phoneInput = getElement("customerPhone");
const emailInput = getElement("customerEmail");
const paymentButton = getElement("paymentButton");

if (!phoneInput) {
showMessage("The recipient phone number field is missing.", "error");
return;
}

const phone = normalizeGhanaPhone(phoneInput.value);
const email = emailInput
? emailInput.value.trim().toLowerCase()
: "";

if (!isValidGhanaPhone(phone)) {
showMessage(
"Enter a valid Ghanaian phone number, such as 0241234567.",
"error"
);

phoneInput.focus();
return;

}

if (!emailInput || !email) {
showMessage("Please enter your email address.", "error");

if (emailInput) {
  emailInput.focus();
}

return;

}

if (
email.length > 254 ||
!/^[^\s@]+@[^\s@]+.[^\s@]+$/.test(email)
) {
showMessage("Please enter a valid email address.", "error");
emailInput.focus();
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
Accept: "application/json"
},
body: JSON.stringify({
phone,
email,
network: selectedBundle.network,
bundle: selectedBundle.size

      /*
       * The backend must determine the real amount using
       * its own price list. Do not rely on browser prices.
       */
    })
  }
);

const data = await readJSONResponse(response);

if (!response.ok || data.success === false) {
  throw new Error(
    data.message ||
    data.error ||
    "Unable to initialize payment."
  );
}

if (!data.authorization_url) {
  throw new Error(
    "The payment service did not return a checkout link."
  );
}

let paymentURL;

try {
  paymentURL = new URL(data.authorization_url);
} catch (_) {
  throw new Error(
    "The payment service returned an invalid checkout link."
  );
}

const host = paymentURL.hostname.toLowerCase();

const recognisedPaystackHost =
  host === "paystack.com" ||
  host.endsWith(".paystack.com");

if (
  paymentURL.protocol !== "https:" ||
  !recognisedPaystackHost
) {
  throw new Error(
    "The payment link is not a recognised secure Paystack URL."
  );
}

showMessage(
  "Opening the secure Paystack payment page...",
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

/* =========================================================
BUNDLE SEARCH
========================================================= */

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

/* =========================================================
MOBILE MENU
Uses the .open class consistently.
========================================================= */

function initializeMobileMenu() {
const menuButton = getElement("menuButton");
const mobileMenu = getElement("mobileMenu");

if (!menuButton || !mobileMenu || menuInitialized) {
return;
}

menuInitialized = true;

function closeMenu() {
mobileMenu.classList.remove("open");

/*
 * This supports the current HTML's inline display:none.
 * The .open class is also used by the CSS.
 */
mobileMenu.style.display = "none";

menuButton.setAttribute("aria-expanded", "false");
menuButton.setAttribute("aria-label", "Open menu");
menuButton.textContent = "☰";

}

function openMenu() {
mobileMenu.classList.add("open");
mobileMenu.style.display = "block";

menuButton.setAttribute("aria-expanded", "true");
menuButton.setAttribute("aria-label", "Close menu");
menuButton.textContent = "✕";

}

closeMenu();

menuButton.addEventListener("click", event => {
event.preventDefault();
event.stopPropagation();

const isOpen = mobileMenu.classList.contains("open");

if (isOpen) {
  closeMenu();
} else {
  openMenu();
}

});

mobileMenu.querySelectorAll("a").forEach(link => {
link.addEventListener("click", () => {
closeMenu();
});
});

document.addEventListener("click", event => {
if (
!mobileMenu.contains(event.target) &&
!menuButton.contains(event.target)
) {
closeMenu();
}
});

document.addEventListener("keydown", event => {
if (event.key === "Escape") {
closeMenu();
}
});
}

/* =========================================================
QUICK NAVIGATION
Smoothly scrolls to the relevant section.
========================================================= */

function initializeQuickNavigation() {
if (navigationInitialized) {
return;
}

navigationInitialized = true;

const navLinks = Array.from(
document.querySelectorAll(".bottom-nav a[href^='#']")
);

navLinks.forEach(link => {
link.addEventListener("click", event => {
const href = link.getAttribute("href");

  if (!href || href === "#") {
    return;
  }

  const target = document.querySelector(href);

  if (!target) {
    return;
  }

  event.preventDefault();

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  navLinks.forEach(item => item.classList.remove("active"));

  link.classList.add("active");
});

});

/*

* Also make ordinary in-page links scroll correctly.
  */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
  if (link.dataset.smoothScrollInitialized === "yes") {
  return;
  }

link.dataset.smoothScrollInitialized = "yes";

link.addEventListener("click", event => {
  const href = link.getAttribute("href");

  if (!href || href === "#") {
    return;
  }

  let target;

  try {
    target = document.querySelector(href);
  } catch (_) {
    return;
  }

  if (!target) {
    return;
  }

  /*
   * Leave the bottom-nav handler responsible for its links.
   */
  if (link.closest(".bottom-nav")) {
    return;
  }

  event.preventDefault();

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  if (link.closest("#mobileMenu")) {
    const menu = getElement("mobileMenu");
    const button = getElement("menuButton");

    if (menu && button) {
      menu.classList.remove("open");
      menu.style.display = "none";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
      button.textContent = "☰";
    }
  }
});

});
}

/* =========================================================
ANNOUNCEMENT POPUP
========================================================= */

function closeAnnouncement() {
const dialog = getElement("announcement");

announcementDismissed = true;

safeSessionSet("kielmenAnnouncementSeen", "true");
safeSessionSet("kielmenAnnouncementShown", "yes");

if (!dialog) {
return;
}

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
if (dialog.open && typeof dialog.close === "function") {
dialog.close();
}

dialog.hidden = true;
dialog.style.display = "none";
return;

}

if (messageElement) {
messageElement.textContent = announcementSettings.message;
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
const channelLink = getElement("announcementChannelLink");

if (!dialog) {
return;
}

if (continueButton) {
continueButton.addEventListener("click", closeAnnouncement);
}

if (channelLink) {
channelLink.addEventListener("click", () => {
closeAnnouncement();
});
}

dialog.addEventListener("click", event => {
if (event.target === dialog) {
closeAnnouncement();
}
});

const alreadySeen =
safeSessionGet("kielmenAnnouncementSeen") === "true" ||
safeSessionGet("kielmenAnnouncementShown") === "yes";

if (alreadySeen || announcementDismissed) {
return;
}

window.setTimeout(() => {
if (
announcementDismissed ||
!settingsLoaded ||
announcementSettings.enabled !== true ||
!announcementSettings.message
) {
return;
}

const seen =
  safeSessionGet("kielmenAnnouncementSeen") === "true" ||
  safeSessionGet("kielmenAnnouncementShown") === "yes";

if (seen) {
  return;
}

if (
  typeof dialog.showModal === "function" &&
  !dialog.open
) {
  try {
    dialog.showModal();
  } catch (error) {
    console.warn("Could not open announcement dialog:", error);
  }
} else {
  dialog.style.display = "block";
}

safeSessionSet("kielmenAnnouncementShown", "yes");

}, 700);
}

/* =========================================================
FOOTER
========================================================= */

function initializeFooter() {
const year = getElement("currentYear");

if (year) {
year.textContent = new Date().getFullYear();
}
}

/* =========================================================
CUSTOMER ORDER TRACKING
========================================================= */

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

if (trackingInProgress) {
  return;
}

const phoneInput = getElement("trackPhone");
const message = getElement("trackOrderMessage");
const results = getElement("trackOrderResults");
const button = getElement("trackOrderButton");

if (!phoneInput || !message || !results || !button) {
  return;
}

const phone = normalizeGhanaPhone(phoneInput.value);

message.textContent = "";
results.replaceChildren();

if (!isValidGhanaPhone(phone)) {
  message.textContent =
    "Enter a valid 10-digit Ghana phone number, such as 0241234567.";

  phoneInput.focus();
  return;
}

trackingInProgress = true;
button.disabled = true;
button.textContent = "Checking Orders...";

message.textContent = "Searching for your orders...";

try {
  /*
   * This preserves the tracking endpoint from your original
   * script. If server.js uses a different route, this URL
   * must match the actual backend route.
   */
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

  const data = await readJSONResponse(response);

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message ||
      "Unable to find orders for this number."
    );
  }

  const orders = Array.isArray(data.orders)
    ? data.orders
    : [];

  if (!orders.length) {
    message.textContent =
      "No orders found for this phone number.";

    return;
  }

  message.textContent =
    orders.length +
    (orders.length === 1
      ? " order found."
      : " orders found.");

  message.style.color = "#166534";

  orders.forEach(order => {
    const card = document.createElement("article");
    card.className = "order-result";

    card.style.padding = "15px";
    card.style.marginTop = "12px";
    card.style.border = "1px solid #d1d5db";
    card.style.borderRadius = "12px";
    card.style.background = "#ffffff";
    card.style.color = "#111827";
    card.style.overflowWrap = "anywhere";

    const date = order.created_at
      ? new Date(order.created_at).toLocaleString(
          "en-GB",
          { timeZone: "Africa/Accra" }
        )
      : "Date unavailable";

    const fields = [
      ["Order Date", date],
      ["Reference", order.reference || "Not available"],
      ["Network", formatNetworkName(order.network || "Unknown")],
      ["Bundle", order.bundle || "Not available"],
      ["Amount", formatMoney(order.amount ?? 0)],
      ["Payment", order.payment_status || "Pending"],
      ["Delivery", order.delivery_status || "Pending"]
    ];

    fields.forEach(([label, value]) => {
      const paragraph = document.createElement("p");
      paragraph.style.margin = "8px 0";
      paragraph.style.color = "#111827";

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
    error.message ||
    "Unable to check orders right now. Please try again.";

  message.style.color = "#b91c1c";
} finally {
  trackingInProgress = false;
  button.disabled = false;
  button.textContent = "Find My Orders";
}

});
}

/* =========================================================
NETWORK COLOURS
This adds the network identity to each bundle card.
Your CSS should style .bundle-card[data-network="MTN"],
.bundle-card[data-network="TELECEL"], and
.bundle-card[data-network="AIRTELTIGO"].
========================================================= */

function initializeBundleColourSupport() {
const styleId = "kielmen-network-card-colours";

if (getElement(styleId)) {
return;
}

const style = document.createElement("style");
style.id = styleId;

style.textContent = `
.bundle-card[data-network="MTN"] {
background: #ffdf00 !important;
border-color: #eab308 !important;
color: #111827 !important;
}

.bundle-card[data-network="MTN"] .bundle-size {
  color: #111827 !important;
}

.bundle-card[data-network="MTN"] .bundle-price {
  color: #713f12 !important;
}

.bundle-card[data-network="MTN"] .bundle-label {
  color: #713f12 !important;
}

.bundle-card[data-network="TELECEL"] {
  background: #fee2e2 !important;
  border-color: #f87171 !important;
  color: #7f1d1d !important;
}

.bundle-card[data-network="TELECEL"] .bundle-size {
  color: #7f1d1d !important;
}

.bundle-card[data-network="TELECEL"] .bundle-price {
  color: #b91c1c !important;
}

.bundle-card[data-network="TELECEL"] .bundle-label {
  color: #991b1b !important;
}

.bundle-card[data-network="AIRTELTIGO"] {
  background: #dbeafe !important;
  border-color: #60a5fa !important;
  color: #1e3a8a !important;
}

.bundle-card[data-network="AIRTELTIGO"] .bundle-size {
  color: #1e3a8a !important;
}

.bundle-card[data-network="AIRTELTIGO"] .bundle-price {
  color: #1d4ed8 !important;
}

.bundle-card[data-network="AIRTELTIGO"] .bundle-label {
  color: #1e40af !important;
}

.bundle-card.selected {
  outline: 3px solid #15803d !important;
  outline-offset: 2px !important;
}

.bundle-card:focus-visible,
.network-tab:focus-visible,
.pay-button:focus-visible,
#menuButton:focus-visible {
  outline: 3px solid #15803d;
  outline-offset: 3px;
}

.mobile-menu.open {
  display: block !important;
}

.mobile-menu a {
  color: #ffffff;
  text-decoration: none;
}

#trackPhone {
  box-sizing: border-box;
  width: 100%;
  min-height: 50px;
  padding: 12px;
  margin: 10px 0;
  border: 1px solid #9ca3af;
  border-radius: 12px;
  background: #ffffff;
  color: #111827;
  font-size: 16px;
}

#trackOrderButton {
  width: 100%;
  min-height: 50px;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  background: #ffcc00;
  color: #111827;
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
}

#trackOrderButton:disabled {
  opacity: .65;
  cursor: not-allowed;
}

`;

document.head.appendChild(style);
}

/* =========================================================
INITIALIZE WEBSITE
========================================================= */

async function initializeWebsite() {
initializeFooter();
initializeSearch();
initializeMobileMenu();
initializeQuickNavigation();
initializeOrderTracking();
initializeBundleColourSupport();

/*

* Attach network-tab handlers only once.
  */
  document.querySelectorAll(".network-tab[data-network]").forEach(tab => {
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

* Attach checkout handler only once.
  */
  const checkoutForm = getElement("checkoutForm");

if (
checkoutForm &&
checkoutForm.dataset.checkoutListenerAdded !== "yes"
) {
checkoutForm.dataset.checkoutListenerAdded = "yes";

checkoutForm.addEventListener("submit", handleCheckout);

}

/*

* Render the page immediately with default settings.
  */
  const firstNetwork = getFirstAvailableNetwork();

if (firstNetwork) {
selectNetwork(firstNetwork);
} else {
applyAvailableNetworks();
}

/*

* Load owner-controlled network settings and announcement
* without blocking initial rendering.
  */
  await loadPublicWebsiteSettings();
  }

/* =========================================================
START
========================================================= */

if (document.readyState === "loading") {
document.addEventListener(
"DOMContentLoaded",
initializeWebsite,
{ once: true }
);
} else {
initializeWebsite();
}
