"use strict";

/**
 * Kielmen 636 Dataplug
 * Agent Total Profit Calculator
 *
 * Profit = Customer Selling Price - Agent Base Price
 *
 * Only paid and delivered orders are counted.
 */

async function calculateAgentTotalProfit(pool, agentId) {
  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total_orders,

        COALESCE(
          SUM(amount) FILTER (
            WHERE status = 'paid'
          ),
          0
        )::numeric(12,2) AS total_sales,

        COALESCE(
          SUM(
            GREATEST(
              amount - agent_base_price,
              0
            )
          ) FILTER (
            WHERE status = 'paid'
              AND delivery_status = 'delivered'
              AND agent_base_price IS NOT NULL
          ),
          0
        )::numeric(12,2) AS total_profit,

        COUNT(*) FILTER (
          WHERE status = 'paid'
            AND delivery_status = 'delivered'
            AND agent_base_price IS NOT NULL
        )::int AS profit_orders

      FROM orders

      WHERE agent_id = $1
    `,
    [agentId]
  );

  const row = result.rows[0];

  return {
    totalOrders: Number(row.total_orders || 0),
    totalSales: Number(
      Number(row.total_sales || 0).toFixed(2)
    ),
    totalProfit: Number(
      Number(row.total_profit || 0).toFixed(2)
    ),
    profitOrders: Number(row.profit_orders || 0)
  };
}

module.exports = calculateAgentTotalProfit;
