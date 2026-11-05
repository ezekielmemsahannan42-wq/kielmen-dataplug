/**
 * KIELMEN636 SMS SYSTEM
 *
 * 1. Automatic customer order notifications.
 * 2. Owner-controlled promotional SMS campaigns.
 *
 * Actual SMS transmission requires an approved
 * SMS gateway or carrier connection.
 */

"use strict";

const express = require("express");


/* =========================================
   GHANAIAN PHONE NUMBER NORMALIZATION
========================================= */

function normalizeGhanaPhone(value) {
  let phone = String(value || "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (phone.startsWith("+233")) {
    phone = "0" + phone.slice(4);

  } else if (phone.startsWith("233")) {
    phone = "0" + phone.slice(3);
  }

  return /^0\d{9}$/.test(phone)
    ? phone
    : "";
}
/* =========================================
   MTN SMS V3 API CONNECTION
========================================= */

let mtnAccessToken = "";
let mtnTokenExpiresAt = 0;


/* GET MTN ACCESS TOKEN */

async function getMtnAccessToken() {

  const clientId =
    process.env.MTN_SMS_CLIENT_ID;

  const clientSecret =
    process.env.MTN_SMS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "MTN SMS credentials are missing."
    );
  }

  if (
    mtnAccessToken &&
    Date.now() < mtnTokenExpiresAt
  ) {
    return mtnAccessToken;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(
    "https://api.mtn.com/v1/oauth/access_token/accesstoken?grant_type=client_credentials",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body: body.toString()
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      "MTN authentication failed: " +
      JSON.stringify(data)
    );
  }

  mtnAccessToken = data.access_token;

  const expiresIn =
    Number(data.expires_in || 3600);

  mtnTokenExpiresAt =
    Date.now() +
    Math.max(expiresIn - 120, 60) * 1000;

  return mtnAccessToken;
}


/* SEND ONE SMS THROUGH MTN */

async function sendMtnSms({
  phone,
  message,
  clientCorrelatorId
}) {

  const serviceCode =
    process.env.MTN_SMS_SERVICE_CODE;

  const senderAddress =
    process.env.MTN_SMS_SENDER_ADDRESS;

  if (!serviceCode) {
    throw new Error(
      "MTN SMS service code is not configured."
    );
  }

  const normalizedPhone =
    normalizeGhanaPhone(phone);

  if (!normalizedPhone) {
    throw new Error(
      "Invalid Ghanaian phone number."
    );
  }

  const internationalPhone =
    "233" + normalizedPhone.slice(1);

  const token =
    await getMtnAccessToken();

  const payload = {
    message: String(message),

    serviceCode,

    receiverAddress: [
      internationalPhone
    ],

    clientCorrelatorId:
      String(clientCorrelatorId).slice(0, 36)
  };

  if (senderAddress) {
    payload.senderAddress = senderAddress;
  }

  const response = await fetch(
    "https://api.mtn.com/v3/sms/messages/sms/outbound",
    {
      method: "POST",

      headers: {
        "Authorization":
          "Bearer " + token,

        "Content-Type":
          "application/json",

        "Accept":
          "application/json"
      },

      body: JSON.stringify(payload)
    }
  );

  const result = await response.json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      "MTN SMS request failed: " +
      JSON.stringify(result)
    );
  }

  return result;
       }


/* =========================================
   INITIALIZE SMS DATABASE TABLES
========================================= */

async function initSmsTables(pool) {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id BIGSERIAL PRIMARY KEY,

      idempotency_key VARCHAR(180) UNIQUE,

      campaign_id BIGINT,

      phone VARCHAR(20) NOT NULL,

      sender_id VARCHAR(11) NOT NULL
        DEFAULT 'KIELMEN636',

      message TEXT NOT NULL,

      message_type VARCHAR(30) NOT NULL
        CHECK (
          message_type IN (
            'order_notification',
            'promotional'
          )
        ),

      status VARCHAR(20) NOT NULL
        DEFAULT 'queued'
        CHECK (
          status IN (
            'queued',
            'sending',
            'sent',
            'failed'
          )
        ),

      provider_reference VARCHAR(180),

      error_message TEXT,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

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

      contact_name VARCHAR(120) NOT NULL
        DEFAULT '',

      promotional_consent BOOLEAN NOT NULL
        DEFAULT FALSE,

      consent_source VARCHAR(120) NOT NULL
        DEFAULT '',

      opted_out_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

      updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_campaigns (
      id BIGSERIAL PRIMARY KEY,

      name VARCHAR(120) NOT NULL,

      message TEXT NOT NULL,

      status VARCHAR(20) NOT NULL
        DEFAULT 'queued',

      recipient_count INTEGER NOT NULL
        DEFAULT 0,

      created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
    )
  `);


  await pool.query(`
    ALTER TABLE sms_messages
    ADD COLUMN IF NOT EXISTS campaign_id BIGINT
  `);

}


/* =========================================
   AUTOMATIC ORDER CONFIRMATION
========================================= */

async function enqueueOrderReceived(pool, order) {

  const phone = normalizeGhanaPhone(
    order && order.phone
  );

  const reference = String(
    order && order.reference || ""
  ).trim();


  if (!phone || !reference) {

    throw new Error(
      "A valid Ghanaian phone number and order reference are required."
    );

  }


  const message =
    "Your data order has been successfully received by KIELMEN636. Your data will be delivered shortly. Thank you for choosing us.";


  await pool.query(
    `
      INSERT INTO sms_messages
      (
        idempotency_key,
        phone,
        sender_id,
        message,
        message_type
      )

      VALUES (
        $1,
        $2,
        'KIELMEN636',
        $3,
        'order_notification'
      )

      ON CONFLICT (idempotency_key)
      DO NOTHING
    `,
    [
      `order-received:${reference}`,
      phone,
      message
    ]
  );

}


/* =========================================
   OWNER SMS ROUTER
========================================= */

function createSmsRouter({
  pool,
  requireOwner
}) {

  const router = express.Router();

  router.use(requireOwner);


  /* =====================================
     SMS OVERVIEW
  ===================================== */

  router.get("/overview", async (_req, res) => {

    try {

      const [counts, recent] =
        await Promise.all([

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


      return res.json({

        success: true,

        counts: counts.rows[0],

        messages: recent.rows

      });


    } catch (error) {

      console.error(
        "SMS overview:",
        error.message
      );

      return res.status(500).json({

        success: false,

        message: "Could not load SMS overview."

      });

    }

  });


  /* =====================================
     ADD OR UPDATE CONTACT
  ===================================== */

  router.post("/contacts", async (req, res) => {

    try {

      const phone = normalizeGhanaPhone(
        req.body?.phone
      );


      const name = String(
        req.body?.name || ""
      )
        .trim()
        .slice(0, 120);


      const consent =
        req.body?.promotionalConsent === true;


      const consentSource = String(
        req.body?.consentSource || ""
      )
        .trim()
        .slice(0, 120);


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
        `
          INSERT INTO sms_contacts
          (
            phone,
            contact_name,
            promotional_consent,
            consent_source,
            opted_out_at
          )

          VALUES ($1, $2, $3, $4, NULL)

          ON CONFLICT (phone)
          DO UPDATE SET

            contact_name = EXCLUDED.contact_name,

            promotional_consent =
              EXCLUDED.promotional_consent,

            consent_source =
              EXCLUDED.consent_source,

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
            created_at
        `,
        [
          phone,
          name,
          consent,
          consentSource
        ]
      );


      return res.status(201).json({

        success: true,

        contact: result.rows[0]

      });


    } catch (error) {

      console.error(
        "SMS contact save:",
        error.message
      );

      return res.status(500).json({

        success: false,

        message: "Could not save contact."

      });

    }

  });


  /* =====================================
     VIEW CONTACTS
  ===================================== */

  router.get("/contacts", async (req, res) => {

    try {

      const limit = Math.min(

        Math.max(
          Number(req.query.limit) || 100,
          1
        ),

        500

      );


      const result = await pool.query(
        `
          SELECT

            id,
            phone,
            contact_name,
            promotional_consent,
            consent_source,
            opted_out_at,
            created_at

          FROM sms_contacts

          ORDER BY created_at DESC

          LIMIT $1
        `,
        [limit]
      );


      return res.json({

        success: true,

        contacts: result.rows

      });


    } catch (error) {

      console.error(
        "SMS contacts:",
        error.message
      );

      return res.status(500).json({

        success: false,

        message: "Could not load contacts."

      });

    }

  });


  /* =====================================
     CREATE PROMOTIONAL CAMPAIGN
     
     Sends only to numbers imported
     or pasted by the owner.

     Requires owner confirmation that
     recipients agreed to promotions.
  ===================================== */

  router.post("/campaigns", async (req, res) => {

    let client;

    try {

      const name = String(
        req.body?.name || ""
      )
        .trim()
        .slice(0, 120);


      const message = String(
        req.body?.message || ""
      ).trim();


      const recipients = Array.isArray(
        req.body?.recipients
      )
        ? req.body.recipients
        : [];


      const consentConfirmed =
        req.body?.consentConfirmed === true;


      /* VALIDATE MESSAGE */

      if (
        !name ||
        !message ||
        message.length > 1000
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Enter a campaign name and a message of 1–1000 characters."

        });

      }


      /* VALIDATE CONSENT */

      if (!consentConfirmed) {

        return res.status(400).json({

          success: false,

          message:
            "Confirm that the imported recipients agreed to receive promotional messages."

        });

      }


      /* VALIDATE RECIPIENT COUNT */

      if (
        !recipients.length ||
        recipients.length > 5000
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Import between 1 and 5,000 phone numbers per campaign."

        });

      }


      /* NORMALIZE NUMBERS */

      const normalized = recipients.map(
        normalizeGhanaPhone
      );


      if (
        normalized.some(phone => !phone)
      ) {

        return res.status(400).json({

          success: false,

          message:
            "The imported list contains invalid Ghanaian phone numbers."

        });

      }


      /* REMOVE DUPLICATES */

      const uniqueRecipients = [
        ...new Set(normalized)
      ];


      client = await pool.connect();

      await client.query("BEGIN");


      /*
        Save new imported contacts only when
        the owner has confirmed consent.

        Existing contacts are NOT overwritten.

        Previously opted-out contacts remain
        opted out.
      */

      await client.query(
        `
          INSERT INTO sms_contacts
          (
            phone,
            promotional_consent,
            consent_source
          )

          SELECT

            imported.phone,
            TRUE,
            'Owner-confirmed imported promotional list'

          FROM UNNEST($1::text[])
          AS imported(phone)

          ON CONFLICT (phone)
          DO NOTHING
        `,
        [uniqueRecipients]
      );


      /*
        Select only imported numbers that
        are eligible for promotional messages.

        Numbers previously opted out are excluded.
      */

      const eligible = await client.query(
        `
          SELECT phone

          FROM sms_contacts

          WHERE phone = ANY($1::text[])

            AND promotional_consent = TRUE

            AND opted_out_at IS NULL
        `,
        [uniqueRecipients]
      );


      const eligibleRecipients =
        eligible.rows.map(
          row => row.phone
        );


      const skippedCount =
        uniqueRecipients.length -
        eligibleRecipients.length;


      if (!eligibleRecipients.length) {

        await client.query("ROLLBACK");

        return res.status(400).json({

          success: false,

          message:
            "None of the imported numbers are eligible for this campaign. Check consent and opt-out records.",

          recipientCount: 0,

          skippedCount

        });

      }


      /* CREATE CAMPAIGN */

      const campaign = await client.query(
        `
          INSERT INTO sms_campaigns
          (
            name,
            message,
            status
          )

          VALUES ($1, $2, 'queued')

          RETURNING id
        `,
        [
          name,
          message
        ]
      );


      const campaignId =
        campaign.rows[0].id;


      /* QUEUE ONLY SELECTED RECIPIENTS */

      const inserted = await client.query(
        `
          INSERT INTO sms_messages
          (
            idempotency_key,
            campaign_id,
            phone,
            sender_id,
            message,
            message_type
          )

          SELECT

            'campaign:' ||
            $1::text ||
            ':' ||
            imported.phone,

            $1,

            imported.phone,

            'KIELMEN636',

            $2,

            'promotional'

          FROM UNNEST($3::text[])
          AS imported(phone)

          ON CONFLICT (idempotency_key)
          DO NOTHING

          RETURNING id
        `,
        [
          campaignId,
          message,
          eligibleRecipients
        ]
      );


      /* UPDATE CAMPAIGN COUNT */

      await client.query(
        `
          UPDATE sms_campaigns

          SET recipient_count = $1

          WHERE id = $2
        `,
        [
          inserted.rowCount,
          campaignId
        ]
      );


      await client.query("COMMIT");


      return res.status(202).json({

        success: true,

        message:
          "Promotion saved to the SMS queue. No messages have been transmitted yet.",

        campaignId,

        recipientCount: inserted.rowCount,

        skippedCount,

        deliveryConfigured: false

      });


    } catch (error) {

      if (client) {

        await client.query("ROLLBACK")
          .catch(() => {});

      }


      console.error(
        "SMS campaign queue:",
        error.message
      );


      return res.status(500).json({

        success: false,

        message: "Could not queue campaign."

      });


    } finally {

      if (client) {
        client.release();
      }

    }

  });


  /* =====================================
     VIEW CAMPAIGNS
  ===================================== */

  router.get("/campaigns", async (_req, res) => {

    try {

      const result = await pool.query(
        `
          SELECT

            id,
            name,
            status,
            recipient_count,
            created_at

          FROM sms_campaigns

          ORDER BY created_at DESC

          LIMIT 100
        `
      );


      return res.json({

        success: true,

        campaigns: result.rows

      });


    } catch (error) {

      console.error(
        "SMS campaigns:",
        error.message
      );


      return res.status(500).json({

        success: false,

        message: "Could not load campaigns."

      });

    }

  });


  return router;

}


/* =========================================
   EXPORT SMS FUNCTIONS
========================================= */

module.exports = {

  initSmsTables,

  enqueueOrderReceived,

  createSmsRouter

};
