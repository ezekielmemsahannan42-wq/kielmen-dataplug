// ========================================
// KIELMEN 636 DATAPLUG
// Main JavaScript File
// ========================================


// 1. DATA BUNDLE PRICES

const dataPrices = {
    MTN: [
        { size: "1GB", price: 4.50 },
        { size: "2GB", price: 9.00 },
        { size: "3GB", price: 13.00 },
        { size: "4GB", price: 17.50 },
        { size: "5GB", price: 21.00 },
        { size: "6GB", price: 25.00 },
        { size: "8GB", price: 34.00 },
        { size: "10GB", price: 42.00 },
        { size: "15GB", price: 59.00 },
        { size: "20GB", price: 79.00 },
        { size: "25GB", price: 98.00 },
        { size: "30GB", price: 119.00 },
        { size: "40GB", price: 157.00 },
        { size: "50GB", price: 197.00 }
    ],

    AirtelTigo: [
        { size: "1GB", price: 5.00 },
        { size: "2GB", price: 9.20 },
        { size: "5GB", price: 22.00 },
        { size: "10GB", price: 41.00 },
        { size: "20GB", price: 78.00 },
        { size: "30GB", price: 115.00 },
        { size: "50GB", price: 188.00 }
    ],

    Telecel: [
        { size: "10GB", price: 42.00 },
        { size: "15GB", price: 57.00 },
        { size: "20GB", price: 72.00 },
        { size: "25GB", price: 93.00 },
        { size: "30GB", price: 111.00 },
        { size: "40GB", price: 145.00 },
        { size: "50GB", price: 179.00 },
        { size: "100GB", price: 402.00 }
    ]
};


// 2. DISPLAY BUNDLES FOR A NETWORK

function showNetwork(network) {
    const dataList = document.getElementById("data-list");

    if (!dataList) {
        console.error("The data-list element was not found.");
        return;
    }

    if (!dataPrices[network]) {
        dataList.textContent = "Network not found. Please try again.";
        return;
    }

    dataList.innerHTML = "";

    dataPrices[network].forEach(function(bundle) {
        const card = document.createElement("div");
        card.className = "data-card";

        const heading = document.createElement("h3");
        heading.textContent = network;

        const size = document.createElement("p");
        size.textContent = "Bundle: " + bundle.size;

        const price = document.createElement("p");
        price.className = "price";
        price.textContent = "GH₵ " + bundle.price.toFixed(2);

        const button = document.createElement("button");
        button.className = "buy-button";
        button.textContent = "Order";

        button.addEventListener("click", function() {
            orderBundle(network, bundle.size, bundle.price);
        });

        card.appendChild(heading);
        card.appendChild(size);
        card.appendChild(price);
        card.appendChild(button);

        dataList.appendChild(card);
    });
}


// Make showNetwork available to HTML buttons.

window.showNetwork = showNetwork;


// 3. SELECT A BUNDLE AND FILL THE ORDER FORM

function orderBundle(network, size, price) {
    const networkField = document.getElementById("network");
    const bundleField = document.getElementById("bundle");
    const priceField = document.getElementById("price");

    if (!networkField || !bundleField || !priceField) {
        alert("The order form is missing some fields. Please check index.html.");
        return;
    }

    networkField.value = network;
    bundleField.value = size;
    priceField.value = price.toFixed(2);

    const orderForm = document.getElementById("order-form");

    if (orderForm) {
        orderForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}


// Make orderBundle available to HTML.

window.orderBundle = orderBundle;


// 4. INITIALISE THE WEBSITE

document.addEventListener("DOMContentLoaded", function() {

    // Connect the network buttons.
    const networkButtons = document.querySelectorAll(
        'button[onclick*="showNetwork"], button[data-network]'
    );

    networkButtons.forEach(function(button) {
        button.addEventListener("click", function() {
            const network = button.dataset.network;

            if (network) {
                showNetwork(network);
            }
        });
    });

    // Display MTN bundles automatically when the page opens.
    showNetwork("MTN");

});


// 5. HANDLE THE ORDER FORM AND PAYSTACK TEST CHECKOUT

document.addEventListener("DOMContentLoaded", function() {

    const orderForm = document.getElementById("order-form");

    if (!orderForm) {
        console.warn("Order form not found.");
        return;
    }

    orderForm.addEventListener("submit", function(event) {
        event.preventDefault();

        const phoneField = document.getElementById("phone");
        const networkField = document.getElementById("network");
        const bundleField = document.getElementById("bundle");
        const priceField = document.getElementById("price");
        const message = document.getElementById("order-message");

        if (!phoneField || !networkField ||
            !bundleField || !priceField) {
            alert("Please check the order form fields.");
            return;
        }

        const phone = phoneField.value.trim();
        const network = networkField.value;
        const bundle = bundleField.value;
        const price = Number(priceField.value);

        if (!phone || !network || !bundle ||
            !Number.isFinite(price) || price <= 0) {

            if (message) {
                message.textContent =
                    "Please select a bundle and enter the recipient's phone number.";
            }

            return;
        }

        // Basic Ghana phone number validation.
        const cleanPhone = phone.replace(/[\s-]/g, "");

        if (!/^(0\d{9}|\+233\d{9}|233\d{9})$/.test(cleanPhone)) {
            if (message) {
                message.textContent =
                    "Please enter a valid Ghanaian phone number.";
            }

            return;
        }

        // This is only a test checkout.
        if (message) {
            message.textContent =
                "Preparing Paystack test checkout...";
        }

        if (typeof PaystackPop === "undefined") {
            if (message) {
                message.textContent =
                    "Paystack could not load. Please refresh and try again.";
            }

            return;
        }

        const publicKey = "pk_test_REPLACE_WITH_YOUR_PUBLIC_KEY";

        if (publicKey === "pk_test_REPLACE_WITH_YOUR_PUBLIC_KEY") {
            if (message) {
                message.textContent =
                    "Your Paystack test public key has not been added yet.";
            }

            return;
        }

        try {
            const popup = new PaystackPop();

            popup.newTransaction({
                key: publicKey,

                // Replace with your own customer-support email.
                email: "YOUR_EMAIL@example.com",

                amount: Math.round(price * 100),
                currency: "GHS",

                metadata: {
                    custom_fields: [
                        {
                            display_name: "Recipient Phone",
                            variable_name: "recipient_phone",
                            value: cleanPhone
                        },
                        {
                            display_name: "Network",
                            variable_name: "network",
                            value: network
                        },
                        {
                            display_name: "Bundle",
                            variable_name: "bundle",
                            value: bundle
                        }
                    ]
                },

                onSuccess: function(transaction) {
                    if (message) {
                        message.textContent =
                            "Test payment completed. Reference: " +
                            transaction.reference +
                            ". Your data has NOT been delivered automatically.";
                    }
                },

                onCancel: function() {
                    if (message) {
                        message.textContent =
                            "Payment was cancelled.";
                    }
                },

                onError: function(error) {
                    if (message) {
                        message.textContent =
                            "Payment error: " +
                            (error.message || "Please try again.");
                    }
                }
            });

        } catch (error) {
            console.error("Paystack error:", error);

            if (message) {
                message.textContent =
                    "Unable to open checkout. Please try again.";
            }
        }
    });

});
