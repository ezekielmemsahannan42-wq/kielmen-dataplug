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

function showNetwork(network) {
    const dataList = document.getElementById("data-list");
    dataList.innerHTML = "";

    dataPrices[network].forEach(bundle => {
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
        button.className = "buy-button";
        button.textContent = "Order";

        button.onclick = function () {
            orderBundle(network, bundle.size, bundle.price);
        };

        card.append(heading, size, price, button);
        dataList.appendChild(card);
        });
}

function orderBundle(network, size, price) {
    document.getElementById("network").value = network;
    document.getElementById("bundle").value = size;
    document.getElementById("price").value = price.toFixed(2);

    const orderSection = document.getElementById("order-section");
    orderSection.hidden = false;

    orderSection.scrollIntoView({
        behavior: "smooth"
    });
}

function registerAgent() {
    alert("Agent registration will be added soon.");
}

        document.getElementById("order-form").addEventListener("submit", function(event) {document.getElementById("order-form").addEventListener("submit", function(event) {
    event.preventDefault();

    const phone = document.getElementById("phone").value.trim();
    const network = document.getElementById("network").value;
    const bundle = document.getElementById("bundle").value;
    const price = Number(document.getElementById("price").value);

    const message = document.getElementById("order-message");

    if (!phone || !Number.isFinite(price) || price <= 0) {
        message.textContent = "Please enter a valid phone number and check the price.";
        return;
    }

    message.textContent = "Opening Paystack test checkout...";

    if (typeof Paystack === "undefined") {
        message.textContent = "Paystack did not load. Please refresh and try again.";
        return;
    }

    const popup = new PaystackPop();

    popup.newTransaction({
        key: "pk_live_bab741f32bfcf25cd6f15793440cb20d6d959f98",
        email: "ezekielmensahannan42@gmail.com",
        amount: Math.round(price * 100),
        currency: "GHS",
        metadata: {
            custom_fields: [
                { display_name: "Recipient Phone", variable_name: "recipient_phone", value: phone },
                { display_name: "Network", variable_name: "network", value: network },
                { display_name: "Bundle", variable_name: "bundle", value: bundle }
            ]
        },
        onSuccess: function(transaction) {
            message.textContent = "Test payment completed. Reference: " + transaction.reference + ". Data has NOT been delivered.";
        },
        onCancel: function() {
            message.textContent = "Payment cancelled.";
        }
    });
});
    

showNetwork("MTN");
