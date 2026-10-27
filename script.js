"use strict";

/* =========================================================
KIELMEN 636 DATAPLUG
FILE 3: script.js

Features:

- Mobile menu
- Network tabs and bundle cards
- Bundle search
- Checkout and Paystack redirect
- Website settings and network availability
- Announcement dialog
- WhatsApp support
- Order tracking
- Bottom navigation

Backend:
https://kielmen-dataplug-payment-api.onrender.com
========================================================= */

/* =========================================================

1. CONFIGURATION
   ========================================================= */

const PAYMENT_API =
"https://kielmen-dataplug-payment-api.onrender.com";

const WHATSAPP_SUPPORT_NUMBER = "233533878548";

const DEFAULT_WHATSAPP_CHANNEL =
"https://whatsapp.com/channel/0029Vb9DCHl8aKvAqvYV743S";

/* =========================================================
2. CUSTOMER-FACING BUNDLE PRICES

IMPORTANT:
The backend must independently validate the bundle,
network and price before accepting a payment.
Never rely on browser-side prices for payment security.
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
3. WEBSITE STATE
========================================================= */

let activeNetwork = "MTN";
let selectedBundle = null;
let websiteSettings = {};
let paymentInProgress = false;
let trackingInProgress = false;

const networkAvailability = {
MTN: true,
TELECEL: true,
AIRTELTIGO: true
};

/* =========================================================
4. GENERAL HELPERS
========================================================= */

function byId(id) {
return document.getElementById(id);
}

function normalizeNetwork(network) {
const value = String(network || "")
.trim()
.toUpperCase()
.replace(/[\s_-]+/g, "");

if (value === "MTN") return "MTN";

if (
value === "TELECEL" ||
value === "VODAFONE"
) {
return "TELECEL";
}

if (
value === "AIRTELTIGO" ||
value === "AIRTELTIGOSMART" ||
value === "AIRTEL"
) {
return "AIRTELTIGO";
}

return "";
}

function formatMoney(amount) {
const value = Number(amount);

if (!Number.isFinite(value)) {
return "GH₵0.00";
}

return "GH₵" + value.toFixed(2);
}

function escapeHTML(value) {
return String(value ?? "").replace(
/[&<>"']/g,
character => ({
"&": "&",
"<": "<",
">": ">",
'"': """,
"'": "'"
})[character]
);
}

function validGhanaPhone(phone) {
const digits = String(phone || "").replace(/\D/g, "");

if (/^0\d{9}$/.test(digits)) {
return true;
}

if (/^233\d{9}$/.test(digits)) {
return true;
}

return false;
}

function normalizeGhanaPhone(phone) {
let digits = String(phone || "").replace(/\D/g, "");

if (digits.startsWith("233") && digits.length === 12) {
return "0" + digits.slice(3);
}

return digits;
}

function showMessage(element, message, type = "info") {
if (!element) return;

element.textContent = message;
element.classList.remove("success", "error", "info");
element.classList.add(type);
element.hidden = false;
}

function hideMessage(element) {
if (!element) return;

element.hidden = true;
element.textContent = "";
element.classList.remove("success", "error", "info");
}

function setButtonLoading(button, loading, loadingText = "Please wait...") {
if (!button) return;

if (loading) {
if (!button.dataset.originalText) {
button.dataset.originalText = button.textContent;
}

button.disabled = true;
button.textContent = loadingText;

} else {
button.disabled = false;

if (button.dataset.originalText) {
  button.textContent = button.dataset.originalText;
  delete button.dataset.originalText;
}

}
}

async function fetchJSON(url, options = {}) {
const response = await fetch(url, {
...options,
headers: {
Accept: "application/json",
...(options.body ? { "Content-Type": "application/json" } : {}),
...(options.headers || {})
}
});

let data;

try {
data = await response.json();
} catch {
data = {};
}

if (!response.ok) {
throw new Error(
data.message ||
data.error ||
"Request failed with status ${response.status}"
);
}

return data;
}

/* =========================================================
5. WHATSAPP HELPERS
========================================================= */

function getSupportNumber() {
const configured =
websiteSettings.supportWhatsApp ||
websiteSettings.whatsappNumber ||
websiteSettings.supportPhone ||
"";

const digits = String(configured).replace(/\D/g, "");

return digits || WHATSAPP_SUPPORT_NUMBER;
}

function getWhatsAppChannel() {
return (
websiteSettings.whatsappChannel ||
websiteSettings.channelUrl ||
DEFAULT_WHATSAPP_CHANNEL
);
}

function openWhatsApp(message = "") {
const number = getSupportNumber();

const url =
"https://wa.me/" +
number +
(message ? "?text=" + encodeURIComponent(message) : "");

window.open(url, "_blank", "noopener,noreferrer");
}

function updateWhatsAppLinks() {
const supportNumber = getSupportNumber();
const channel = getWhatsAppChannel();

document.querySelectorAll(".whatsapp-float").forEach(link => {
link.href = "https://wa.me/" + supportNumber;
link.target = "_blank";
link.rel = "noopener noreferrer";
link.setAttribute("aria-label", "Chat with us on WhatsApp");
});

document.querySelectorAll(
".whatsapp-header, .header-whatsapp"
).forEach(link => {
link.href = "https://wa.me/" + supportNumber;
link.target = "_blank";
link.rel = "noopener noreferrer";
});

const channelLink = byId("announcementChannelLink");

if (channelLink) {
channelLink.href = channel;
channelLink.target = "_blank";
channelLink.rel = "noopener noreferrer";
}

const supportDisplay = byId("supportPhoneDisplay");

if (supportDisplay) {
supportDisplay.textContent = supportNumber;
}

document.querySelectorAll("[data-whatsapp-support]").forEach(element => {
element.addEventListener("click", event => {
event.preventDefault();
openWhatsApp();
});
});
}

/* =========================================================
6. MOBILE MENU
========================================================= */

function setMenuOpen(open) {
const menu = byId("mobileMenu");
const button = byId("menuButton");
const icon = byId("menuIcon");

if (!menu || !button) return;

if (window.matchMedia("(min-width: 900px)").matches) {
menu.hidden = true;
menu.classList.remove("open");
button.setAttribute("aria-expanded", "false");

if (icon) icon.textContent = "☰";

return;

}

menu.hidden = !open;
menu.classList.toggle("open", open);
button.setAttribute("aria-expanded", String(open));

if (icon) {
icon.textContent = open ? "✕" : "☰";
}
}

function initializeMobileMenu() {
const menu = byId("mobileMenu");
const button = byId("menuButton");

if (!menu || !button) return;

menu.hidden = true;
menu.classList.remove("open");
button.setAttribute("aria-expanded", "false");

button.addEventListener("click", event => {
event.preventDefault();
event.stopPropagation();

setMenuOpen(menu.hidden || !menu.classList.contains("open"));

});

menu.querySelectorAll("a").forEach(link => {
link.addEventListener("click", () => {
setMenuOpen(false);
});
});

document.addEventListener("click", event => {
if (
!menu.hidden &&
!menu.contains(event.target) &&
!button.contains(event.target)
) {
setMenuOpen(false);
}
});

document.addEventListener("keydown", event => {
if (event.key === "Escape") {
setMenuOpen(false);
}
});

window.addEventListener("resize", () => {
if (window.matchMedia("(min-width: 900px)").matches) {
setMenuOpen(false);
}
});
}

/* =========================================================
7. BUNDLE AVAILABILITY
========================================================= */

function isNetworkAvailable(network) {
return networkAvailability[normalizeNetwork(network)] !== false;
}

function applyNetworkAvailability(settings) {
const availability =
settings.networkAvailability ||
settings.networks ||
{};

Object.keys(networkAvailability).forEach(network => {
let value = availability[network];

if (value === undefined) {
  value = availability[network.toLowerCase()];
}

if (value && typeof value === "object") {
  if (typeof value.available === "boolean") {
    value = value.available;
  } else if (typeof value.enabled === "boolean") {
    value = value.enabled;
  } else {
    value = true;
  }
}

if (typeof value === "boolean") {
  networkAvailability[network] = value;
} else if (typeof value === "string") {
  networkAvailability[network] =
    !["false", "off", "disabled", "unavailable"].includes(
      value.toLowerCase()
    );
}

});
}

/* =========================================================
8. NETWORK TAB MANAGEMENT
========================================================= */

function initializeNetworkTabs() {
document.querySelectorAll(".network-tab").forEach(tab => {
tab.addEventListener("click", () => {
const network = normalizeNetwork(tab.dataset.network);

  if (!network) return;

  selectNetwork(network);
});

});
}

function selectNetwork(network) {
const normalized = normalizeNetwork(network);

if (!normalized || !PRODUCTS[normalized]) return;

activeNetwork = normalized;
selectedBundle = null;

document.querySelectorAll(".network-tab").forEach(tab => {
const active =
normalizeNetwork(tab.dataset.network) === normalized;

tab.classList.toggle("active", active);
tab.setAttribute("aria-selected", String(active));

});

const hiddenNetwork = byId("selectedNetwork");
const hiddenSize = byId("selectedSize");

if (hiddenNetwork) hiddenNetwork.value = "";
if (hiddenSize) hiddenSize.value = "";

updateSelectedSummary();
updatePaymentButton();
renderBundles();

const message = byId("checkoutMessage");
hideMessage(message);
}

/* Allow compatibility with HTML that calls selectNetwork(). */
window.selectNetwork = selectNetwork;

/* =========================================================
9. BUNDLE SEARCH
========================================================= */

function initializeBundleSearch() {
const search = byId("bundleSearch");

if (!search) return;

search.addEventListener("input", renderBundles);
}

/* =========================================================
10. RENDER BUNDLE CARDS
========================================================= */

function renderBundles() {
const grid = byId("bundleGrid");
const count = byId("resultCount");
const search = byId("bundleSearch");

if (!grid) return;

const query = String(search?.value || "")
.trim()
.toLowerCase();

const products = PRODUCTS[activeNetwork] || [];

const filteredProducts = products.filter(product => {
const text = "${product.size} ${activeNetwork} ${product.price}"
.toLowerCase();

return text.includes(query);

});

if (count) {
count.textContent =
"${filteredProducts.length} package" +
(filteredProducts.length === 1 ? "" : "s") +
" available";
}

if (!filteredProducts.length) {
grid.innerHTML =
'<div class="no-results">No bundles match your search.</div>';
return;
}

grid.innerHTML = filteredProducts.map(product => {
const available = isNetworkAvailable(activeNetwork);

return `
  <article class="bundle-card"
    data-network="${escapeHTML(activeNetwork)}">

    <span class="bundle-network">
      ${escapeHTML(activeNetwork)}
    </span>

    <h3 class="bundle-size">
      ${escapeHTML(product.size)}
    </h3>

    <p>Data bundle</p>

    <p class="bundle-price">
      ${formatMoney(product.price)}
    </p>

    <button
      type="button"
      class="buy-button"
      data-buy-network="${escapeHTML(activeNetwork)}"
      data-buy-size="${escapeHTML(product.size)}"
      ${available ? "" : "disabled"}
    >
      ${available ? "Buy Bundle" : "Temporarily Unavailable"}
    </button>
  </article>
`;

}).join("");

grid.querySelectorAll("[data-buy-size]").forEach(button => {
button.addEventListener("click", () => {
chooseBundle(
button.dataset.buyNetwork,
button.dataset.buySize
);
});
});
}

/* =========================================================
11. SELECT A BUNDLE
========================================================= */

function chooseBundle(network, size) {
const normalized = normalizeNetwork(network);

if (!normalized || !PRODUCTS[normalized]) return;

if (!isNetworkAvailable(normalized)) {
const message = byId("checkoutMessage");

showMessage(
  message,
  `${normalized} bundles are temporarily unavailable. Please try again later.`,
  "error"
);

return;

}

const bundle = PRODUCTS[normalized].find(
product => product.size === String(size)
);

if (!bundle) {
showMessage(
byId("checkoutMessage"),
"We could not find that bundle. Please select it again.",
"error"
);

return;

}

activeNetwork = normalized;

selectedBundle = {
network: normalized,
size: bundle.size,
price: bundle.price
};

const networkInput = byId("selectedNetwork");
const sizeInput = byId("selectedSize");

if (networkInput) networkInput.value = normalized;
if (sizeInput) sizeInput.value = bundle.size;

document.querySelectorAll(".network-tab").forEach(tab => {
const active =
normalizeNetwork(tab.dataset.network) === normalized;

tab.classList.toggle("active", active);
tab.setAttribute("aria-selected", String(active));

});

updateSelectedSummary();
updatePaymentButton();
hideMessage(byId("checkoutMessage"));

const checkout = byId("checkout");

if (checkout) {
checkout.scrollIntoView({
behavior: "smooth",
block: "start"
});
}
}

window.chooseBundle = chooseBundle;

/* =========================================================
12. CHECKOUT SUMMARY
========================================================= */

function updateSelectedSummary() {
const bundleDisplay = byId("selectedBundle");
const priceDisplay = byId("selectedPrice");

if (bundleDisplay) {
bundleDisplay.textContent = selectedBundle
? "${selectedBundle.network} ${selectedBundle.size}"
: "No bundle selected";
}

if (priceDisplay) {
priceDisplay.textContent = selectedBundle
? formatMoney(selectedBundle.price)
: "GH₵0.00";
}
}

function updatePaymentButton() {
const button = byId("paymentButton");

if (!button) return;

const phone = byId("customerPhone")?.value.trim() || "";
const email = byId("customerEmail")?.value.trim() || "";

const validPhone = validGhanaPhone(phone);
const validEmail =
/^[^\s@]+@[^\s@]+.[^\s@]+$/.test(email);

button.disabled = !(
selectedBundle &&
validPhone &&
validEmail &&
!paymentInProgress &&
isNetworkAvailable(selectedBundle.network)
);
}

/* =========================================================
13. CHECKOUT FORM VALIDATION
========================================================= */

function validateCheckout() {
const phone = byId("customerPhone")?.value.trim() || "";
const email = byId("customerEmail")?.value.trim() || "";
const message = byId("checkoutMessage");

if (!selectedBundle) {
showMessage(
message,
"Please select a data bundle before continuing.",
"error"
);

return false;

}

if (!isNetworkAvailable(selectedBundle.network)) {
showMessage(
message,
"This network is temporarily unavailable. Please select another network.",
"error"
);

return false;

}

if (!validGhanaPhone(phone)) {
showMessage(
message,
"Enter a valid Ghana phone number, for example 0241234567.",
"error"
);

byId("customerPhone")?.focus();

return false;

}

if (!/^[^\s@]+@[^\s@]+.[^\s@]+$/.test(email)) {
showMessage(
message,
"Enter a valid email address.",
"error"
);

byId("customerEmail")?.focus();

return false;

}

return true;
}

/* =========================================================
14. PAYSTACK CHECKOUT
========================================================= */

async function initializePayment(event) {
if (event) event.preventDefault();

if (paymentInProgress) return;

const form = byId("checkoutForm");
const button = byId("paymentButton");
const message = byId("checkoutMessage");

if (!form || !button) return;

if (!validateCheckout()) return;

const phone = normalizeGhanaPhone(
byId("customerPhone").value.trim()
);

const email = byId("customerEmail").value.trim();

const network = selectedBundle.network;
const bundle = selectedBundle.size;

paymentInProgress = true;
button.disabled = true;
button.textContent = "Connecting to Paystack...";

showMessage(
message,
"Please wait while we prepare your secure payment.",
"info"
);

try {
/*
The browser sends the selected bundle information.

  IMPORTANT:
  Your backend must look up the correct price from its own
  trusted price table. It must not trust the browser's amount.
*/

const data = await fetchJSON(
  `${PAYMENT_API}/initialize-payment`,
  {
    method: "POST",
    body: JSON.stringify({
      phone,
      email,
      network,
      bundle,

      /*
        Sent for compatibility with an existing backend.
        The backend must independently calculate and validate
        the amount before initializing the transaction.
      */
      amount: selectedBundle.price
    })
  }
);

const paymentURL =
  data.authorization_url ||
  data.authorizationUrl ||
  data.data?.authorization_url ||
  data.data?.authorizationUrl;

if (
  !data.success &&
  !paymentURL
) {
  throw new Error(
    data.message ||
    data.error ||
    "We could not initialize your payment."
  );
}

if (!paymentURL) {
  throw new Error(
    "The payment service did not return a checkout link. Please contact support."
  );
}

let parsedURL;

try {
  parsedURL = new URL(paymentURL);
} catch {
  throw new Error("The payment link returned by the server is invalid.");
}

const validPaystackHost =
  parsedURL.hostname === "paystack.com" ||
  parsedURL.hostname.endsWith(".paystack.com");

if (
  parsedURL.protocol !== "https:" ||
  !validPaystackHost
) {
  throw new Error(
    "The payment service returned an unexpected checkout address. Please contact support."
  );
}

showMessage(
  message,
  "Payment page ready. Redirecting to Paystack...",
  "success"
);

window.location.assign(parsedURL.href);

} catch (error) {
console.error("Payment initialization error:", error);

showMessage(
  message,
  error.message ||
  "Payment could not be started. Please check your connection and try again.",
  "error"
);

paymentInProgress = false;
updatePaymentButton();
button.textContent = "Pay Securely";

}
}

function initializeCheckout() {
const form = byId("checkoutForm");

if (!form) return;

form.addEventListener("submit", initializePayment);

["customerPhone", "customerEmail"].forEach(id => {
const input = byId(id);

if (!input) return;

input.addEventListener("input", updatePaymentButton);
input.addEventListener("change", updatePaymentButton);

});

updateSelectedSummary();
updatePaymentButton();
}

/* =========================================================
15. ORDER TRACKING
========================================================= */

/*
This uses the existing /orders-by-phone/{phone} route.
The backend must expose that endpoint and return the orders
associated with the submitted phone number.
*/

async function trackOrders(event) {
if (event) event.preventDefault();

if (trackingInProgress) return;

const form = byId("trackOrderForm");
const phoneInput = byId("trackPhone");
const button = byId("trackOrderButton");
const message = byId("trackOrderMessage");
const results = byId("trackOrderResults");

if (!form || !phoneInput || !button || !results) return;

const phone = normalizeGhanaPhone(phoneInput.value.trim());

if (!validGhanaPhone(phone)) {
showMessage(
message,
"Enter a valid Ghana phone number to track your order.",
"error"
);

phoneInput.focus();
return;

}

trackingInProgress = true;
setButtonLoading(button, true, "Searching...");
hideMessage(message);
results.replaceChildren();

showMessage(
message,
"Checking your orders. Please wait...",
"info"
);

try {
const data = await fetchJSON(
"${PAYMENT_API}/orders-by-phone/${encodeURIComponent(phone)}",
{
method: "GET"
}
);

const orders = Array.isArray(data)
  ? data
  : (
      data.orders ||
      data.data?.orders ||
      data.data ||
      []
    );

if (!Array.isArray(orders) || orders.length === 0) {
  showMessage(
    message,
    data.message ||
    "No orders were found for this phone number. Check the number and try again.",
    "info"
  );

  return;
}

showMessage(
  message,
  `Found ${orders.length} order${orders.length === 1 ? "" : "s"}.`,
  "success"
);

results.innerHTML = orders.map(order => {
  const network = escapeHTML(
    order.network || order.supplier_network || "Data bundle"
  );

  const bundle = escapeHTML(
    order.bundle ||
    order.size ||
    order.bundle_size ||
    order.data_bundle ||
    "Not provided"
  );

  const status = escapeHTML(
    order.status ||
    order.delivery_status ||
    "Processing"
  );

  const reference = escapeHTML(
    order.reference ||
    order.payment_reference ||
    order.order_reference ||
    order.id ||
    "Unavailable"
  );

  const amountValue =
    order.amount ??
    order.price ??
    order.total_amount;

  const amount = amountValue !== undefined &&
    amountValue !== null &&
    amountValue !== ""
      ? formatMoney(Number(amountValue))
      : "Unavailable";

  const createdAt =
    order.created_at ||
    order.createdAt ||
    order.created ||
    "";

  const dateText = createdAt
    ? escapeHTML(String(createdAt))
    : "Unavailable";

  return `
    <article class="order-result">
      <h3>${network} — ${bundle}</h3>

      <p>
        <strong>Order reference:</strong>
        ${reference}
      </p>

      <p>
        <strong>Amount:</strong>
        ${escapeHTML(amount)}
      </p>

      <p>
        <strong>Status:</strong>
        <span class="order-status">
          ${status}
        </span>
      </p>

      <p>
        <strong>Order date:</strong>
        ${dateText}
      </p>
    </article>
  `;
}).join("");

} catch (error) {
console.error("Order tracking error:", error);

showMessage(
  message,
  error.message ||
  "We could not retrieve your orders. Please try again later.",
  "error"
);

} finally {
trackingInProgress = false;
setButtonLoading(button, false);
}
}

function initializeOrderTracking() {
const form = byId("trackOrderForm");

if (!form) return;

form.addEventListener("submit", trackOrders);
}

/* =========================================================
16. WEBSITE SETTINGS
========================================================= */

async function loadWebsiteSettings() {
try {
const data = await fetchJSON(
"${PAYMENT_API}/website-settings",
{ method: "GET" }
);

websiteSettings = data.settings || data.data || data || {};

applyNetworkAvailability(websiteSettings);
applyWebsiteSettings();
updateWhatsAppLinks();
renderBundles();
updatePaymentButton();

} catch (error) {
/*
If settings cannot be retrieved, the website continues
using the default bundle list and default contact details.
*/
console.warn(
"Website settings could not be loaded. Using defaults.",
error
);

updateWhatsAppLinks();
renderBundles();

}
}

function applyWebsiteSettings() {
/*
Optional settings supported here:
- announcementEnabled
- announcement
- announcementMessage
- whatsappChannel
- channelUrl
- supportWhatsApp
- whatsappNumber
- supportPhone
- networkAvailability
*/

updateWhatsAppLinks();

const availability = websiteSettings.networkAvailability || {};

Object.keys(networkAvailability).forEach(network => {
const value =
availability[network] ??
availability[network.toLowerCase()];

const tab = document.querySelector(
  `.network-tab[data-network="${network}"]`
);

if (!tab) return;

const available = networkAvailability[network];

tab.setAttribute(
  "aria-label",
  available
    ? `${network} bundles`
    : `${network} bundles temporarily unavailable`
);

if (value === false) {
  tab.title = "Temporarily unavailable";
} else {
  tab.removeAttribute("title");
}

});

updateAnnouncement();
}

/* =========================================================
17. ANNOUNCEMENT DIALOG
========================================================= */

function updateAnnouncement() {
const dialog = byId("announcement");
const message = byId("announcementMessage");
const channelLink = byId("announcementChannelLink");
const closeButton = byId("continueShopping");

if (!dialog) return;

const announcementText =
websiteSettings.announcementMessage ||
websiteSettings.announcement ||
websiteSettings.notice ||
"";

const explicitlyEnabled =
websiteSettings.announcementEnabled === true ||
websiteSettings.showAnnouncement === true;

const explicitlyDisabled =
websiteSettings.announcementEnabled === false ||
websiteSettings.showAnnouncement === false;

if (
!announcementText ||
explicitlyDisabled ||
(!explicitlyEnabled && !announcementText)
) {
if (dialog.open && typeof dialog.close === "function") {
dialog.close();
}

dialog.hidden = true;
return;

}

if (message) {
message.textContent = String(announcementText);
}

if (channelLink) {
channelLink.href = getWhatsAppChannel();
}

if (closeButton && !closeButton.dataset.listenerAdded) {
closeButton.dataset.listenerAdded = "true";

closeButton.addEventListener("click", () => {
  if (typeof dialog.close === "function" && dialog.open) {
    dialog.close();
  }

  dialog.hidden = true;
});

}

/*
Display the announcement only once per browser session.
If the browser does not support dialog, leave it hidden
instead of breaking the rest of the website.
*/

const sessionKey = "kielmen_announcement_seen";

if (sessionStorage.getItem(sessionKey) === "true") {
return;
}

if (typeof dialog.showModal === "function") {
dialog.hidden = false;

if (!dialog.open) {
  dialog.showModal();
}

sessionStorage.setItem(sessionKey, "true");

}
}

/* =========================================================
18. BOTTOM NAVIGATION
========================================================= */

function initializeBottomNavigation() {
const links = document.querySelectorAll(
".bottom-nav a[href^='#']"
);

if (!links.length) return;

links.forEach(link => {
link.addEventListener("click", event => {
const targetId = link.getAttribute("href").slice(1);
const target = byId(targetId);

  if (!target) return;

  event.preventDefault();

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  links.forEach(item => {
    item.classList.remove("active");
    item.removeAttribute("aria-current");
  });

  link.classList.add("active");
  link.setAttribute("aria-current", "page");

  history.replaceState(null, "", `#${targetId}`);
});

});

const trackedSections = [];

links.forEach(link => {
const targetId = link.getAttribute("href").slice(1);
const section = byId(targetId);

if (section) {
  trackedSections.push({ link, section });
}

});

if ("IntersectionObserver" in window) {
const observer = new IntersectionObserver(entries => {
const visible = entries
.filter(entry => entry.isIntersecting)
.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

  if (!visible) return;

  const current = trackedSections.find(
    item => item.section === visible.target
  );

  if (!current) return;

  trackedSections.forEach(item => {
    const active = item.link === current.link;

    item.link.classList.toggle("active", active);

    if (active) {
      item.link.setAttribute("aria-current", "page");
    } else {
      item.link.removeAttribute("aria-current");
    }
  });

}, {
  rootMargin: "-20% 0px -60% 0px",
  threshold: [0, 0.25, 0.5]
});

trackedSections.forEach(item => observer.observe(item.section));

}
}

/* =========================================================
19. GENERAL INTERNAL NAVIGATION
========================================================= */

function initializeSmoothNavigation() {
document.querySelectorAll('a[href^="#"]').forEach(link => {
if (link.closest(".bottom-nav")) return;
if (link.closest("#mobileMenu")) return;

link.addEventListener("click", event => {
  const href = link.getAttribute("href");

  if (!href || href === "#") return;

  const target = byId(href.slice(1));

  if (!target) return;

  event.preventDefault();

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  if (history.replaceState) {
    history.replaceState(null, "", href);
  }
});

});
}

/* =========================================================
20. FORM SAFETY
========================================================= */

function preventUnexpectedFormSubmission() {
document.querySelectorAll("form").forEach(form => {
if (
form.id === "checkoutForm" ||
form.id === "trackOrderForm"
) {
return;
}

/*
  Do not interfere with forms that have their own
  explicit submit handler.
*/

});
}

/* =========================================================
21. INITIALIZE WEBSITE
========================================================= */

async function initializeWebsite() {
initializeMobileMenu();
initializeNetworkTabs();
initializeBundleSearch();
initializeCheckout();
initializeOrderTracking();
initializeBottomNavigation();
initializeSmoothNavigation();
preventUnexpectedFormSubmission();

updateSelectedSummary();
renderBundles();
updateWhatsAppLinks();

/*
Load server-managed availability and announcements
after the initial page is usable.
*/

await loadWebsiteSettings();

updateSelectedSummary();
updatePaymentButton();
}

/* =========================================================
22. START
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
