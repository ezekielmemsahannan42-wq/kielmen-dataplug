"use strict";

/**
 * KIELMEN 636 DATAPLUG
 * AGENT MARGIN & EARNINGS ENGINE
 *
 * Calculates:
 * - Total agent profit
 * - Confirmed agent profit
 * - Pending-delivery profit
 * - Today's delivered profit
 * - Eligible earnings from previous days
 * - Available balance after withdrawal reservations
 *
 * Agent profit:
 * Agent selling price - Agent base price
 *
 * All monetary calculations are performed using PostgreSQL NUMERIC.
 * This module calculates balances from order records rather than
 * repeatedly crediting orders at midnight.
 */

const GHANA_TIME_ZONE = "Africa/Accra";

const DELIVERED_STATUSES = [
  "delivered",
  "completed",
  "success",
  "successful"
];

const FAILED_STATUSES = [
  "failed",
  "rejected",
  "cancelled",
  "canceled"
];

const PAID_STATUSES = ["paid"];

/**
 * Calculate the authenticated agent's earnings.
 *
 * Expected orders columns:
 * agent_id, status, delivery_status, amount,
 * agent_base_price, delivered_at, created_at
 *
 * Expected withdrawals columns:
 * agent_id, amount, status
 *
 * Verify these column names against your existing database
 * before connecting this module to server.js.
 */
async function calculateAgentMargin(pool, agentId) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("A valid PostgreSQL connection pool is required.");
  }

  if (
    agentId === null ||
    agentId === undefined ||
    String(agentId).trim() === ""
  ) {
    throw new Error("Agent ID is required.");
  }

  const sql = `
    WITH ghana_day AS (
      SELECT
        date_trunc(
          'day',
          NOW() AT TIME ZONE 'Africa/Accra'
        ) AT TIME ZONE 'Africa/Accra' AS day_start,

        (
          date_trunc(
            'day',
            NOW() AT TIME ZONE 'Africa/Accra'
          ) + INTERVAL '1 day'
        ) AT TIME ZONE 'Africa/Accra' AS next_day_start
    ),

    agent_orders AS (
      SELECT
        o.agent_id,
        o.reference,
        LOWER(TRIM(COALESCE(o.status, ''))) AS payment_status,
        LOWER(TRIM(COALESCE(o.delivery_status, ''))) AS delivery_status,
        o.amount::numeric AS selling_price,
        o.agent_base_price::numeric AS base_price,
        o.delivered_at,
        o.created_at,

        CASE
          WHEN o.agent_base_price IS NOT NULL
          THEN GREATEST(
            o.amount::numeric - o.agent_base_price::numeric,
            0
          )
          ELSE NULL
        END AS agent_margin

      FROM orders o
      WHERE o.agent_id = $1
    ),

    profit_summary AS (
      SELECT
        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
        )::int AS paid_orders,

        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
            AND base_price IS NULL
        )::int AS missing_base_price_orders,

        COALESCE(
          SUM(agent_margin) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
          ),
          0
        ) AS total_profit,

        COALESCE(
          SUM(selling_price) FILTER (
            WHERE payment_status = 'paid'
          ),
          0
        ) AS total_sales,

        COALESCE(
          SUM(agent_margin) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
              AND delivery_status = ANY($2::text[])
          ),
          0
        ) AS confirmed_profit,

        COALESCE(
          SUM(agent_margin) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
              AND delivery_status <> ALL($3::text[])
              AND delivery_status <> ALL($4::text[])
          ),
          0
        ) AS pending_delivery_profit,

        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
            AND base_price IS NOT NULL
            AND delivery_status <> ALL($3::text[])
            AND delivery_status <> ALL($4::text[])
        )::int AS pending_delivery_orders

      FROM agent_orders
    ),

    delivery_summary AS (
      SELECT
        COALESCE(
          SUM(a.agent_margin) FILTER (
            WHERE a.payment_status = 'paid'
              AND a.base_price IS NOT NULL
              AND a.delivery_status = ANY($2::text[])
              AND a.delivered_at IS NOT NULL
              AND a.delivered_at < g.day_start
          ),
          0
        ) AS previous_eligible_profit,

        COALESCE(
          SUM(a.agent_margin) FILTER (
            WHERE a.payment_status = 'paid'
              AND a.base_price IS NOT NULL
              AND a.delivery_status = ANY($2::text[])
              AND a.delivered_at >= g.day_start
              AND a.delivered_at < g.next_day_start
          ),
          0
        ) AS today_profit,

        COUNT(*) FILTER (
          WHERE a.payment_status = 'paid'
            AND a.base_price IS NOT NULL
            AND a.delivery_status = ANY($2::text[])
            AND a.delivered_at IS NOT NULL
            AND a.delivered_at < g.day_start
        )::int AS previous_eligible_orders,

        COUNT(*) FILTER (
          WHERE a.payment_status = 'paid'
            AND a.base_price IS NOT NULL
            AND a.delivery_status = ANY($2::text[])
            AND a.delivered_at >= g.day_start
            AND a.delivered_at < g.next_day_start
        )::int AS todays_delivered_orders

      FROM agent_orders a
      CROSS JOIN ghana_day g
    ),

    withdrawal_summary AS (
      SELECT
        COALESCE(
          SUM(w.amount::numeric) FILTER (
            WHERE LOWER(TRIM(COALESCE(w.status, '')))
              IN ('pending', 'approved', 'paid', 'sent')
          ),
          0
        ) AS reserved_amount,

        COALESCE(
          SUM(w.amount::numeric) FILTER (
            WHERE LOWER(TRIM(COALESCE(w.status, '')))
              IN ('pending', 'approved')
          ),
          0
        ) AS pending_amount

      FROM agent_withdrawals w
      WHERE w.agent_id = $1
    )

    SELECT
      p.paid_orders,
      p.missing_base_price_orders,
      p.total_profit,
      p.total_sales,
      p.confirmed_profit,
      p.pending_delivery_profit,
      p.pending_delivery_orders,

      d.previous_eligible_profit,
      d.today_profit,
      d.previous_eligible_orders,
      d.todays_delivered_orders,

      w.reserved_amount,
      w.pending_amount,

      GREATEST(
        d.previous_eligible_profit - w.reserved_amount,
        0
      ) AS available_balance

    FROM profit_summary p
    CROSS JOIN delivery_summary d
    CROSS JOIN withdrawal_summary w;
  `;

  try {
    const result = await pool.query(sql, [
      agentId,
      DELIVERED_STATUSES,
      FAILED_STATUSES,
      DELIVERED_STATUSES
    ]);

    if (!result.rows || result.rows.length !== 1) {
      throw new Error("Could not calculate the agent's margin.");
    }

    const row = result.rows[0];

    const amount = value => {
      const number = Number(value ?? 0);
      return Number.isFinite(number) ? number : 0;
    };

    return {
      success: true,
      agentId: String(agentId),
      currency: "GHS",
      timeZone: GHANA_TIME_ZONE,
      calculatedAt: new Date().toISOString(),

      totalProfit: amount(row.total_profit),
      totalSales: amount(row.total_sales),

      confirmedProfit: amount(row.confirmed_profit),
      pendingDeliveryProfit: amount(row.pending_delivery_profit),
      pendingDeliveryOrders: Number(
        row.pending_delivery_orders || 0
      ),

      missingBasePriceOrders: Number(
        row.missing_base_price_orders || 0
      ),

      nextPayout: amount(row.today_profit),
      todaysProfit: amount(row.today_profit),

      eligiblePreviousEarnings: amount(
        row.previous_eligible_profit
      ),

      availableBalance: amount(row.available_balance),
      pendingWithdrawals: amount(row.pending_amount),
      reservedWithdrawals: amount(row.reserved_amount),

      paidOrders: Number(row.paid_orders || 0),
      previousEligibleOrders: Number(
        row.previous_eligible_orders || 0
      ),
      todaysDeliveredOrders: Number(
        row.todays_delivered_orders || 0
      )
    };
  } catch (error) {
    console.error(
      "Kielmen agent-margin calculation failed:",
      error.message
    );

    throw error;
  }
}

module.exports = {
  calculateAgentMargin
};
