// =============================================
// KIELMEN 636 DATAPLUG
// COMPLETE AND CORRECTED JAVASCRIPT
// =============================================


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


// 2. HELPER FUNCTION

function getElement(id) {
    return document.getElementById(id);
}


// 3. UPDATE BUNDLE DROPDOWN

function updateBundleDropdown(network, selectedSize = "") {
    const bundleField = getElement("bundle");
    const priceField = getElement("price");

    if (!bundleField || !priceField) {
        console.error("Bundle or price field is missing.");
        return;
    }

    // Clear old options.
    bundleField.innerHTML = "";

    // Add the placeholder.
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a bundle";
    bundleField.appendChild(placeholder);

    // Get bundles for the selected network.
    const bundles = dataPrices[network] || [];

    bundles.forEach(function(bundle) {
        const option = document.createElement("option");

        option.value = bundle.size;
        option.textContent =
            bundle.size + " — GH₵ " + bundle.price.toFixed(2);

        bundleField.appendChild(option);
    });

    // Select the requested bundle if it exists.
    if (selectedSize && bundles.some(function(bundle) {
        return bundle.size === selectedSize;
    })) {
        bundleField.value = selectedSize;
    } else {
        bundleField.value = "";
    }

    // Update the price.
    updateSelectedPrice();
}


// 4. UPDATE PRICE BASED ON SELECTED BUNDLE

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

    // Keep the price empty until a bundle is selected.
    priceField.value = bundle
        ? bundle.price.toFixed(2)
        : "";
}


// 5. DISPLAY NETWORK BUNDLE CARDS

function showNetwork(network) {
    const dataList = getElement("data-list");

    if (!dataList || !dataPrices[network]) {
        console.error("Could not display bundles for:", network);
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
            orderBundle(network, bundle.size);
        });

        card.appendChild(heading);
        card.appendChild(size);
        card.appendChild(price);
        card.appendChild(button);

        dataList.appendChild(card);
    });

    const networkField = getElement("network");

    if (networkField) {
        networkField.value = network;
    }

    updateBundleDropdown(network);
}


// Make the function available to HTML buttons.

window.showNetwork = showNetwork;


// 6. ORDER A SELECTED BUNDLE

function orderBundle(network, size) {
    const networkField = getElement("network");
    const orderForm = getElement("order-form");

    if (!networkField || !getElement("bundle") || !getElement("price")) {
        alert("The order form is missing required fields.");
        return;
    }

    networkField.value = network;

    updateBundleDropdown(network, size);

    if (orderForm) {
        orderForm.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}

window.orderBundle = orderBundle;


// 7. DISPLAY ORDER MESSAGES

function showMessage(messageText) {
    const message = getElement("order-message");

    if (message) {
        message.textContent = messageText;
    } else {
        alert(messageText);
    }
}


// 8. INITIALISE THE WEBSITE

document.addEventListener("DOMContentLoaded", function() {
    const networkField = getElement("network");
    const bundleField = getElement("bundle");
    const priceField = getElement("price");
    const orderForm = getElement("order-form");

    // When the network changes, load its bundle options.

    if (networkField) {
        networkField.addEventListener("change", function() {
            updateBundleDropdown(networkField.value);
        });

        // Load options for the initially selected network.
        updateBundleDropdown(networkField.value);
    }

    // When the bundle changes, update the price.

    if (bundleField) {
        bundleField.addEventListener("change", updateSelectedPrice);
    }

    // Display MTN cards on the homepage.

    if (getElement("data-list")) {
        showNetwork("MTN");
    }


    // 9. HANDLE ORDER FORM SUBMISSION

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

            // Find the official price from our price list.
            const bundle = (dataPrices[network] || []).find(function(item) {
                return item.size === size;
            });

            if (!network || !size || !bundle) {
                showMessage("Please select a network and bundle first.");
                return;
            }

            if (!phone) {
                showMessage("Please enter the recipient's phone number.");
                return;
            }

            const cleanPhone = phone.replace(/[\s-]/g, "");

            if (!/^(0\d{9}|\+233\d{9}|233\d{9})$/.test(cleanPhone)) {
                showMessage("Please enter a valid Ghanaian phone number.");
                return;
            }

            // Always use the price from our data list.
            priceField.value = bundle.price.toFixed(2);

            // Checkout is intentionally not enabled until configured.
            showMessage(
                "Your selection is " + network + " " + size +
                " for GH₵ " + bundle.price.toFixed(2) +
                ". Paystack checkout is not configured yet."
            );
        });
    }
});
