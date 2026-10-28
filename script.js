"use strict";

/* =========================================================
   KIELMEN 636 DATAPLUG
   FILE 3: script.js

   Compatible with index.html and style.css.
   Includes:
   - Mobile navigation
   - Desktop navigation
   - Network tabs and coloured bundle cards
   - Bundle search and selection
   - Paystack checkout
   - Website settings
   - Announcement dialog
   - WhatsApp support
   - Order tracking
   - Bottom navigation

   SECURITY:
   The backend must independently validate bundle prices.
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
let trackingInProgress = false;

let networkAvailability = {
    MTN: true,
    TELECEL: true,
    AIRTELTIGO: true
};

let websiteSettings = {};

let whatsappNumber = DEFAULT_WHATSAPP_NUMBER;
let whatsappChannel = DEFAULT_WHATSAPP_CHANNEL;


/* =========================================================
   4. DOM AND GENERAL HELPERS
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
    return /^0\d{9}$/.test(normalizeGhanaPhone(phone));
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        String(email || "").trim()
    );
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
        // The site remains usable when session storage is unavailable.
    }
}


/* =========================================================
   5. API HELPERS
========================================================= */

async function fetchJSON(url, options = {}) {
    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
        controller.abort();
    }, 25000);

    try {
        const response = await fetch(url, {
            ...options,
            signal: options.signal || controller.signal,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

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
            throw new Error(
                result.message ||
                result.error ||
                `Request failed with status ${response.status}.`
            );
        }

        return result;
    } finally {
        window.clearTimeout(timeout);
    }
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
   6. CHECKOUT AND TRACKING MESSAGES
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
   7. RESPONSIVE NAVIGATION
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
        shouldOpen
            ? "Close navigation menu"
            : "Open navigation menu"
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
        event.stopPropagation();

        setMenuOpen(menu.hidden);
    });

    menu.addEventListener("click", event => {
        const link = event.target.closest("a");

        if (link) {
            setMenuOpen(false);
        }
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

    /*
     * Close the mobile menu when switching to desktop layout.
     */
    window.addEventListener("resize", () => {
        if (window.innerWidth >= 900) {
            setMenuOpen(false);
        }
    });
}

function initializeDesktopNavigation() {
    const desktopNav = getElement("desktopNav");

    if (!desktopNav) {
        return;
    }

    const links = queryAll("a[href]", desktopNav);

    function setActiveLink(link) {
        links.forEach(item => {
            const active = item === link;

            item.classList.toggle("active", active);

            if (active) {
                item.setAttribute("aria-current", "location");
            } else {
                item.removeAttribute("aria-current");
            }
        });
    }

    links.forEach(link => {
        link.addEventListener("click", () => {
            const href = link.getAttribute("href");

            if (href && href.startsWith("#")) {
                setActiveLink(link);
            } else if (href === "index.html") {
                setActiveLink(link);
            }
        });
    });

    if ("IntersectionObserver" in window) {
        const sections = [
            "bundles",
            "checkout",
            "track-order",
            "agent-section"
        ]
            .map(getElement)
            .filter(Boolean);

        const observer = new IntersectionObserver(entries => {
            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort(
                    (a, b) =>
                        b.intersectionRatio - a.intersectionRatio
                );

            if (!visible.length) {
                return;
            }

            const sectionId = visible[0].target.id;

            const matchingLink = links.find(
                link => link.getAttribute("href") === `#${sectionId}`
            );

            if (matchingLink) {
                setActiveLink(matchingLink);
            }
        }, {
            rootMargin: "-15% 0px -65% 0px",
            threshold: [0.1, 0.25, 0.5]
        });

        sections.forEach(section => observer.observe(section));
    }
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

    const displayElement = getElement("supportPhoneDisplay");

    if (displayElement) {
        setText(
            displayElement,
            getWhatsAppDisplayNumber(cleanNumber)
        );

        displayElement.href = `tel:+${cleanNumber}`;
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
   9. NETWORK TABS AND AVAILABILITY
========================================================= */

function isNetworkAvailable(network) {
    return networkAvailability[network] !== false;
}

function updateNetworkTabs() {
    queryAll(".network-tab").forEach(tab => {
        const network = normalizeNetwork(tab.dataset.network);

        const active = network === activeNetwork;
        const available = network && isNetworkAvailable(network);

        tab.disabled = !available;

        tab.classList.toggle("active", active);
        tab.classList.toggle("unavailable", !available);

        tab.setAttribute(
            "aria-pressed",
            active ? "true" : "false"
        );

        if (!available) {
            tab.setAttribute(
                "aria-label",
                `${network || "This network"} is temporarily unavailable`
            );
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

    const networkInput = getElement("selectedNetwork");
    const sizeInput = getElement("selectedSize");

    if (networkInput) {
        networkInput.value = activeNetwork;
    }

    if (sizeInput) {
        sizeInput.value = "";
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
    return Array.isArray(DEFAULT_PRODUCTS[network])
        ? DEFAULT_PRODUCTS[network]
        : [];
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

    const products = getProductsForNetwork(activeNetwork);

    const filteredProducts = products.filter(product => {
        const searchableText =
            `${product.size} ${activeNetwork} ${product.price}`.toLowerCase();

        return searchableText.includes(searchTerm);
    });

    setText(
        resultCount,
        `${filteredProducts.length} package${filteredProducts.length === 1 ? "" : "s"} available`
    );

    if (!filteredProducts.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>No bundles found</h3>
                <p>Try a different search or select another network.</p>
            </div>
        `;

        return;
    }

    grid.innerHTML = filteredProducts.map(product => {
        const isSelected = Boolean(
            selectedBundle &&
            selectedBundle.network === activeNetwork &&
            selectedBundle.size === product.size
        );

        return `
            <article
                class="bundle-card"
                data-network="${activeNetwork}"
            >
                <div class="bundle-card-top">
                    <span class="bundle-network">
                        ${escapeHTML(activeNetwork)}
                    </span>

                    <span class="bundle-badge">
                        DATA BUNDLE
                    </span>
                </div>

                <div class="bundle-size">
                    ${escapeHTML(product.size)}
                </div>

                <div class="bundle-price">
                    ${formatMoney(product.price)}
                </div>

                <button
                    type="button"
                    class="buy-button"
                    data-buy-network="${activeNetwork}"
                    data-buy-size="${escapeHTML(product.size)}"
                    aria-label="Buy ${escapeHTML(product.size)} ${activeNetwork} bundle for ${formatMoney(product.price)}"
                >
                    ${isSelected ? "Selected ✓" : "Buy Bundle"}
                </button>
            </article>
        `;
    }).join("");

    queryAll("[data-buy-network]", grid).forEach(button => {
        button.addEventListener("click", () => {
            chooseBundle(
                button.dataset.buyNetwork,
                button.dataset.buySize
            );
        });
    });
}

function initializeBundleSearch() {
    const searchInput = getElement("bundleSearch");

    if (searchInput) {
        searchInput.addEventListener("input", renderBundles);
    }
}


/* =========================================================
   11. SELECTING A BUNDLE
========================================================= */

function chooseBundle(network, size) {
    const normalizedNetwork = normalizeNetwork(network);

    if (
        !normalizedNetwork ||
        !isNetworkAvailable(normalizedNetwork)
    ) {
        showCheckoutMessage(
            "This network is currently unavailable. Please choose another one.",
            "error"
        );

        return;
    }

    const product = getProductsForNetwork(normalizedNetwork)
        .find(item => item.size === size);

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

    const networkInput = getElement("selectedNetwork");
    const sizeInput = getElement("selectedSize");

    if (networkInput) {
        networkInput.value = selectedBundle.network;
    }

    if (sizeInput) {
        sizeInput.value = selectedBundle.size;
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
    const bundleElement = getElement("selectedBundle");
    const priceElement = getElement("selectedPrice");

    if (!selectedBundle) {
        setText(bundleElement, "Choose a bundle above");
        setText(priceElement, "GH₵0.00");
        return;
    }

    setText(
        bundleElement,
        `${selectedBundle.network} ${selectedBundle.size}`
    );

    setText(priceElement, formatMoney(selectedBundle.price));
}


/* =========================================================
   12. CHECKOUT VALIDATION
========================================================= */

function getCheckoutValues() {
    return {
        phone: normalizeGhanaPhone(
            getElement("customerPhone")?.value || ""
        ),

        email: String(
            getElement("customerEmail")?.value || ""
        ).trim()
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

    const ready =
        isValidGhanaPhone(phone) &&
        isValidEmail(email) &&
        isNetworkAvailable(selectedBundle.network);

    button.disabled = !ready;

    button.textContent = ready
        ? `Pay ${formatMoney(selectedBundle.price)} Securely`
        : "Enter Your Details";
}

function initializeCheckoutValidation() {
    const phone = getElement("customerPhone");
    const email = getElement("customerEmail");

    [phone, email].forEach(element => {
        if (!element) {
            return;
        }

        element.addEventListener("input", () => {
            element.setCustomValidity("");
            updatePaymentButton();
        });

        element.addEventListener("blur", () => {
            if (
                element === phone &&
                element.value.trim() &&
                !isValidGhanaPhone(element.value)
            ) {
                element.setCustomValidity(
                    "Enter a valid Ghana phone number."
                );
            } else if (
                element === email &&
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
    });

    updatePaymentButton();
}


/* =========================================================
   13. PAYSTACK CHECKOUT
========================================================= */

function getPaystackAuthorizationURL(response) {
    const data = getResponseData(response);

    const candidates = [
        response?.authorization_url,
        response?.authorizationUrl,
        data?.authorization_url,
        data?.authorizationUrl,
        data?.data?.authorization_url,
        data?.data?.authorizationUrl
    ];

    return candidates.find(
        value => typeof value === "string" && value.trim()
    ) || "";
}

function isSafePaystackURL(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "https:" &&
            (
                url.hostname === "paystack.com" ||
                url.hostname.endsWith(".paystack.com")
            )
        );
    } catch (error) {
        return false;
    }
}

async function initializePayment(event) {
    event.preventDefault();

    if (paymentInProgress) {
        return;
    }

    clearCheckoutMessage();

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
                     * Compatibility only.
                     * The backend must calculate the real price
                     * from its own trusted price table.
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

    if (form) {
        form.addEventListener("submit", initializePayment);
    }
}


/* =========================================================
   14. WEBSITE SETTINGS
========================================================= */

function getSettingValue(settings, keys, fallback = "") {
    for (const key of keys) {
        const value = settings?.[key];

        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return fallback;
}

function parseNetworkAvailability(settings) {
    const raw = settings?.networkAvailability;

    const result = {
        MTN: true,
        TELECEL: true,
        AIRTELTIGO: true
    };

    if (!raw || typeof raw !== "object") {
        return result;
    }

    Object.entries(raw).forEach(([key, value]) => {
        const network = normalizeNetwork(key);

        if (!network) {
            return;
        }

        if (typeof value === "boolean") {
            result[network] = value;
        } else if (value && typeof value === "object") {
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
        /^https:\/\/\S+$/i.test(configuredChannel)
    ) {
        whatsappChannel = configuredChannel;
    }

    updateWhatsAppLinks();
    updateChannelLinks();

    if (!isNetworkAvailable(activeNetwork)) {
        const firstAvailable = [
            "MTN",
            "TELECEL",
            "AIRTELTIGO"
        ].find(isNetworkAvailable);

        if (firstAvailable) {
            activeNetwork = firstAvailable;
        } else {
            selectedBundle = null;
        }
    }

    if (
        selectedBundle &&
        !isNetworkAvailable(selectedBundle.network)
    ) {
        selectedBundle = null;
    }

    const networkInput = getElement("selectedNetwork");
    const sizeInput = getElement("selectedSize");

    if (networkInput) {
        networkInput.value = activeNetwork;
    }

    if (sizeInput) {
        sizeInput.value = selectedBundle?.size || "";
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
            { method: "GET" }
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
            "Website settings could not be loaded. Default settings will be used.",
            error
        );

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

    if (
        safelyGetStorage("kielmenAnnouncementSeen") === "true"
    ) {
        return;
    }

    setText(messageElement, message);

    dialog.hidden = false;

    if (
        typeof dialog.showModal === "function" &&
        !dialog.open
    ) {
        try {
            dialog.showModal();
        } catch (error) {
            dialog.setAttribute("open", "");
        }
    } else if (!dialog.open) {
        dialog.setAttribute("open", "");
    }
}

function closeAnnouncement() {
    const dialog = getElement("announcement");

    if (!dialog) {
        return;
    }

    if (dialog.open && typeof dialog.close === "function") {
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
   16. ORDER TRACKING — KIELMEN 636 DATAPLUG

   Features:
   - Separate payment and delivery statuses
   - Paid / Not Paid
   - Processing / On Hold / Delivered / Delivery Failed
   - Order reference, recipient, amount and date
   - Copy all order details
   - Safe handling of unknown payment statuses

   IMPORTANT:
   The backend must return actual payment and delivery statuses.
   Never assume payment succeeded or failed based on delivery status.
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


/* ---------------------------------------------------------
   DATE FORMATTING
--------------------------------------------------------- */

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


/* ---------------------------------------------------------
   READ PAYMENT STATUS

   Only explicit payment information determines whether
   an order is Paid or Not Paid.
--------------------------------------------------------- */

function getPaymentStatus(order) {
    const raw = String(
        order.paymentStatus ??
        order.payment_status ??
        order.paymentState ??
        order.payment_state ??
        ""
    ).trim().toLowerCase();

    if (
        [
            "paid",
            "success",
            "successful",
            "succeeded",
            "complete",
            "completed",
            "verified"
        ].includes(raw)
    ) {
        return {
            label: "Paid",
            className: "success"
        };
    }

    if (
        [
            "not_paid",
            "not paid",
            "unpaid",
            "failed",
            "cancelled",
            "canceled",
            "abandoned",
            "expired"
        ].includes(raw)
    ) {
        return {
            label: "Not Paid",
            className: "failed"
        };
    }

    if (
        [
            "pending",
            "processing",
            "ongoing",
            "initiated",
            "awaiting_payment",
            "awaiting payment"
        ].includes(raw)
    ) {
        return {
            label: "Pending",
            className: "pending"
        };
    }

    // Do not guess if the backend did not return a clear status.
    return {
        label: "Payment Status Unavailable",
        className: "unknown"
    };
}


/* ---------------------------------------------------------
   READ DELIVERY STATUS

   Delivery status is independent of payment status.
--------------------------------------------------------- */

function getDeliveryStatus(order) {
    const raw = String(
        order.deliveryStatus ??
        order.delivery_status ??
        order.supplierStatus ??
        order.supplier_status ??
        order.deliveryState ??
        order.delivery_state ??
        ""
    ).trim().toLowerCase();

    if (
        [
            "delivered",
            "delivery_success",
            "delivery_successful",
            "success",
            "successful"
        ].includes(raw)
    ) {
        return {
            label: "Delivered",
            className: "success",
            description:
                "The data supplier has reported successful delivery."
        };
    }

    if (
        [
            "on_hold",
            "on hold",
            "hold",
            "held",
            "verifying",
            "verification",
            "awaiting_verification",
            "awaiting verification"
        ].includes(raw)
    ) {
        return {
            label: "On Hold",
            className: "pending",
            description:
                "This order is awaiting further verification or resolution. Check the latest status before taking action."
        };
    }

    if (
        [
            "processing",
            "in_progress",
            "in progress",
            "queued",
            "accepted",
            "submitted",
            "pending"
        ].includes(raw)
    ) {
        return {
            label: "Processing",
            className: "processing",
            description:
                "Your order is being processed. Check again for the latest delivery status."
        };
    }

    if (
        [
            "failed",
            "delivery_failed",
            "delivery failed",
            "rejected",
            "error"
        ].includes(raw)
    ) {
        return {
            label: "Delivery Failed",
            className: "failed",
            description:
                "The delivery attempt was reported as unsuccessful. Please contact support for assistance."
        };
    }

    if (
        [
            "cancelled",
            "canceled"
        ].includes(raw)
    ) {
        return {
            label: "Cancelled",
            className: "failed",
            description:
                "This order has been marked as cancelled."
        };
    }

    return {
        label: "Status Unavailable",
        className: "unknown",
        description:
            "The latest delivery status is not available. Please check again later or contact support."
    };
}


/* ---------------------------------------------------------
   FORMAT ORDER AMOUNT
--------------------------------------------------------- */

function getOrderAmount(order) {
    const rawAmount =
        order.amount ??
        order.price ??
        order.total_amount ??
        order.totalAmount;

    if (
        rawAmount === undefined ||
        rawAmount === null ||
        rawAmount === ""
    ) {
        return "Not available";
    }

    const amount = Number(rawAmount);

    if (!Number.isFinite(amount) || amount < 0) {
        return "Not available";
    }

    return formatMoney(amount);
}


/* ---------------------------------------------------------
   COPY ORDER DETAILS

   Uses the Clipboard API where available, with a fallback.
--------------------------------------------------------- */

async function copyOrderDetails(text, button) {
    const originalText = button.textContent;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const temporaryInput = document.createElement("textarea");

            temporaryInput.value = text;
            temporaryInput.setAttribute("readonly", "");
            temporaryInput.style.position = "fixed";
            temporaryInput.style.opacity = "0";

            document.body.appendChild(temporaryInput);

            temporaryInput.select();

            const copied = document.execCommand("copy");

            temporaryInput.remove();

            if (!copied) {
                throw new Error("Copy was unsuccessful.");
            }
        }

        button.textContent = "✓ Copied!";
        button.classList.add("copied");

    } catch (error) {
        console.warn("Could not copy order details:", error);

        button.textContent = "Copy unavailable";
    }

    window.setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("copied");
    }, 1800);
}


/* ---------------------------------------------------------
   RENDER TRACKING RESULTS
--------------------------------------------------------- */

function renderOrderResults(orders) {
    const container = getElement("trackOrderResults");

    if (!container) {
        return;
    }

    if (!orders.length) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No orders found</h3>
                <p>
                    We could not find any orders for that phone number.
                </p>
                <p>
                    Check the number and try again.
                </p>
            </div>
        `;

        showElement(container);
        return;
    }

    container.innerHTML = orders.map((order, index) => {
        const network = escapeHTML(
            normalizeNetwork(order.network) ||
            order.network ||
            "Unknown network"
        );

        const bundle = escapeHTML(
            order.bundle ||
            order.size ||
            order.package ||
            order.bundle_size ||
            "Data bundle"
        );

        const referenceValue =
            order.reference ||
            order.order_reference ||
            order.orderReference ||
            order.payment_reference ||
            order.id ||
            "Not provided";

        const recipientValue =
            order.phone ||
            order.customer_phone ||
            order.recipient_phone ||
            order.recipientPhone ||
            "Not provided";

        const reference = escapeHTML(referenceValue);
        const recipient = escapeHTML(recipientValue);

        const amountText = getOrderAmount(order);

        const createdAt = escapeHTML(
            formatOrderDate(
                order.created_at ||
                order.createdAt ||
                order.date ||
                order.created
            )
        );

        const payment = getPaymentStatus(order);
        const delivery = getDeliveryStatus(order);

        const safePaymentLabel = escapeHTML(payment.label);
        const safeDeliveryLabel = escapeHTML(delivery.label);
        const safeDeliveryDescription =
            escapeHTML(delivery.description);

        const copyText = [
            "KIELMEN 636 DATAPLUG — ORDER DETAILS",
            `Network: ${network}`,
            `Bundle: ${bundle}`,
            `Payment status: ${payment.label}`,
            `Delivery status: ${delivery.label}`,
            `Order reference: ${referenceValue}`,
            `Recipient: ${recipientValue}`,
            `Amount: ${amountText}`,
            `Date: ${createdAt}`
        ].join("\n");

        return `
            <article
                class="tracking-result kielmen-order-card"
                data-order-index="${index}"
            >
                <div class="tracking-order-header">
                    <div class="kielmen-order-title">
                        <h3>${network} — ${bundle}</h3>
                        <span class="kielmen-order-amount">
                            ${escapeHTML(amountText)}
                        </span>
                    </div>
                </div>

                <div class="kielmen-status-row">
                    <span class="kielmen-status-label">
                        Payment
                    </span>

                    <span class="order-status ${payment.className}">
                        ${safePaymentLabel}
                    </span>
                </div>

                <div class="kielmen-status-row">
                    <span class="kielmen-status-label">
                        Delivery
                    </span>

                    <span class="order-status ${delivery.className}">
                        ${safeDeliveryLabel}
                    </span>
                </div>

                <div class="kielmen-order-detail">
                    <span class="kielmen-detail-label">
                        Order reference
                    </span>

                    <span class="kielmen-detail-value">
                        ${reference}
                    </span>
                </div>

                <div class="kielmen-order-detail">
                    <span class="kielmen-detail-label">
                        Recipient
                    </span>

                    <span class="kielmen-detail-value">
                        ${recipient}
                    </span>
                </div>

                <div class="kielmen-order-detail">
                    <span class="kielmen-detail-label">
                        Amount
                    </span>

                    <span class="kielmen-detail-value">
                        ${escapeHTML(amountText)}
                    </span>
                </div>

                <div class="kielmen-order-detail">
                    <span class="kielmen-detail-label">
                        Date
                    </span>

                    <span class="kielmen-detail-value">
                        ${createdAt}
                    </span>
                </div>

                <div class="kielmen-delivery-message ${delivery.className}">
                    <strong>
                        ${safeDeliveryLabel}
                    </strong>

                    <p>${safeDeliveryDescription}</p>
                </div>

                <button
                    type="button"
                    class="kielmen-copy-order-button"
                    data-copy-order="${index}"
                >
                    ▢ Copy All Details
                </button>
            </article>
        `;
    }).join("");

    queryAll("[data-copy-order]", container).forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.copyOrder);

            if (!Number.isInteger(index) || !orders[index]) {
                return;
            }

            const order = orders[index];

            const payment = getPaymentStatus(order);
            const delivery = getDeliveryStatus(order);

            const details = [
                "KIELMEN 636 DATAPLUG — ORDER DETAILS",
                `Network: ${order.network || "Unknown network"}`,
                `Bundle: ${
                    order.bundle ||
                    order.size ||
                    order.package ||
                    "Data bundle"
                }`,
                `Payment status: ${payment.label}`,
                `Delivery status: ${delivery.label}`,
                `Order reference: ${
                    order.reference ||
                    order.order_reference ||
                    order.orderReference ||
                    order.payment_reference ||
                    order.id ||
                    "Not provided"
                }`,
                `Recipient: ${
                    order.phone ||
                    order.customer_phone ||
                    order.recipient_phone ||
                    order.recipientPhone ||
                    "Not provided"
                }`,
                `Amount: ${getOrderAmount(order)}`,
                `Date: ${formatOrderDate(
                    order.created_at ||
                    order.createdAt ||
                    order.date ||
                    order.created
                )}`
            ].join("\n");

            copyOrderDetails(details, button);
        });
    });

    showElement(container);
}


/* ---------------------------------------------------------
   FIND ORDERS BY PHONE NUMBER
--------------------------------------------------------- */

async function trackOrders(event) {
    event.preventDefault();

    if (trackingInProgress) {
        return;
    }

    clearTrackingMessage();

    const phoneElement = getElement("trackPhone");
    const resultsElement = getElement("trackOrderResults");
    const button = getElement("trackOrderButton");

    const phone = normalizeGhanaPhone(
        phoneElement?.value || ""
    );

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

    trackingInProgress = true;

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
            { method: "GET" }
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
        trackingInProgress = false;

        if (button) {
            button.disabled = false;
            button.textContent = "Find My Orders";
        }
    }
}


/* ---------------------------------------------------------
   INITIALIZE ORDER TRACKING
--------------------------------------------------------- */

function initializeOrderTracking() {
    const form = getElement("trackOrderForm");

    if (form) {
        form.addEventListener("submit", trackOrders);
    }
}


/* =========================================================
   17. SMOOTH NAVIGATION
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


/* =========================================================
   18. BOTTOM NAVIGATION
========================================================= */

function initializeBottomNavigation() {
    const nav = document.querySelector(".bottom-nav");

    if (!nav) {
        return;
    }

    const links = queryAll("a", nav);

    function setActiveSection(sectionId) {
        links.forEach(link => {
            const active =
                link.getAttribute("href") === `#${sectionId}`;

            link.classList.toggle("active", active);

            if (active) {
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
   19. CURRENT YEAR
========================================================= */

function initializeCurrentYear() {
    const yearElement = getElement("currentYear");

    if (yearElement) {
        setText(yearElement, new Date().getFullYear());
    }
}


/* =========================================================
   20. GENERAL INITIALIZATION
========================================================= */

function initializeDefaultLinks() {
    updateWhatsAppLinks();
    updateChannelLinks();
}

function initializeApplication() {
    initializeMobileMenu();
    initializeDesktopNavigation();

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
