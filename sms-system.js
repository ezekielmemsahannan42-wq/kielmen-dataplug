/**
 * KIELMEN636 SMS SYSTEM
 *
 * Manages customer order notifications and promotional SMS queues.
 * Actual SMS transmission requires an approved carrier connection
 * or SMS gateway.
 */

"use strict";

const express = require("express");

function normalizeGhanaPhone(value) {
  let phone = String(value || "").trim().replace(/[^\d+]/g, "");

  if (phone.startsWith("+233")) {
    phone = "0" + phone.slice(4);
  } else if (phone.startsWith("233")) {
    phone = "0" + phone.slice(3);
  }

  return /^0\d{9}$/.test(phone) ? phone : "";
}

async function initSmsTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id BIGSERIAL PRIMARY KEY,
      idempotency_key VARCHAR(180) UNIQUE,
      campaign_id BIGINT,
      phone VARCHAR(20) NOT NULL,
      sender_id VARCHAR(11) NOT NULL DEFAULT 'KIELMEN636',
      message TEXT NOT NULL,
      message_type VARCHAR(30) NOT NULL
        CHECK (message_type IN ('order_notification', 'promotional')),
      status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
      provider_reference VARCHAR(180),
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS sms_messages_created_at_idx
    ON sms_messages(created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_contacts (
      id BIGSERIAL PRIMARY KEY,
      phone VARCHAR(20) UNIQUE NOT NULL,
      contact_name VARCHAR(120) NOT NULL DEFAULT '',
      promotional_consent BOOLEAN NOT NULL DEFAULT FALSE,
      consent_source VARCHAR(120) NOT NULL DEFAULT '',
      opted_out_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_campaigns (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE sms_messages
    ADD COLUMN IF NOT EXISTS campaign_id BIGINT
  `);
}

async function enqueueOrderReceived(pool, order) {
  const phone = normalizeGhanaPhone(order && order.phone);
  const reference = String(
    order && order.reference || ""
  ).trim();

  if (!phone || !reference) {
    throw new Error(
      "A valid Ghanaian phone number and order reference are required."
    );
  }

  const message =
    "Your data order has been successfully received. It will be delivered shortly. Thank you for choosing KIELMEN636.";

  await pool.query(
    `INSERT INTO sms_messages
      (idempotency_key, phone, sender_id, message, message_type)
     VALUES ($1, $2, 'KIELMEN636', $3, 'order_notification')
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      `order-received:${reference}`,
      phone,
      message
    ]
  );
}

function createSmsRouter({ pool, requireOwner }) {
  const router = express.Router();

  router.use(requireOwner);

  // SMS overview
  router.get("/overview", async (_req, res) => {
    try {
      const [counts, recent] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE status = 'queued'
            )::int AS queued,
            COUNT(*) FILTER (
              WHERE status = 'sent'
            )::int AS sent,
            COUNT(*) FILTER (
              WHERE status = 'failed'
            )::int AS failed
          FROM sms_messages
        `),

        pool.query(`
          SELECT
            id,
            phone,
            sender_id,
            message_type,
            status,
            created_at,
            sent_at,
            error_message
          FROM sms_messages
          ORDER BY created_at DESC
          LIMIT 100
        `)
      ]);

      res.json({
        success: true,
        counts: counts.rows[0],
        messages: recent.rows
      });

    } catch (error) {
      console.error("SMS overview:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load SMS overview."
      });
    }
  });

  // Add or update a contact
  router.post("/contacts", async (req, res) => {
    try {
      const phone = normalizeGhanaPhone(req.body?.phone);

      const name = String(
        req.body?.name || ""
      ).trim().slice(0, 120);

      const consent =
        req.body?.promotionalConsent === true;

      const consentSource = String(
        req.body?.consentSource || ""
      ).trim().slice(0, 120);

      if (!phone) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Ghanaian phone number."
        });
      }

      if (consent && !consentSource) {
        return res.status(400).json({
          success: false,
          message: "Record how the customer gave promotional consent."
        });
      }

      const result = await pool.query(
        `INSERT INTO sms_contacts
          (
            phone,
            contact_name,
            promotional_consent,
            consent_source,
            opted_out_at
          )
         VALUES ($1, $2, $3, $4, NULL)

         ON CONFLICT (phone) DO UPDATE SET
           contact_name = EXCLUDED.contact_name,
           promotional_consent = EXCLUDED.promotional_consent,
           consent_source = EXCLUDED.consent_source,
           opted_out_at = CASE
             WHEN EXCLUDED.promotional_consent
             THEN NULL
             ELSE sms_contacts.opted_out_at
           END,
           updated_at = NOW()

         RETURNING
           id,
           phone,
           contact_name,
           promotional_consent,
           created_at`,
        [
          phone,
          name,
          consent,
          consentSource
        ]
      );

      res.status(201).json({
        success: true,
        contact: result.rows[0]
      });

    } catch (error) {
      console.error("SMS contact save:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not save contact."
      });
    }
  });

  // View contacts
  router.get("/contacts", async (req, res) => {
    try {
      const limit = Math.min(
        Math.max(Number(req.query.limit) || 100, 1),
        500
      );

      const result = await pool.query(
        `SELECT
          id,
          phone,
          contact_name,
          promotional_consent,
          consent_source,
          opted_out_at,
          created_at
         FROM sms_contacts
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      res.json({
        success: true,
        contacts: result.rows
      });

    } catch (error) {
      console.error("SMS contacts:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load contacts."
      });
    }
  });

  // Create promotional campaign
  router.post("/campaigns", async (req, res) => {
    let client;

    try {
      const name = String(
        req.body?.name || ""
      ).trim().slice(0, 120);

      const message = String(
        req.body?.message || ""
      ).trim();

      if (
        !name ||
        !message ||
        message.length > 1000
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a campaign name and a message of 1–1000 characters."
        });
      }

      client = await pool.connect();

      await client.query("BEGIN");

      const campaign = await client.query(
        `INSERT INTO sms_campaigns
          (name, message, status)
         VALUES ($1, $2, 'queued')
         RETURNING id`,
        [name, message]
      );

      const campaignId = campaign.rows[0].id;

      const inserted = await client.query(
        `INSERT INTO sms_messages
          (
            campaign_id,
            phone,
            sender_id,
            message,
            message_type
          )
         SELECT
           $1,
           phone,
           'KIELMEN636',
           $2,
           'promotional'
         FROM sms_contacts
         WHERE promotional_consent = TRUE
           AND opted_out_at IS NULL
         RETURNING id`,
        [campaignId, message]
      );

      await client.query(
        `UPDATE sms_campaigns
         SET recipient_count = $1
         WHERE id = $2`,
        [
          inserted.rowCount,
          campaignId
        ]
      );

      await client.query("COMMIT");

      res.status(202).json({
        success: true,
        message: "Campaign saved to the SMS queue. No messages have been transmitted yet.",
        campaignId,
        recipientCount: inserted.rowCount,
        deliveryConfigured: false
      });

    } catch (error) {
      if (client) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("SMS campaign queue:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not queue campaign."
      });

    } finally {
      if (client) {
        client.release();
      }
    }
  });

  // View campaigns
  router.get("/campaigns", async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          id,
          name,
          status,
          recipient_count,
          created_at
         FROM sms_campaigns
         ORDER BY created_at DESC
         LIMIT 100`
      );

      res.json({
        success: true,
        campaigns: result.rows
      });

    } catch (error) {
      console.error("SMS campaigns:", error.message);

      res.status(500).json({
        success: false,
        message: "Could not load campaigns."
      });
    }
  });

  return router;
}

module.exports = {
  initSmsTables,
  enqueueOrderReceived,
  createSmsRouter
};
