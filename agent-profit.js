"use strict";

/**
 * Kielmen 636 Dataplug
 * Agent Total Profit Calculator
 *
 * Uses the existing PostgreSQL connection.
 * Counts only paid and delivered agent orders.
 */

async function calculateAgentTotalProfit(pool, agentId) {
  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS eligible_orders,

        COALESCE(
          SUM(amount - agent_base_price),
          0
        )::numeric(12,2) AS total_profit

      FROM orders

      WHERE agent_id = $1
        AND status = 'paid'
        AND delivery_status = 'delivered'
        AND agent_base_price IS NOT NULL
        AND amount > agent_base_price
    `,
    [agentId]
  );

  return {
    eligibleOrders: Number(
      result.rows[0].eligible_orders || 0
    ),

    totalProfit: Number(
      result.rows[0].total_profit || 0
    )
  };
}

module.exports = calculateAgentTotalProfit;
