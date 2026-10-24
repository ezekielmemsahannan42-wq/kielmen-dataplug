"use strict";

/**
 * KIELMEN 636 DATAPLUG
 * NEXT PAYOUT AND AVAILABLE BALANCE ENGINE
 *
 * Responsibilities:
 * 1. Calculate agent profit from actual order records.
 * 2. Include pending-delivery profit in Total Profit.
 * 3. Track delivered earnings by Ghana calendar day.
 * 4. Calculate Next Payout from today's delivered earnings.
 * 5. Calculate Available Balance from earlier eligible earnings.
 * 6. Deduct withdrawal reservations.
 * 7. Prevent duplicate earnings by calculating from orders rather
 *    than repeatedly crediting the same orders at midnight.
 *
 * IMPORTANT:
 * - This module does not send Mobile Money payments.
 * - This module does not mark orders as delivered.
 * - Delivery must be confirmed by your existing delivery system.
 * - The orders table must store the correct agent selling amount
 *   and agent_base_price.
 */

const GHANA_TIME_ZONE = "Africa/Accra";

const SUCCESSFUL_DELIVERY_STATUSES = [
  "delivered",
  "completed",
  "success",
  "successful"
];

const FAILED_DELIVERY_STATUSES = [
  "failed",
  "rejected",
  "cancelled",
  "canceled"
];

const PAID_STATUSES = ["paid"];


/**
 * Convert database numeric values into safe monetary values.
 *
 * PostgreSQL NUMERIC values commonly arrive as strings.
 * Calculations are rounded to two decimal places.
 */
function toMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round((number + Number.EPSILON) * 100) / 100;
}


/**
 * Return a numeric database result as a money amount.
 */
function moneyFromRow(value) {
  return toMoney(value ?? 0);
}


/**
 * Return the current Ghana calendar date as YYYY-MM-DD.
 *
 * Uses Intl rather than the server's local timezone.
 */
function getGhanaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GHANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return (
    `${values.year}-${values.month}-${values.day}`
  );
}


/**
 * Return the start of the current Ghana calendar day as an ISO
 * timestamp. PostgreSQL performs the authoritative timezone
 * calculations in the SQL queries below.
 */
function getGhanaDateInfo() {
  return {
    timeZone: GHANA_TIME_ZONE,
    today: getGhanaDate(),
    generatedAt: new Date().toISOString()
  };
}


/**
 * Read the agent's earnings and balances.
 *
 * Expected existing schema:
 *
 * orders:
 *   agent_id
 *   status
 *   delivery_status
 *   amount
 *   agent_base_price
 *   delivered_at
 *
 * withdrawals:
 *   agent_id
 *   amount
 *   status
 *
 * The SQL uses the existing withdrawal table and common withdrawal
 * statuses from your current backend. Confirm the actual table and
 * column names in your server.js before connecting this module.
 *
 * No midnight job is required to move earnings between balances:
 * the current Ghana date determines which delivered orders are
 * eligible for withdrawal.
 */
async function calculateNextPayout(pool, agentId) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error(
      "A valid PostgreSQL connection pool is required."
    );
  }

  if (
    agentId === null ||
    agentId === undefined ||
    String(agentId).trim() === ""
  ) {
    throw new Error("Agent ID is required.");
  }

  const query = `
    WITH time_boundary AS (
      SELECT
        date_trunc(
          'day',
          NOW() AT TIME ZONE 'Africa/Accra'
        ) AT TIME ZONE 'Africa/Accra' AS today_start,

        (
          date_trunc(
            'day',
            NOW() AT TIME ZONE 'Africa/Accra'
          ) + INTERVAL '1 day'
        ) AT TIME ZONE 'Africa/Accra' AS tomorrow_start
    ),

    normalized_orders AS (
      SELECT
        o.agent_id,
        o.reference,
        LOWER(TRIM(COALESCE(o.status, ''))) AS payment_status,
        LOWER(TRIM(COALESCE(o.delivery_status, ''))) AS delivery_status,
        o.amount::numeric AS selling_amount,
        o.agent_base_price::numeric AS base_price,
        o.delivered_at,
        o.created_at,

        CASE
          WHEN o.agent_base_price IS NOT NULL
          THEN GREATEST(
            o.amount::numeric - o.agent_base_price::numeric,
            0
          )
          ELSE 0
        END AS order_profit

      FROM orders o
      WHERE o.agent_id = $1
    ),

    order_totals AS (
      SELECT
        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
        )::int AS paid_orders,

        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
            AND base_price IS NULL
        )::int AS missing_base_price_orders,

        COALESCE(
          SUM(order_profit) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
          ),
          0
        ) AS total_profit,

        COALESCE(
          SUM(selling_amount) FILTER (
            WHERE payment_status = 'paid'
          ),
          0
        ) AS total_sales,

        COALESCE(
          SUM(order_profit) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
              AND delivery_status IN (
                'delivered',
                'completed',
                'success',
                'successful'
              )
          ),
          0
        ) AS confirmed_profit,

        COALESCE(
          SUM(order_profit) FILTER (
            WHERE payment_status = 'paid'
              AND base_price IS NOT NULL
              AND delivery_status NOT IN (
                'delivered',
                'completed',
                'success',
                'successful',
                'failed',
                'rejected',
                'cancelled',
                'canceled'
              )
          ),
          0
        ) AS pending_delivery_profit,

        COUNT(*) FILTER (
          WHERE payment_status = 'paid'
            AND base_price IS NOT NULL
            AND delivery_status NOT IN (
              'delivered',
              'completed',
              'success',
              'successful',
              'failed',
              'rejected',
              'cancelled',
              'canceled'
            )
        )::int AS pending_delivery_orders

      FROM normalized_orders
    ),

    delivered_earnings AS (
      SELECT
        COALESCE(
          SUM(n.order_profit) FILTER (
            WHERE n.payment_status = 'paid'
              AND n.base_price IS NOT NULL
              AND n.delivery_status IN (
                'delivered',
                'completed',
                'success',
                'successful'
              )
              AND n.delivered_at IS NOT NULL
              AND n.delivered_at < t.today_start
          ),
          0
        ) AS eligible_before_today,

        COALESCE(
          SUM(n.order_profit) FILTER (
            WHERE n.payment_status = 'paid'
              AND n.base_price IS NOT NULL
              AND n.delivery_status IN (
                'delivered',
                'completed',
                'success',
                'successful'
              )
              AND n.delivered_at >= t.today_start
              AND n.delivered_at < t.tomorrow_start
          ),
          0
        ) AS todays_profit,

        COUNT(*) FILTER (
          WHERE n.payment_status = 'paid'
            AND n.base_price IS NOT NULL
            AND n.delivery_status IN (
              'delivered',
              'completed',
              'success',
              'successful'
            )
            AND n.delivered_at IS NOT NULL
            AND n.delivered_at < t.today_start
        )::int AS eligible_before_today_orders,

        COUNT(*) FILTER (
          WHERE n.payment_status = 'paid'
            AND n.base_price IS NOT NULL
            AND n.delivery_status IN (
              'delivered',
              'completed',
              'success',
              'successful'
            )
            AND n.delivered_at >= t.today_start
            AND n.delivered_at < t.tomorrow_start
        )::int AS todays_delivered_orders

      FROM normalized_orders n
      CROSS JOIN time_boundary t
    ),

    withdrawal_totals AS (
      SELECT
        COALESCE(
          SUM(w.amount::numeric) FILTER (
            WHERE LOWER(TRIM(COALESCE(w.status, '')))
              IN ('pending', 'approved', 'paid', 'sent')
          ),
          0
        ) AS reserved_withdrawals,

        COALESCE(
          SUM(w.amount::numeric) FILTER (
            WHERE LOWER(TRIM(COALESCE(w.status, '')))
              IN ('pending', 'approved')
          ),
          0
        ) AS pending_withdrawals

      FROM agent_withdrawals w
      WHERE w.agent_id = $1
    )

    SELECT
      ot.paid_orders,
      ot.missing_base_price_orders,
      ot.total_profit,
      ot.total_sales,
      ot.confirmed_profit,
      ot.pending_delivery_profit,
      ot.pending_delivery_orders,

      de.eligible_before_today,
      de.todays_profit,
      de.eligible_before_today_orders,
      de.todays_delivered_orders,

      wt.reserved_withdrawals,
      wt.pending_withdrawals,

      GREATEST(
        de.eligible_before_today - wt.reserved_withdrawals,
        0
      ) AS available_balance

    FROM order_totals ot
    CROSS JOIN delivered_earnings de
    CROSS JOIN withdrawal_totals wt;
  `;

  const result = await pool.query(query, [agentId]);

  if (!result.rows || result.rows.length === 0) {
    throw new Error(
      "The payout calculation returned no results."
    );
  }

  const row = result.rows[0];

  return {
    success: true,

    agentId: String(agentId),

    currency: "GHS",

    timeZone: GHANA_TIME_ZONE,

    today: getGhanaDateInfo().today,

    generatedAt: new Date().toISOString(),

    totalProfit: moneyFromRow(row.total_profit),

    totalSales: moneyFromRow(row.total_sales),

    confirmedProfit: moneyFromRow(row.confirmed_profit),

    pendingDeliveryProfit:
      moneyFromRow(row.pending_delivery_profit),

    pendingDeliveryOrders:
      Number(row.pending_delivery_orders || 0),

    missingBasePriceOrders:
      Number(row.missing_base_price_orders || 0),

    nextPayout: moneyFromRow(row.todays_profit),

    todaysProfit: moneyFromRow(row.todays_profit),

    availableBalance:
      moneyFromRow(row.available_balance),

    pendingWithdrawals:
      moneyFromRow(row.pending_withdrawals),

    reservedWithdrawals:
      moneyFromRow(row.reserved_withdrawals),

    eligibleBeforeToday:
      moneyFromRow(row.eligible_before_today),

    eligibleBeforeTodayOrders:
      Number(row.eligible_before_today_orders || 0),

    todaysDeliveredOrders:
      Number(row.todays_delivered_orders || 0),

    paidOrders:
      Number(row.paid_orders || 0)
  };
}


/**
 * Optional transaction-safe recalculation helper.
 *
 * This function deliberately does not write a balance into the
 * database. Available balance is derived from order earnings and
 * withdrawal reservations, so repeated requests and midnight
 * recalculations cannot credit the same order twice.
 */
async function refreshNextPayout(pool, agentId) {
  return calculateNextPayout(pool, agentId);
}


module.exports = {
  calculateNextPayout,
  refreshNextPayout,
  getGhanaDate,
  getGhanaDateInfo
};
