"use strict";

/* =========================================================
   KIELMEN 636 DATAPLUG
   FILE 3: script.js

   Features:
   - Responsive mobile navigation
   - Network tabs and bundle cards
   - Bundle search
   - Checkout and Paystack redirect
   - Website settings and network availability
   - Announcement dialog
   - WhatsApp support and channel links
   - Order tracking
   - Bottom navigation
   - Current year

   Backend:
   https://kielmen-dataplug-payment-api.onrender.com

   SECURITY:
   The backend MUST validate bundle prices independently.
   Never rely on the amount sent by the browser.
========================================================= */


/* =========================================================
   1. CONFIGURATION
========================================================= */

const PAYMENT_API =
    "https://kielmen-dataplug-payment-api.onrender.com";

const DEFAULT_WHATSAPP_NUMBER = "233533878548";

const DEFAULT_WHATSAPP_CHANNEL =
    "https://whatsapp.com/channel/0029Vb9DCHl8aKvAqvYV743S";


/* =========================================================
   2. DEFAULT BUNDLE PRICES
========================================================= */

const DEFAULT_PRODUCTS = {
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
   3. APPLICATION STATE
========================================================= */

let activeNetwork = "MTN";
let selectedBundle = null;
let paymentInProgress = false;

let networkAvailability = {
    MTN: true,
    TELECEL: true,
    AIRTELTIGO: true
};

let websiteSettings = {};

let whatsappNumber = DEFAULT_WHATSAPP_NUMBER;
let whatsappChannel = DEFAULT_WHATSAPP_CHANNEL;


/* =========================================================
   4. DOM HELPERS
========================================================= */

function getElement(id) {
    return document.getElementById(id);
}

function queryAll(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

function setText(element, value) {
    if (element) {
        element.textContent = String(value ?? "");
    }
}

function showElement(element) {
    if (element) {
        element.hidden = false;
    }
}

function hideElement(element) {
    if (element) {
        element.hidden = true;
    }
}

function normalizeNetwork(network) {
    const value = String(network || "")
        .trim()
        .toUpperCase()
        .replace(/[\s_-]+/g, "");

    if (value === "MTN") {
        return "MTN";
    }

    if (value === "TELECEL" || value === "VODAFONE") {
        return "TELECEL";
    }

    if (
        value === "AIRTELTIGO" ||
        value === "AIRTEL" ||
        value === "TIGO"
    ) {
        return "AIRTELTIGO";
    }

    return "";
}

function normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
}

function normalizeGhanaPhone(phone) {
    let value = normalizePhone(phone);

    if (value.startsWith("233") && value.length === 12) {
        value = "0" + value.slice(3);
    }

    return value;
}

function isValidGhanaPhone(phone) {
    const value = normalizeGhanaPhone(phone);

    return /^0\d{9}$/.test(value);
}

function isValidEmail(email) {
    const value = String(email || "").trim();

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatMoney(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        return "GH₵0.00";
    }

    return "GH₵" + value.toFixed(2);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}

function safelyGetStorage(key) {
    try {
        return sessionStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function safelySetStorage(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch (error) {
        // The website can continue if browser storage is unavailable.
    }
}


/* =========================================================
   5. API HELPERS
========================================================= */

async function fetchJSON(url, options = {}) {
    const requestOptions = {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.headers || {})
        }
    };

    const response = await fetch(url, requestOptions);

    const rawText = await response.text();

    let result = {};

    if (rawText) {
        try {
            result = JSON.parse(rawText);
        } catch (error) {
            throw new Error(
                "The server returned an invalid response. Please try again."
            );
        }
    }

    if (!response.ok) {
        const message =
            result.message ||
            result.error ||
            `Request failed with status ${response.status}.`;

        throw new Error(message);
    }

    return result;
}

function getResponseData(response) {
    if (!response || typeof response !== "object") {
        return {};
    }

    if (
        response.data &&
        typeof response.data === "object"
    ) {
        return response.data;
    }

    return response;
}


/* =========================================================
   6. STATUS MESSAGES
========================================================= */

function showCheckoutMessage(message, type = "info") {
    const element = getElement("checkoutMessage");

    if (!element) {
        return;
    }

    setText(element, message);
    element.classList.remove("success", "error", "info");
    element.classList.add(type);
    showElement(element);
}

function clearCheckoutMessage() {
    const element = getElement("checkoutMessage");

    if (!element) {
        return;
    }

    setText(element, "");
    element.classList.remove("success", "error", "info");
    hideElement(element);
}

function showTrackingMessage(message, type = "info") {
    const element = getElement("trackOrderMessage");

    if (!element) {
        return;
    }

    setText(element, message);
    element.classList.remove("success", "error", "info");
    element.classList.add(type);
    showElement(element);
}

function clearTrackingMessage() {
    const element = getElement("trackOrderMessage");

    if (!element) {
        return;
    }

    setText(element, "");
    element.classList.remove("success", "error", "info");
    hideElement(element);
}


/* =========================================================
   7. MOBILE MENU
========================================================= */

function setMenuOpen(shouldOpen) {
    const menu = getElement("mobileMenu");
    const button = getElement("menuButton");
    const icon = getElement("menuIcon");

    if (!menu || !button) {
        return;
    }

    menu.hidden = !shouldOpen;
    menu.classList.toggle("open", shouldOpen);

    button.setAttribute(
        "aria-expanded",
        shouldOpen ? "true" : "false"
    );

    button.setAttribute(
        "aria-label",
        shouldOpen ? "Close navigation menu" : "Open navigation menu"
    );

    if (icon) {
        icon.textContent = shouldOpen ? "✕" : "☰";
    }
}

function initializeMobileMenu() {
    const menu = getElement("mobileMenu");
    const button = getElement("menuButton");

    if (!menu || !button) {
        return;
    }

    setMenuOpen(false);

    button.addEventListener("click", event => {
        event.preventDefault();

        const shouldOpen = menu.hidden;

        setMenuOpen(shouldOpen);
    });

    queryAll("#mobileMenu a").forEach(link => {
        link.addEventListener("click", () => {
            setMenuOpen(false);
        });
    });

    document.addEventListener("click", event => {
        const clickedInsideMenu = menu.contains(event.target);
        const clickedButton = button.contains(event.target);

        if (!clickedInsideMenu && !clickedButton) {
            setMenuOpen(false);
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            setMenuOpen(false);
        }
    });
}


/* =========================================================
   8. WHATSAPP AND CHANNEL LINKS
========================================================= */

function cleanWhatsAppNumber(number) {
    return normalizePhone(number);
}

function getWhatsAppDisplayNumber(number) {
    const value = cleanWhatsAppNumber(number);

    if (value.startsWith("233") && value.length === 12) {
        return "0" + value.slice(3);
    }

    return value;
}

function updateWhatsAppLinks() {
    const cleanNumber = cleanWhatsAppNumber(whatsappNumber);

    if (!cleanNumber) {
        return;
    }

    const contactURL = `https://wa.me/${cleanNumber}`;

    queryAll("[data-whatsapp-contact]").forEach(link => {
        link.href = contactURL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    });

    const displayNumber = getWhatsAppDisplayNumber(cleanNumber);

    const displayElement = getElement("supportPhoneDisplay");

    if (displayElement) {
        setText(displayElement, displayNumber);
    }
}

function updateChannelLinks() {
    if (!whatsappChannel) {
        return;
    }

    queryAll("[data-channel-link]").forEach(link => {
        link.href = whatsappChannel;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    });
}


/* =========================================================
   9. NETWORK TABS
========================================================= */

function isNetworkAvailable(network) {
    return networkAvailability[network] !== false;
}

function updateNetworkTabs() {
    queryAll(".network-tab").forEach(tab => {
        const network = normalizeNetwork(
            tab.dataset.network
        );

        const active = network === activeNetwork;
        const available = isNetworkAvailable(network);

        tab.setAttribute(
            "aria-pressed",
            active ? "true" : "false"
        );

        tab.disabled = !available;
        tab.classList.toggle("active", active);
        tab.classList.toggle("unavailable", !available);

        if (!available) {
            tab.setAttribute("aria-label", `${network} is temporarily unavailable`);
        } else {
            tab.removeAttribute("aria-label");
        }
    });
}

function selectNetwork(network) {
    const normalized = normalizeNetwork(network);

    if (!normalized) {
        return;
    }

    if (!isNetworkAvailable(normalized)) {
        showCheckoutMessage(
            `${normalized} bundles are temporarily unavailable. Please choose another network.`,
            "error"
        );

        return;
    }

    activeNetwork = normalized;
    selectedBundle = null;

    const selectedNetworkInput = getElement("selectedNetwork");
    const selectedSizeInput = getElement("selectedSize");

    if (selectedNetworkInput) {
        selectedNetworkInput.value = activeNetwork;
    }

    if (selectedSizeInput) {
        selectedSizeInput.value = "";
    }

    clearCheckoutMessage();
    updateNetworkTabs();
    renderBundles();
    updateSelectedSummary();
    updatePaymentButton();
}

function initializeNetworkTabs() {
    queryAll(".network-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            selectNetwork(tab.dataset.network);
        });
    });

    updateNetworkTabs();
}


/* =========================================================
   10. BUNDLE SEARCH AND RENDERING
========================================================= */

function getProductsForNetwork(network) {
    const products = DEFAULT_PRODUCTS[network];

    if (!Array.isArray(products)) {
        return [];
    }

    return products;
}

function renderBundles() {
    const grid = getElement("bundleGrid");
    const searchInput = getElement("bundleSearch");
    const resultCount = getElement("resultCount");

    if (!grid) {
        return;
    }

    const searchTerm = searchInput
        ? searchInput.value.trim().toLowerCase()
        : "";

    const products = getProductsForNetwork(activeNetwork);

    if (!isNetworkAvailable(activeNetwork)) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>Network temporarily unavailable</h3>
                <p>Please choose another network or check back later.</p>
            </div>
        `;

        setText(resultCount, "0 packages available");
        return;
    }

    const filteredProducts = products.filter(product => {
        const searchableText =
            `${product.size} ${activeNetwork} ${product.price}`.toLowerCase();

        return searchableText.includes(searchTerm);
    });

    if (resultCount) {
        setText(
            resultCount,
            `${filteredProducts.length} package${filteredProducts.length === 1 ? "" : "s"} available`
        );
    }

    if (filteredProducts.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>No bundles found</h3>
                <p>Try a different search or select another network.</p>
            </div>
        `;

        return;
    }

    grid.innerHTML = filteredProducts.map(product => {
        const isSelected =
            selectedBundle &&
            selectedBundle.network === activeNetwork &&
            selectedBundle.size === product.size;

        const networkClass = activeNetwork.toLowerCase();

        return `
            <article class="bundle-card ${networkClass} ${isSelected ? "selected" : ""}">
                <div class="bundle-card-top">
                    <span class="bundle-network">${escapeHTML(activeNetwork)}</span>
                    <span class="bundle-badge">DATA BUNDLE</span>
                </div>

                <div class="bundle-size">${escapeHTML(product.size)}</div>

                <div class="bundle-price">${formatMoney(product.price)}</div>

                <button
                    type="button"
                    class="bundle-buy-button"
                    data-buy-network="${escapeHTML(activeNetwork)}"
                    data-buy-size="${escapeHTML(product.size)}"
                    aria-label="Buy ${escapeHTML(product.size)} ${escapeHTML(activeNetwork)} bundle for ${formatMoney(product.price)}"
                >
                    ${isSelected ? "Selected ✓" : "Buy Bundle"}
                </button>
            </article>
        `;
    }).join("");

    queryAll("[data-buy-network]", grid).forEach(button => {
        button.addEventListener("click", () => {
            const network = normalizeNetwork(
                button.dataset.buyNetwork
            );

            const size = String(
                button.dataset.buySize || ""
            );

            chooseBundle(network, size);
        });
    });
}

function initializeBundleSearch() {
    const searchInput = getElement("bundleSearch");

    if (!searchInput) {
        return;
    }

    searchInput.addEventListener("input", renderBundles);
}


/* =========================================================
   11. SELECTING A BUNDLE
========================================================= */

function chooseBundle(network, size) {
    const normalizedNetwork = normalizeNetwork(network);

    if (!normalizedNetwork || !isNetworkAvailable(normalizedNetwork)) {
        showCheckoutMessage(
            "This network is currently unavailable. Please choose another one.",
            "error"
        );

        return;
    }

    const products = getProductsForNetwork(normalizedNetwork);

    const product = products.find(item => item.size === size);

    if (!product) {
        showCheckoutMessage(
            "That bundle could not be found. Please select another package.",
            "error"
        );

        return;
    }

    activeNetwork = normalizedNetwork;

    selectedBundle = {
        network: normalizedNetwork,
        size: product.size,
        price: Number(product.price)
    };

    const selectedNetworkInput = getElement("selectedNetwork");
    const selectedSizeInput = getElement("selectedSize");

    if (selectedNetworkInput) {
        selectedNetworkInput.value = selectedBundle.network;
    }

    if (selectedSizeInput) {
        selectedSizeInput.value = selectedBundle.size;
    }

    clearCheckoutMessage();

    updateNetworkTabs();
    renderBundles();
    updateSelectedSummary();
    updatePaymentButton();

    const checkout = getElement("checkout");

    if (checkout) {
        checkout.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

function updateSelectedSummary() {
    const selectedBundleElement = getElement("selectedBundle");
    const selectedPriceElement = getElement("selectedPrice");

    if (!selectedBundle) {
        setText(
            selectedBundleElement,
            "No bundle selected"
        );

        setText(
            selectedPriceElement,
            "GH₵0.00"
        );

        return;
    }

    setText(
        selectedBundleElement,
        `${selectedBundle.network} ${selectedBundle.size}`
    );

    setText(
        selectedPriceElement,
        formatMoney(selectedBundle.price)
    );
}


/* =========================================================
   12. CHECKOUT VALIDATION
========================================================= */

function getCheckoutValues() {
    const phoneElement = getElement("customerPhone");
    const emailElement = getElement("customerEmail");

    return {
        phone: phoneElement
            ? normalizeGhanaPhone(phoneElement.value)
            : "",

        email: emailElement
            ? emailElement.value.trim()
            : ""
    };
}

function validateCheckout(showMessage = false) {
    if (!selectedBundle) {
        if (showMessage) {
            showCheckoutMessage(
                "Please select a data bundle first.",
                "error"
            );
        }

        return false;
    }

    if (!isNetworkAvailable(selectedBundle.network)) {
        if (showMessage) {
            showCheckoutMessage(
                "This network is temporarily unavailable.",
                "error"
            );
        }

        return false;
    }

    const { phone, email } = getCheckoutValues();

    if (!isValidGhanaPhone(phone)) {
        if (showMessage) {
            showCheckoutMessage(
                "Enter a valid Ghana phone number, for example 0241234567.",
                "error"
            );
        }

        return false;
    }

    if (!isValidEmail(email)) {
        if (showMessage) {
            showCheckoutMessage(
                "Enter a valid email address for your payment.",
                "error"
            );
        }

        return false;
    }

    return true;
}

function updatePaymentButton() {
    const button = getElement("paymentButton");

    if (!button) {
        return;
    }

    if (paymentInProgress) {
        button.disabled = true;
        button.textContent = "Processing...";
        return;
    }

    if (!selectedBundle) {
        button.disabled = true;
        button.textContent = "Select a Bundle First";
        return;
    }

    const { phone, email } = getCheckoutValues();

    const validPhone = isValidGhanaPhone(phone);
    const validEmail = isValidEmail(email);

    const valid =
        validPhone &&
        validEmail &&
        isNetworkAvailable(selectedBundle.network);

    button.disabled = !valid;
    button.textContent = valid
        ? `Pay ${formatMoney(selectedBundle.price)} Securely`
        : "Enter Your Details";
}

function initializeCheckoutValidation() {
    const phoneElement = getElement("customerPhone");
    const emailElement = getElement("customerEmail");

    [phoneElement, emailElement].forEach(element => {
        if (!element) {
            return;
        }

        element.addEventListener("input", () => {
            updatePaymentButton();
        });

        element.addEventListener("blur", () => {
            if (
                element === phoneElement &&
                element.value.trim() &&
                !isValidGhanaPhone(element.value)
            ) {
                element.setCustomValidity(
                    "Enter a valid Ghana phone number."
                );
            } else if (
                element === emailElement &&
                element.value.trim() &&
                !isValidEmail(element.value)
            ) {
                element.setCustomValidity(
                    "Enter a valid email address."
                );
            } else {
                element.setCustomValidity("");
            }
        });

        element.addEventListener("input", () => {
            element.setCustomValidity("");
        });
    });

    updatePaymentButton();
}


/* =========================================================
   13. PAYSTACK CHECKOUT
========================================================= */

function getPaystackAuthorizationURL(response) {
    const data = getResponseData(response);

    const possibleURLs = [
        response?.authorization_url,
        response?.authorizationUrl,
        data?.authorization_url,
        data?.authorizationUrl,
        data?.data?.authorization_url,
        data?.data?.authorizationUrl
    ];

    return possibleURLs.find(
        value => typeof value === "string" && value.trim()
    ) || "";
}

function isSafePaystackURL(value) {
    try {
        const url = new URL(value);

        if (url.protocol !== "https:") {
            return false;
        }

        const hostname = url.hostname.toLowerCase();

        return (
            hostname === "paystack.com" ||
            hostname.endsWith(".paystack.com")
        );
    } catch (error) {
        return false;
    }
}

async function initializePayment(event) {
    event.preventDefault();

    clearCheckoutMessage();

    if (paymentInProgress) {
        return;
    }

    if (!validateCheckout(true)) {
        updatePaymentButton();
        return;
    }

    const { phone, email } = getCheckoutValues();

    paymentInProgress = true;
    updatePaymentButton();

    showCheckoutMessage(
        "Connecting to Paystack. Please wait and do not close this page.",
        "info"
    );

    try {
        const response = await fetchJSON(
            `${PAYMENT_API}/initialize-payment`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    phone,
                    email,
                    network: selectedBundle.network,
                    bundle: selectedBundle.size,

                    /*
                     * Compatibility field only.
                     * The backend must calculate and verify the
                     * correct price from its own trusted price table.
                     */
                    amount: selectedBundle.price
                })
            }
        );

        const authorizationURL =
            getPaystackAuthorizationURL(response);

        if (
            !authorizationURL ||
            !isSafePaystackURL(authorizationURL)
        ) {
            throw new Error(
                "The payment link could not be verified. Please contact support."
            );
        }

        showCheckoutMessage(
            "Payment page ready. Redirecting to Paystack...",
            "success"
        );

        window.location.assign(authorizationURL);

    } catch (error) {
        console.error("Payment initialization error:", error);

        showCheckoutMessage(
            error.message ||
            "We could not start your payment. Please try again.",
            "error"
        );

        paymentInProgress = false;
        updatePaymentButton();
    }
}

function initializeCheckoutForm() {
    const form = getElement("checkoutForm");

    if (!form) {
        return;
    }

    form.addEventListener("submit", initializePayment);
}


/* =========================================================
   14. WEBSITE SETTINGS
========================================================= */

function getSettingValue(settings, possibleKeys, fallback = "") {
    for (const key of possibleKeys) {
        const value = settings?.[key];

        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return fallback;
}

function parseNetworkAvailability(settings) {
    const raw = settings?.networkAvailability;

    if (!raw || typeof raw !== "object") {
        return {
            MTN: true,
            TELECEL: true,
            AIRTELTIGO: true
        };
    }

    const result = {
        MTN: true,
        TELECEL: true,
        AIRTELTIGO: true
    };

    Object.entries(raw).forEach(([key, value]) => {
        const network = normalizeNetwork(key);

        if (!network) {
            return;
        }

        if (typeof value === "boolean") {
            result[network] = value;
            return;
        }

        if (value && typeof value === "object") {
            if (typeof value.available === "boolean") {
                result[network] = value.available;
            } else if (typeof value.enabled === "boolean") {
                result[network] = value.enabled;
            }
        }
    });

    return result;
}

function isAnnouncementEnabled(settings) {
    const value = getSettingValue(
        settings,
        ["announcementEnabled", "showAnnouncement"],
        false
    );

    return value === true || value === "true" || value === 1;
}

function applyWebsiteSettings(settings) {
    websiteSettings = settings || {};

    networkAvailability = parseNetworkAvailability(
        websiteSettings
    );

    const configuredWhatsApp = getSettingValue(
        websiteSettings,
        ["supportWhatsApp", "whatsappNumber", "supportPhone"],
        DEFAULT_WHATSAPP_NUMBER
    );

    if (configuredWhatsApp) {
        whatsappNumber = String(configuredWhatsApp);
    }

    const configuredChannel = getSettingValue(
        websiteSettings,
        ["whatsappChannel", "channelUrl"],
        DEFAULT_WHATSAPP_CHANNEL
    );

    if (
        typeof configuredChannel === "string" &&
        configuredChannel.startsWith("https://")
    ) {
        whatsappChannel = configuredChannel;
    }

    updateWhatsAppLinks();
    updateChannelLinks();
    updateNetworkTabs();

    if (!isNetworkAvailable(activeNetwork)) {
        const firstAvailable = [
            "MTN",
            "TELECEL",
            "AIRTELTIGO"
        ].find(isNetworkAvailable);

        if (firstAvailable) {
            activeNetwork = firstAvailable;
        }
    }

    if (
        selectedBundle &&
        !isNetworkAvailable(selectedBundle.network)
    ) {
        selectedBundle = null;
    }

    const selectedNetworkInput = getElement("selectedNetwork");

    if (selectedNetworkInput) {
        selectedNetworkInput.value = activeNetwork;
    }

    updateNetworkTabs();
    renderBundles();
    updateSelectedSummary();
    updatePaymentButton();

    if (isAnnouncementEnabled(websiteSettings)) {
        const message = getSettingValue(
            websiteSettings,
            ["announcement", "announcementMessage", "notice"],
            ""
        );

        if (message) {
            showAnnouncement(String(message));
        }
    }
}

async function loadWebsiteSettings() {
    try {
        const response = await fetchJSON(
            `${PAYMENT_API}/website-settings`,
            {
                method: "GET"
            }
        );

        let settings = getResponseData(response);

        if (
            settings.settings &&
            typeof settings.settings === "object"
        ) {
            settings = settings.settings;
        }

        applyWebsiteSettings(settings);

    } catch (error) {
        console.warn(
            "Could not load website settings. Using default settings.",
            error
        );

        /*
         * Keep the store usable even if the settings endpoint
         * is unavailable.
         */
        updateWhatsAppLinks();
        updateChannelLinks();
        updateNetworkTabs();
        renderBundles();
        updateSelectedSummary();
        updatePaymentButton();
    }
}


/* =========================================================
   15. ANNOUNCEMENT DIALOG
========================================================= */

function showAnnouncement(message) {
    const dialog = getElement("announcement");
    const messageElement = getElement("announcementMessage");

    if (!dialog || !messageElement || !message) {
        return;
    }

    if (safelyGetStorage("kielmenAnnouncementSeen") === "true") {
        return;
    }

    setText(messageElement, message);

    dialog.hidden = false;

    if (typeof dialog.showModal === "function") {
        if (!dialog.open) {
            try {
                dialog.showModal();
            } catch (error) {
                dialog.setAttribute("open", "");
            }
        }
    } else {
        dialog.setAttribute("open", "");
    }
}

function closeAnnouncement() {
    const dialog = getElement("announcement");

    if (!dialog) {
        return;
    }

    if (typeof dialog.close === "function" && dialog.open) {
        dialog.close();
    } else {
        dialog.removeAttribute("open");
    }

    dialog.hidden = true;

    safelySetStorage("kielmenAnnouncementSeen", "true");
}

function initializeAnnouncement() {
    const dialog = getElement("announcement");
    const closeButton = getElement("continueShopping");

    if (!dialog) {
        return;
    }

    if (closeButton) {
        closeButton.addEventListener("click", closeAnnouncement);
    }

    dialog.addEventListener("click", event => {
        if (event.target === dialog) {
            closeAnnouncement();
        }
    });

    dialog.addEventListener("close", () => {
        dialog.hidden = true;
    });
}


/* =========================================================
   16. ORDER TRACKING
========================================================= */

function normalizeOrdersResponse(response) {
    if (Array.isArray(response)) {
        return response;
    }

    if (Array.isArray(response?.orders)) {
        return response.orders;
    }

    if (Array.isArray(response?.data)) {
        return response.data;
    }

    if (Array.isArray(response?.data?.orders)) {
        return response.data.orders;
    }

    if (Array.isArray(response?.data?.data?.orders)) {
        return response.data.data.orders;
    }

    return [];
}

function formatOrderDate(value) {
    if (!value) {
        return "Date unavailable";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("en-GH", {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function getOrderStatus(order) {
    return String(
        order.status ||
        order.payment_status ||
        order.delivery_status ||
        "Pending"
    ).replace(/[_-]+/g, " ");
}

function renderOrderResults(orders) {
    const container = getElement("trackOrderResults");

    if (!container) {
        return;
    }

    if (!orders.length) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No orders found</h3>
                <p>No orders were found for that phone number.</p>
                <p>Check the number and try again.</p>
            </div>
        `;

        showElement(container);
        return;
    }

    container.innerHTML = orders.map(order => {
        const network = escapeHTML(
            order.network || "Unknown network"
        );

        const bundle = escapeHTML(
            order.bundle ||
            order.size ||
            order.package ||
            "Data bundle"
        );

        const status = escapeHTML(
            getOrderStatus(order)
        );

        const orderReference = escapeHTML(
            order.reference ||
            order.order_reference ||
            order.orderReference ||
            order.id ||
            "Not provided"
        );

        const recipientPhone = escapeHTML(
            order.phone ||
            order.customer_phone ||
            order.recipient_phone ||
            "Not provided"
        );

        const amount = Number(
            order.amount ??
            order.price ??
            order.total_amount
        );

        const amountText = Number.isFinite(amount)
            ? formatMoney(amount)
            : "Not available";

        const createdAt = escapeHTML(
            formatOrderDate(
                order.created_at ||
                order.createdAt ||
                order.date
            )
        );

        return `
            <article class="tracking-order-card">
                <div class="tracking-order-header">
                    <h3>${network} — ${bundle}</h3>
                    <span class="order-status">${status}</span>
                </div>

                <p><strong>Order reference:</strong> ${orderReference}</p>
                <p><strong>Recipient:</strong> ${recipientPhone}</p>
                <p><strong>Amount:</strong> ${amountText}</p>
                <p><strong>Date:</strong> ${createdAt}</p>
            </article>
        `;
    }).join("");

    showElement(container);
}

async function trackOrders(event) {
    event.preventDefault();

    clearTrackingMessage();

    const phoneElement = getElement("trackPhone");
    const resultsElement = getElement("trackOrderResults");
    const button = getElement("trackOrderButton");

    const phone = phoneElement
        ? normalizeGhanaPhone(phoneElement.value)
        : "";

    if (!isValidGhanaPhone(phone)) {
        showTrackingMessage(
            "Enter a valid Ghana phone number, for example 0241234567.",
            "error"
        );

        return;
    }

    if (resultsElement) {
        resultsElement.innerHTML = "";
        hideElement(resultsElement);
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Searching...";
    }

    showTrackingMessage(
        "Checking your orders. Please wait...",
        "info"
    );

    try {
        const response = await fetchJSON(
            `${PAYMENT_API}/orders-by-phone/${encodeURIComponent(phone)}`,
            {
                method: "GET"
            }
        );

        const orders = normalizeOrdersResponse(response);

        clearTrackingMessage();
        renderOrderResults(orders);

    } catch (error) {
        console.error("Order tracking error:", error);

        showTrackingMessage(
            error.message ||
            "We could not retrieve your orders. Please try again later.",
            "error"
        );

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Track My Orders";
        }
    }
}

function initializeOrderTracking() {
    const form = getElement("trackOrderForm");

    if (!form) {
        return;
    }

    form.addEventListener("submit", trackOrders);
}


/* =========================================================
   17. BOTTOM NAVIGATION AND SMOOTH SCROLLING
========================================================= */

function initializeSmoothNavigation() {
    queryAll('a[href^="#"]').forEach(link => {
        link.addEventListener("click", event => {
            const href = link.getAttribute("href");

            if (!href || href === "#") {
                return;
            }

            let target;

            try {
                target = document.querySelector(href);
            } catch (error) {
                return;
            }

            if (!target) {
                return;
            }

            event.preventDefault();

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            if (link.closest("#mobileMenu")) {
                setMenuOpen(false);
            }
        });
    });
}

function initializeBottomNavigation() {
    const nav = document.querySelector(".bottom-nav");

    if (!nav) {
        return;
    }

    const links = queryAll("a", nav);

    function setActiveSection(sectionId) {
        links.forEach(link => {
            const href = link.getAttribute("href");
            const isActive = href === `#${sectionId}`;

            link.classList.toggle("active", isActive);

            if (isActive) {
                link.setAttribute("aria-current", "location");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    }

    links.forEach(link => {
        link.addEventListener("click", () => {
            const href = link.getAttribute("href");

            if (href && href.startsWith("#")) {
                setActiveSection(href.slice(1));
            }
        });
    });

    if ("IntersectionObserver" in window) {
        const sections = [
            "bundles",
            "checkout",
            "help-section"
        ]
            .map(getElement)
            .filter(Boolean);

        const observer = new IntersectionObserver(entries => {
            const visibleEntries = entries
                .filter(entry => entry.isIntersecting)
                .sort(
                    (a, b) =>
                        b.intersectionRatio - a.intersectionRatio
                );

            if (visibleEntries.length) {
                setActiveSection(visibleEntries[0].target.id);
            }
        }, {
            rootMargin: "-20% 0px -55% 0px",
            threshold: [0.1, 0.25, 0.5]
        });

        sections.forEach(section => observer.observe(section));
    }
}


/* =========================================================
   18. CURRENT YEAR
========================================================= */

function initializeCurrentYear() {
    const yearElement = getElement("currentYear");

    if (yearElement) {
        setText(yearElement, new Date().getFullYear());
    }
}


/* =========================================================
   19. GENERAL INITIALIZATION
========================================================= */

function initializeDefaultLinks() {
    updateWhatsAppLinks();
    updateChannelLinks();
}

function initializeApplication() {
    initializeMobileMenu();
    initializeNetworkTabs();
    initializeBundleSearch();
    initializeCheckoutValidation();
    initializeCheckoutForm();
    initializeOrderTracking();
    initializeAnnouncement();
    initializeSmoothNavigation();
    initializeBottomNavigation();
    initializeCurrentYear();
    initializeDefaultLinks();

    renderBundles();
    updateSelectedSummary();
    updatePaymentButton();

    loadWebsiteSettings();
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeApplication
    );
} else {
    initializeApplication();
                                              }
