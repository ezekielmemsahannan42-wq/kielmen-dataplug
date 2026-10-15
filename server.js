const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();

app.use(cors({
    origin: "https://ezekielmemsahannan42-wq.github.io"
}));

app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

/*
 IMPORTANT:
 Prices must match the prices displayed on your website.
 The server, not the customer's browser, determines the price.
*/

const PRICES = {
    MTN: {
        "1GB": 4.50,
        "2GB": 9.00,
        "3GB": 13.00,
        "4GB": 17.50,
        "5GB": 21.00,
        "6GB": 25.00,
        "8GB": 34.00,
        "10GB": 42.00,
        "15GB": 59.00,
        "20GB": 79.00,
        "25GB": 98.00,
        "30GB": 119.00,
        "40GB": 157.00,
        "50GB": 197.00
    },

    AirtelTigo: {
        "1GB": 5.00,
        "2GB": 9.20,
        "5GB": 22.00,
        "10GB": 41.00,
        "20GB": 78.00,
        "30GB": 115.00,
        "50GB": 188.00
    },

    Telecel: {
        "10GB": 42.00,
        "15GB": 57.00,
        "20GB": 72.00,
        "25GB": 93.00,
        "30GB": 111.00,
        "40GB": 145.00,
        "50GB": 179.00,
        "100GB": 402.00
    }
};

const NETWORK_MAP = {
    MTN: "YELLO",
    AIRTELTIGO: "AT_PREMIUM",
    TELECEL: "TELECEL"
};

async function createOrdersTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            reference VARCHAR(100) UNIQUE NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(20) NOT NULL,
            network VARCHAR(50) NOT NULL,
            bundle VARCHAR(50) NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            delivery_status VARCHAR(30) NOT NULL DEFAULT 'not_started',
            supplier_reference VARCHAR(150),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS delivery_status
        VARCHAR(30) NOT NULL DEFAULT 'not_started'
    `);

    await pool.query(`
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(150)
    `);

    console.log("Orders table is ready.");
}

/*
 INITIALIZE PAYMENT
*/

app.post("/initialize-payment", async (req, res) => {
    try {
        const {
            email,
            phone,
            network,
            bundle
        } = req.body;

        if (
            typeof email !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).json({
                message: "Enter a valid email address."
            });
        }

        const cleanPhone = String(phone || "").replace(/\s+/g, "");

        if (!/^0\d{9}$/.test(cleanPhone)) {
            return res.status(400).json({
                message: "Enter a valid 10-digit Ghana phone number."
            });
        }

        const networkKey = String(network || "")
            .replace(/[\s_-]/g, "")
            .toUpperCase();

        const networkNames = {
            MTN: "MTN",
            AIRTELTIGO: "AirtelTigo",
            TELECEL: "Telecel"
        };

        const selectedNetwork = networkNames[networkKey];

        if (!selectedNetwork) {
            return res.status(400).json({
                message: "Select a valid network."
            });
        }

        const selectedBundle = String(bundle || "")
            .replace(/\s+/g, "")
            .toUpperCase();

        const price =
            PRICES[selectedNetwork][selectedBundle];

        if (typeof price !== "number") {
            return res.status(400).json({
                message: "This bundle is not available."
            });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (
            !secretKey ||
            !secretKey.startsWith("sk_live_")
        ) {
            return res.status(503).json({
                message: "Live payment service is not configured."
            });
        }

        const reference =
            "KIELMEN_" +
            Date.now() +
            "_" +
            crypto.randomBytes(6).toString("hex");

        const callbackUrl =
            "https://ezekielmemsahannan42-wq.github.io/kielmen-dataplug/success.html";

        const paystackResponse = await fetch(
            "https://api.paystack.co/transaction/initialize",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    amount: Math.round(price * 100),
                    currency: "GHS",
                    reference,
                    callback_url: callbackUrl,
                    metadata: {
                        phone: cleanPhone,
                        network: selectedNetwork,
                        bundle: selectedBundle
                    }
                })
            }
        );

        const paystackResult = await paystackResponse.json();

        if (
            !paystackResponse.ok ||
            !paystackResult.status ||
            !paystackResult.data?.authorization_url
        ) {
            console.error(
                "Paystack initialization failed:",
                paystackResult.message
            );

            return res.status(502).json({
                message: "Unable to start payment. Please try again."
            });
        }

        await pool.query(
            `INSERT INTO orders
             (reference, email, phone, network, bundle, amount)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                reference,
                email.trim().toLowerCase(),
                cleanPhone,
                selectedNetwork,
                selectedBundle,
                price
            ]
        );

        return res.json({
            success: true,
            authorization_url:
                paystackResult.data.authorization_url,
            reference
        });

    } catch (error) {
        console.error("Initialize payment error:", error);

        return res.status(500).json({
            message: "Unable to start payment. Please try again."
        });
    }
});

/*
 DATAMART AUTOMATIC DELIVERY

 This function is called only after Paystack confirms payment.
*/

async function deliverData(order) {
    if (process.env.DATAMART_PURCHASES_ENABLED !== "true") {
        console.log("DataMart purchases are disabled.");
        return;
    }

    const apiKey = process.env.DATAMART_API_KEY;

    if (!apiKey) {
        throw new Error("DataMart API key is missing.");
    }

    const claim = await pool.query(
        `UPDATE orders
         SET delivery_status = 'processing'
         WHERE reference = $1
           AND status = 'paid'
           AND delivery_status = 'not_started'
         RETURNING *`,
        [order.reference]
    );

    if (claim.rows.length === 0) {
        console.log("Order already claimed for delivery.");
        return;
    }

    const savedOrder = claim.rows[0];

    try {
        const networkKey = String(savedOrder.network)
            .replace(/[\s_-]/g, "")
            .toUpperCase();

        const supplierNetwork = NETWORK_MAP[networkKey];

        const capacity = Number(
            String(savedOrder.bundle).replace(/[^0-9.]/g, "")
        );

        if (
            !supplierNetwork ||
            !Number.isFinite(capacity) ||
            capacity <= 0
        ) {
            throw new Error("Invalid network or bundle.");
        }

        const response = await fetch(
            "https://api.datamartgh.shop/api/purchase",
            {
                method: "POST",
                headers: {
                    "X-API-Key": apiKey,
                    "X-Idempotency-Key": savedOrder.reference,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    phoneNumber: savedOrder.phone,
                    network: supplierNetwork,
                    capacity: String(capacity),
                    gateway: "wallet"
                })
            }
        );

        const result = await response.json();

        if (
            !response.ok ||
            result.status !== "success" ||
            !result.data
        ) {
            throw new Error(
                result.message || "DataMart purchase failed."
            );
        }

        const supplierStatus =
            String(result.data.orderStatus || "").toLowerCase();

        const deliveryStatus =
            supplierStatus === "completed"
                ? "delivered"
                : "processing";

        await pool.query(
            `UPDATE orders
             SET delivery_status = $1,
                 supplier_reference = $2
             WHERE reference = $3`,
            [
                deliveryStatus,
                result.data.purchaseId ||
                    result.data.orderReference ||
                    result.data.transactionReference ||
                    null,
                savedOrder.reference
            ]
        );

        console.log(
            "DataMart response recorded:",
            savedOrder.reference,
            deliveryStatus
        );

    } catch (error) {
        /*
         Do not automatically retry a failed network request:
         DataMart might have processed the purchase even if
         our server did not receive the response.
        */

        console.error(
            "DataMart delivery needs review:",
            savedOrder.reference,
            error.message
        );

        await pool.query(
            `UPDATE orders
             SET delivery_status = 'review_required'
             WHERE reference = $1`,
            [savedOrder.reference]
        );

        throw error;
    }
}

/*
 VERIFY PAYMENT

 Never trust a redirect alone. Verify directly with Paystack.
*/

app.post("/verify-payment", async (req, res) => {
    try {
        const { reference } = req.body;

        if (
            typeof reference !== "string" ||
            reference.length < 5 ||
            reference.length > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid payment reference is required."
            });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (
            !secretKey ||
            !secretKey.startsWith("sk_live_")
        ) {
            return res.status(503).json({
                success: false,
                message: "Live payment verification is not configured."
            });
        }

        const orderResult = await pool.query(
            "SELECT * FROM orders WHERE reference = $1",
            [reference]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        const order = orderResult.rows[0];

        const paymentResponse = await fetch(
            "https://api.paystack.co/transaction/verify/" +
                encodeURIComponent(reference),
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`
                }
            }
        );

        const paymentResult = await paymentResponse.json();

        if (
            !paymentResponse.ok ||
            paymentResult.status !== true ||
            !paymentResult.data
        ) {
            return res.status(502).json({
                success: false,
                message: "Unable to verify payment. Please try again."
            });
        }

        const payment = paymentResult.data;

        const expectedAmount = Math.round(
            Number(order.amount) * 100
        );

        if (
            payment.status !== "success" ||
            payment.reference !== order.reference ||
            payment.currency !== "GHS" ||
            payment.amount !== expectedAmount ||
            String(payment.customer?.email || "").toLowerCase() !==
                order.email.toLowerCase()
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment has not been confirmed."
            });
        }

        /*
         Mark paid only once.
        */

        const paidResult = await pool.query(
            `UPDATE orders
             SET status = 'paid'
             WHERE reference = $1
               AND status = 'pending'
             RETURNING *`,
            [reference]
        );

        if (paidResult.rows.length === 0) {
            const latest = await pool.query(
                `SELECT status, delivery_status
                 FROM orders WHERE reference = $1`,
                [reference]
            );

            const saved = latest.rows[0];

            if (saved?.status === "paid") {
                return res.json({
                    success: true,
                    message: "Payment is verified.",
                    delivery_status: saved.delivery_status
                });
            }

            return res.status(409).json({
                success: false,
                message: "Order status needs review."
            });
        }

        const paidOrder = paidResult.rows[0];

        let message = "Payment verified. Delivery is being processed.";

        try {
            await deliverData(paidOrder);

            const delivery = await pool.query(
                `SELECT delivery_status
                 FROM orders WHERE reference = $1`,
                [reference]
            );

            const status = delivery.rows[0]?.delivery_status;

            if (status === "delivered") {
                message = "Payment verified and data delivered successfully.";
            } else if (status === "review_required") {
                message = "Payment verified. Please contact support to confirm delivery.";
            } else {
                message = "Payment verified. Data delivery is still processing.";
            }

        } catch (deliveryError) {
            console.error(
                "Delivery requires attention:",
                deliveryError.message
            );

            message =
                "Payment verified, but delivery needs attention. Please contact support.";
        }

        return res.json({
            success: true,
            message
        });

    } catch (error) {
        console.error("Payment verification error:", error);

        return res.status(500).json({
            success: false,
            message: "An error occurred while verifying payment."
        });
    }
});

/*
 HEALTH CHECK
*/

app.get("/", (req, res) => {
    res.json({
        service: "Kielmen 636 Dataplug",
        status: "online"
    });
});

/*
 START SERVER
*/

const PORT = process.env.PORT || 3000;

createOrdersTable()
    .then(() => {
        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `Kielmen 636 Dataplug server running on port ${PORT}`
            );
        });
    })
    .catch((error) => {
        console.error("Database startup failed:", error);
        process.exit(1);
    });
