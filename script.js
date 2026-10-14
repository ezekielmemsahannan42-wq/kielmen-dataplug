// ==========================================
// KIELMEN 636 DATAPLUG
// Complete Website JavaScript
// ==========================================


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


// 2. GET WEBSITE ELEMENTS

function getElement(id) {
    return document.getElementById(id);
}


// 3. POPULATE THE BUNDLE DROPDOWN

function updateBundleDropdown(network, selectedSize = "") {
    const bundleField = getElement("bundle");
    const priceField = getElement("price");

    if (!bundleField || !priceField) {
        console.error("Bundle dropdown or price field is missing.");
        return;
    }

    bundleField.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a bundle";
    bundleField.appendChild(placeholder);

    const bundles = dataPrices[network] || [];

    bundles.forEach(function(bundle) {
        const option = document.createElement("option");

        option.value = bundle.size;
        option.textContent =
            bundle.size + " — GH₵ " + bundle.price.toFixed(2);

        if (bundle.size === selectedSize) {
            option.selected = true;
        }

        bundleField.appendChild(option);
    });

    if (selectedSize) {
        const selectedBundle = bundles.find(function(bundle) {
            return bundle.size === selectedSize;
        });

        priceField.value = selectedBundle
            ? selectedBundle.price.toFixed(2)
            : "";
    } else {
        priceField.value = "";
    }
}


// 4. UPDATE THE PRICE WHEN A BUNDLE IS SELECTED

function updateSelectedPrice() {
    const networkField = getElement("network");
    const bundleField = getElement("bundle");
    const priceField = getElement("price");

    if (!networkField || !bundleField || !priceField) {
        return;
    }

    const network = networkField.value;
    const size = bundleField.value;

    const bundle = (dataPrices[network] || []).find(function(item) {
        return item.size === size;
    });

    priceField.value = bundle
        ? bundle.price.toFixed(2)
        : "";
}


// 5. DISPLAY NETWORK BUNDLES AS CARDS

function showNetwork(network) {
    const dataList = getElement("data-list");
    const networkField = getElement("network");

    if (!dataList || !dataPrices[network]) {
        console.error("Network or data-list element not found:", network);
        return;
    }

    dataList.innerHTML = "";

    dataPrices[network].forEach(function(bundle) {
        const card = document.createElement("div");
        card.className = "data-card";

        const heading = document.createElement("h3");
        heading.textContent = network;

        const size = document.createElement("p");
        size.textContent = bundle.size;

        const price = document.createElement("p");
        price.className = "price";
        price.textContent = "GH₵ " + bundle.price.toFixed(2);

        const button = document.createElement("button");
        button.type = "button";
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

    if (networkField) {
        networkField.value = network;
    }

    updateBundleDropdown(network);
}


// Allow HTML buttons to call this function.

window.showNetwork = showNetwork;


// 6. SELECT A BUNDLE FROM A CARD

function orderBundle(network, size, price) {
    const networkField = getElement("network");
    const bundleField = getElement("bundle");
    const priceField = getElement("price");
    const orderForm = getElement("order-form");

    if (!networkField || !bundleField || !priceField) {
        alert("The order form is missing required fields.");
        return;
    }

    networkField.value = network;

    updateBundleDropdown(network, size);

    bundleField.value = size;
    priceField.value = Number(price).toFixed(2);

    if (orderForm) {
        orderForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}


// Allow HTML buttons to call this function.

window.orderBundle = orderBundle;


// 7. SHOW A MESSAGE TO THE CUSTOMER

function showMessage(messageText) {
    const message = getElement("order-message");

    if (message) {
        message.textContent = messageText;
    }
}


// 8. INITIALISE THE WEBSITE

document.addEventListener("DOMContentLoaded", function() {
    const networkField = getElement("network");
    const bundleField = getElement("bundle");
    const priceField = getElement("price");
    const orderForm = getElement("order-form");

    // Load the bundles when the network changes.

    if (networkField) {
        networkField.addEventListener("change", function() {
            updateBundleDropdown(networkField.value);
        });
    }

    // Update the price when the bundle changes.

    if (bundleField) {
        bundleField.addEventListener("change", updateSelectedPrice);
    }

    // Display MTN cards when the homepage opens.

    if (getElement("data-list")) {
        showNetwork("MTN");
    }

    // Clear the initial price until a bundle is selected.

    if (priceField && bundleField && !bundleField.value) {
        priceField.value = "";
    }

    // 9. HANDLE ORDER SUBMISSION

    if (orderForm) {
        orderForm.addEventListener("submit", function(event) {
            event.preventDefault();

            const phoneField = getElement("phone");

            if (!phoneField || !networkField || !bundleField || !priceField) {
                showMessage("The order form is incomplete.");
                return;
            }

            const phone = phoneField.value.trim();
            const network = networkField.value;
            const size = bundleField.value;
            const price = Number(priceField.value);

            if (!network || !size || !phone) {
                showMessage(
                    "Please select a network, choose a bundle and enter the recipient's phone number."
                );
                return;
            }

            const cleanPhone = phone.replace(/[\s-]/g, "");

            if (!/^(0\d{9}|\+233\d{9}|233\d{9})$/.test(cleanPhone)) {
                showMessage(
                    "Please enter a valid Ghanaian phone number."
                );
                return;
            }

            const bundle = (dataPrices[network] || []).find(function(item) {
                return item.size === size;
            });

            if (!bundle || !Number.isFinite(price) ||
                price !== bundle.price) {
                showMessage(
                    "Please select your bundle again to confirm the correct price."
                );
                return;
            }

            // This prototype uses Paystack test checkout only.
            // Replace this placeholder with your own test public key.

            const publicKey = "pk_test_REPLACE_WITH_YOUR_PUBLIC_KEY";
            const email = "YOUR_EMAIL@example.com";

            if (publicKey.includes("REPLACE_WITH")) {
                showMessage(
                    "Bundle selected successfully. Paystack is not configured yet."
                );
                return;
            }

            if (typeof PaystackPop === "undefined") {
                showMessage(
                    "Paystack did not load. Please refresh and try again."
                );
                return;
            }

            try {
                const popup = new PaystackPop();

                popup.newTransaction({
                    key: publicKey,
                    email: email,
                    amount: Math.round(bundle.price * 100),
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
                                value: size
                            }
                        ]
                    },

                    onSuccess: function(transaction) {
                        showMessage(
                            "Test payment completed. Reference: " +
                            transaction.reference +
                            ". Data has NOT been delivered automatically."
                        );
                    },

                    onCancel: function() {
                        showMessage("Payment was cancelled.");
                    },

                    onError: function(error) {
                        showMessage(
                            "Payment error: " +
                            (error.message || "Please try again.")
                        );
                    }
                });
            } catch (error) {
                console.error("Paystack error:", error);
                showMessage("Unable to open checkout. Please try again.");
            }
        });
    }
});
