async function calculateAgentTotalProfit(pool, agentId) {
  if (!agentId) {
    throw new Error("Agent ID is required to calculate profit.");
  }

  try {
    const result = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
            AND LOWER(TRIM(COALESCE(delivery_status, '')))
                IN ('delivered', 'completed', 'success', 'successful')
            AND agent_base_price IS NOT NULL
        )::int AS eligible_orders,

        COALESCE(
          SUM(
            GREATEST(
              amount::numeric - agent_base_price::numeric,
              0
            )
          ) FILTER (
            WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
              AND LOWER(TRIM(COALESCE(delivery_status, '')))
                  IN ('delivered', 'completed', 'success', 'successful')
              AND agent_base_price IS NOT NULL
          ),
          0
        )::numeric(12, 2) AS total_profit,

        COALESCE(
          SUM(amount::numeric) FILTER (
            WHERE LOWER(TRIM(COALESCE(status, ''))) = 'paid'
              AND LOWER(TRIM(COALESCE(delivery_status, '')))
                  IN ('delivered', 'completed', 'success', 'successful')
          ),
          0
        )::numeric(12, 2) AS total_sales

      FROM orders
      WHERE agent_id = $1
      `,
      [agentId]
    );

    const row = result.rows[0];

    return {
      eligibleOrders: Number(row.eligible_orders || 0),
      totalProfit: Number(row.total_profit || 0),
      totalSales: Number(row.total_sales || 0)
    };
  } catch (error) {
    console.error(
      "Agent profit calculation failed:",
      error.message
    );

    throw error;
  }
}

module.exports = calculateAgentTotalProfit;
