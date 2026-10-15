const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});
// DataMart automatic data delivery
async function deliverData(order) {
    if (process.env.DATAMART_PURCHASES_ENABLED !== "true") {
        console.log("DataMart purchases are disabled.");
        return;
    }

    const apiKey = process.env.DATAMART_API_KEY;

    if (!apiKey) {
        throw new Error("DataMart API key is missing.");
    }

    // Prevent duplicate delivery attempts for the same order.
    const claim = await pool.query(
        `UPDATE orders
         SET delivery_status = 'processing'
         WHERE reference = $1
           AND status = 'paid'
           AND delivery_status IN ('not_started', 'failed')
         RETURNING *`,
        [order.reference]
    );

    if (claim.rows.length === 0) {
        console.log("Order already processing or delivered.");
        return;
    }

    const savedOrder = claim.rows[0];

    try {
        const networkMap = {
            MTN: "YELLO",
            AIRTELTIGO: "AT_PREMIUM",
            TELECEL: "TELECEL"
        };

        const networkKey = String(savedOrder.network)
            .replace(/[\s_-]/g, "")
            .toUpperCase();

        const network = networkMap[networkKey];

        // Convert values such as "5GB" into 5.
        const capacity = Number(
            String(savedOrder.bundle).replace(/[^0-9.]/g, "")
        );

        if (!network || !Number.isFinite(capacity) || capacity <= 0) {
            throw new Error("Unsupported network or bundle size.");
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
                    network: network,
                    capacity: String(capacity),
                    gateway: "wallet"
                })
            }
        );

        const result = await response.json();

        console.log("DataMart response status:", response.status);
        console.log("DataMart order status:", result.status);

        if (
            !response.ok ||
            result.status !== "success" ||
            !result.data
        ) {
            throw new Error(
                result.message || "DataMart purchase failed."
            );
        }

        await pool.query(
            `UPDATE orders
             SET delivery_status = $1
             WHERE reference = $2`,
            [
                result.data.orderStatus === "completed"
                    ? "delivered"
                    : "processing",
                savedOrder.reference
            ]
        );

        console.log(
            "DataMart delivery accepted for order:",
            savedOrder.reference
        );

    } catch (error) {
        await pool.query(
            `UPDATE orders
             SET delivery_status = 'failed'
             WHERE reference = $1`,
            [savedOrder.reference]
        );

        console.error(
            "DataMart delivery failed:",
            error.message
        );

        throw error;
    }
                }

const app = express();
 

app.use(cors({
    origin: "https://ezekielmemsahannan42-wq.github.io"
}));

app.use(express.json());

// Create the orders table when the server starts
async function createOrdersTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                reference VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                network VARCHAR(50) NOT NULL,
                bundle VARCHAR(50) NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("Orders table is ready.");
  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS
    delivery_status
    VARCHAR(30) NOT NULL DEFAULT
    'not_started'
`); 
    } catch (error) {
        console.error("Database table creation failed:", error.message);
    }
}

createOrdersTable();

// Check whether the server is running
app.get("/", (req, res) => {
    res.json({
        message: "Kielmen 636 Dataplug payment server is running."
    });
});

// Initialize a Paystack payment
app.post("/initialize-payment", async (req, res) => {
    try {
        const {
            email,
            amount,
            phone,
            network,
            bundle
        } = req.body;

        // Validate customer information
        if (
            !email ||
            !/^\S+@\S+\.\S+$/.test(email) ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            amount > 100000 ||
            !phone ||
            !network ||
            !bundle
        ) {
            return res.status(400).json({
                message: "Please provide valid order details."
            });
        }

        // Read the secret key from Render's private environment variables
        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey || !secretKey.startsWith("sk_")) {
            return res.status(500).json({
                message: "Payment service is not configured correctly."
            });
        }

        // Create a unique transaction reference
        const reference =
            "KIELMEN_" +
            Date.now() +
            "_" +
            Math.random().toString(36).slice(2, 10);

        // Send the transaction request to Paystack
        const response = await fetch(
            "https://api.paystack.co/transaction/initialize",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: email,
                    amount: Math.round(amount * 100),
                    currency: "GHS",
                    reference: reference,
                    callback_url:
             "https://ezekielmemsahannan42-wq.github.io/kielmen-dataplug/success.html",
                    metadata: {
                        phone: phone,
                        network: network,
                        bundle: bundle
                    }
                })
            }
        );

        const result = await response.json();

        // Return an error if Paystack rejects the request
        if (!response.ok || !result.status) {
            console.error("Paystack initialization failed:", result);

            return res.status(502).json({
                message: "Paystack could not initialize this payment."
            });
        }
                await pool.query(
            `INSERT INTO orders
            (reference, email, phone, network, bundle, amount, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                reference,
                email,
                phone,
                network,
                bundle,
                amount,
                "pending"
            ]
        );

        // Return the checkout address to the website
        return res.json({
            authorization_url: result.data.authorization_url,
            reference: result.data.reference
        });

    } catch (error) {
        console.error("Payment initialization error:", error.message);

        return res.status(500).json({
            message: "Unable to start payment. Please try again."
        });
    }
});
// Verify a Paystack payment
app.post("/verify-payment", async (req, res) => {
    try {
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({
                message: "Payment reference is required."
            });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey || !secretKey.startsWith("sk_")) {
            return res.status(500).json({
                message: "Payment service is not configured."
            });
        }

        // Find the saved order
        const orderResult = await pool.query(
            "SELECT * FROM orders WHERE reference = $1",
            [reference]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({
                message: "Order not found."
            });
        }

        const order = orderResult.rows[0];

        // Verify directly with Paystack
        const response = await fetch(
            "https://api.paystack.co/transaction/verify/" +
                encodeURIComponent(reference),
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`
                }
            }
        );

        const result = await response.json();

        if (!response.ok || !result.status || !result.data) {
            return res.status(502).json({
                message: "Unable to verify payment. Please try again."
            });
        }

        const payment = result.data;
        const expectedAmount = Math.round(
            Number(order.amount) * 100
        );

        if (
            payment.status !== "success" ||
            payment.reference !== reference ||
            payment.currency !== "GHS" ||
            payment.amount !== expectedAmount ||
            payment.customer.email.toLowerCase() !==
                order.email.toLowerCase()
        ) {
            return res.status(400).json({
                message: "Payment has not been confirmed."
            });
        }

       // Mark the order as paid only once
const paidResult = await pool.query(
    `UPDATE orders
     SET status = 'paid'
     WHERE reference = $1
       AND status = 'pending'
     RETURNING *`,
    [reference]
);

if (paidResult.rows.length === 0) {
    return res.json({
        success: true,
        message: "Payment was already verified."
    });
}

const paidOrder = paidResult.rows[0];

let deliveryMessage = "Payment verified. Data delivery is pending.";

try {
    await deliverData(paidOrder);

    const deliveryResult = await pool.query(
        `SELECT delivery_status FROM orders WHERE reference = $1`,
        [reference]
    );

    if (deliveryResult.rows[0]?.delivery_status === "delivered") {
        deliveryMessage = "Payment verified and data delivered successfully.";
    }
} catch (deliveryError) {
    console.error("Data delivery error:", deliveryError.message);
}

return res.json({
    success: true,
    message: deliveryMessage
}); 

    } catch (error) {
        console.error("Payment verification error:", error);

        return res.status(500).json({
            message: "An error occurred while verifying payment."
        });
    }
});
// Start the server using Render's assigned port
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Kielmen 636 Dataplug server running on port ${PORT}`
    );
});
