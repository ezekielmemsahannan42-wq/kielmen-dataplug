/**
 * KIELMEN636 SMS SYSTEM
 *
 * SMS gateway: Sailup
 *
 * Features in this module:
 * 1. Automatic customer order confirmation queue.
 * 2. Owner SMS overview.
 * 3. SMS contact management.
 * 4. Promotional SMS campaign queue.
 *
 * Sailup API communication is supplied by server.js.
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
            'promotional',
            'agent_announcement',
            'withdrawal_confirmation'
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
   AUTOMATIC CUSTOMER ORDER CONFIRMATION
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
   AGENT ANNOUNCEMENT SMS
========================================= */

async function enqueueAgentAnnouncement(pool, message) {
  const text = String(message || "").trim();

  if (!text || text.length > 1000) {
    throw new Error("Announcement must contain 1–1000 characters.");
  }

  const result = await pool.query(
    `
      INSERT INTO sms_messages (
        idempotency_key,
        phone,
        sender_id,
        message,
        message_type
      )
      SELECT
        'agent-announcement:' ||
        gen_random_uuid()::text ||
        ':' ||
        a.id::text,
        a.phone,
        'KIELMEN636',
        $1,
        'agent_announcement'
      FROM agents a
      WHERE a.phone IS NOT NULL
        AND TRIM(a.phone) <> ''
      RETURNING id
    `,
    [text]
  );

  return result.rowCount;
}


/* =========================================
   WITHDRAWAL CONFIRMATION SMS
========================================= */

async function enqueueWithdrawalPaid(pool, withdrawal) {
  const withdrawalId = Number(withdrawal?.id);

  if (!Number.isSafeInteger(withdrawalId) || withdrawalId < 1) {
    throw new Error("Invalid withdrawal ID.");
  }

  const result = await pool.query(
    `
      INSERT INTO sms_messages (
        idempotency_key,
        phone,
        sender_id,
        message,
        message_type
      )
      SELECT
        'withdrawal-paid:' || w.id::text,
        w.phone,
        'KIELMEN636',
        'Your withdrawal of GH₵' ||
          TO_CHAR(w.amount, 'FM999999990.00') ||
          ' has been successfully paid. Thank you for using KIELMEN636.',
        'withdrawal_confirmation'
      FROM agent_withdrawals w
      WHERE w.id = $1
        AND w.status = 'paid'
        AND w.phone IS NOT NULL
        AND TRIM(w.phone) <> ''
      ON CONFLICT (idempotency_key)
      DO NOTHING
      RETURNING id
    `,
    [withdrawalId]
  );

  return result.rowCount;
}

/* =========================================
   SAILUP SMS QUEUE WORKER
========================================= */

let smsWorkerTimer = null;

let smsWorkerRunning = false;


/* PROCESS ONE QUEUED SMS THROUGH SAILUP */

async function processSmsQueue(
  pool,
  sendSailupSms
) {

  if (typeof sendSailupSms !== "function") {

    throw new Error(
      "The Sailup sender callback from server.js is missing."
    );

  }


  if (smsWorkerRunning) {
    return;
  }


  smsWorkerRunning = true;

  let sms = null;


  try {

    const claimed = await pool.query(`
      WITH next_sms AS (

        SELECT id

        FROM sms_messages

        WHERE status = 'queued'

        ORDER BY created_at ASC

        LIMIT 1

        FOR UPDATE SKIP LOCKED

      )

      UPDATE sms_messages AS sms

      SET status = 'sending',
          error_message = NULL

      FROM next_sms

      WHERE sms.id = next_sms.id

      RETURNING
        sms.id,
        sms.phone,
        sms.message,
        sms.sender_id,
        sms.message_type

    `);


    if (!claimed.rowCount) {
      return;
    }


    sms = claimed.rows[0];


    /*
      Send using the Sailup callback
      supplied by server.js.
    */

    const result = await sendSailupSms({

      phone: sms.phone,

      message: sms.message,

      senderId: sms.sender_id,

      messageId: sms.id

    });


    const providerReference =
      result?.id ||
      result?.reference ||
      result?.campaign_id ||
      result?.campaign?.id ||
      null;


    /*
      Sailup accepted the SMS request.
      This does not independently prove
      delivery to the recipient.
    */

    await pool.query(`
      UPDATE sms_messages

      SET status = 'sent',

          provider_reference = $1,

          sent_at = NOW(),

          error_message = NULL

      WHERE id = $2

        AND status = 'sending'

    `, [

      providerReference
        ? String(providerReference).slice(0, 180)
        : null,

      sms.id

    ]);


    console.log(
      "Sailup accepted queued SMS:",
      sms.id,
      sms.phone
    );


  } catch (error) {

    console.error(
      "Sailup SMS worker error:",
      error.message
    );


    if (sms) {

      await pool.query(`
        UPDATE sms_messages

        SET status = 'failed',

            error_message = $1

        WHERE id = $2

          AND status = 'sending'

      `, [

        String(error.message).slice(0, 2000),

        sms.id

      ]).catch(updateError => {

        console.error(
          "Could not record SMS failure:",
          updateError.message
        );

      });

    }

  } finally {

    smsWorkerRunning = false;

  }

}


/* =========================================
   START AUTOMATIC SMS PROCESSING
========================================= */

function startSmsWorker(
  pool,
  sendSailupSms
) {

  if (smsWorkerTimer) {
    return;
  }


  if (typeof sendSailupSms !== "function") {

    console.error(
      "Sailup SMS worker not started: sender callback is missing."
    );

    return;

  }


  console.log(
    "KIELMEN636 Sailup SMS worker initialized."
  );


  smsWorkerTimer = setInterval(() => {

    processSmsQueue(
      pool,
      sendSailupSms
    ).catch(error => {

      console.error(
        "SMS worker processing error:",
        error.message
      );

    });

  }, 5000);

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
   SEND ANNOUNCEMENT TO ALL AGENTS
========================================= */

router.post("/announcements", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();

    if (!message || message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Enter an announcement of 1–1000 characters."
      });
    }

    const recipientCount = await enqueueAgentAnnouncement(
      pool,
      message
    );

    if (!recipientCount) {
      return res.status(404).json({
        success: false,
        message: "No approved agents were found."
      });
    }

    return res.status(202).json({
      success: true,
      message: "Agent announcement added to the SMS queue.",
      recipientCount
    });

  } catch (error) {
    console.error("Agent announcement SMS:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not queue agent announcement."
    });
  }
});
  /* =====================================
     CREATE PROMOTIONAL CAMPAIGN

     Only recipients with recorded consent
     and without an opt-out are eligible.
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


      if (!consentConfirmed) {

        return res.status(400).json({

          success: false,

          message:
            "Confirm that the imported recipients agreed to receive promotional messages."

        });

      }


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


      const uniqueRecipients = [
        ...new Set(normalized)
      ];


      client = await pool.connect();

      await client.query("BEGIN");


      /*
        Save new imported contacts only when
        the owner confirms consent.

        Existing contacts are not overwritten.
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
          "Promotion saved to the SMS queue. Sailup will process the messages.",

        campaignId,

        recipientCount: inserted.rowCount,

        skippedCount,

        deliveryConfigured: true

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
  enqueueAgentAnnouncement,
  enqueueWithdrawalPaid,
  createSmsRouter,
  startSmsWorker
};
