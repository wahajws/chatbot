import pool from '../config/database.js';

/**
 * Analyze user question and generate appropriate SQL queries
 * Returns query results that can be used to answer the question
 */

/**
 * Detect if question requires calculations/aggregations
 */
export function requiresCalculation(question) {
  const lowerQuestion = question.toLowerCase();
  
  const calculationKeywords = [
    'average', 'avg', 'mean',
    'total', 'sum', 'count',
    'most', 'least', 'highest', 'lowest', 'top', 'bottom',
    'maximum', 'minimum', 'max', 'min',
    'which day', 'which month', 'which year',
    'per day', 'per month', 'per year',
    'group by', 'compare', 'ranking'
  ];
  
  return calculationKeywords.some(kw => lowerQuestion.includes(kw));
}

/**
 * Generate and execute SQL query based on question
 */
export async function executeAnalyticalQuery(question) {
  const lowerQuestion = question.toLowerCase();
  let result = null;

  try {
    // Questions about orders by date
    if (lowerQuestion.includes('day') && (lowerQuestion.includes('order') || lowerQuestion.includes('most'))) {
      result = await pool.query(`
        SELECT 
          DATE(order_date) as order_day,
          COUNT(*) as order_count,
          SUM(total_amount) as total_revenue
        FROM orders
        GROUP BY DATE(order_date)
        ORDER BY order_count DESC
        LIMIT 10
      `);
      return {
        type: 'daily_orders',
        data: result.rows.map(row => ({
          date: new Date(row.order_day).toLocaleDateString(),
          orders: parseInt(row.order_count),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Day with most orders: ${new Date(result.rows[0]?.order_day).toLocaleDateString()} with ${result.rows[0]?.order_count} orders`
      };
    }

    // Questions about orders by month
    if (lowerQuestion.includes('month') && (lowerQuestion.includes('order') || lowerQuestion.includes('most'))) {
      result = await pool.query(`
        SELECT 
          DATE_TRUNC('month', order_date) as order_month,
          COUNT(*) as order_count,
          SUM(total_amount) as total_revenue
        FROM orders
        GROUP BY DATE_TRUNC('month', order_date)
        ORDER BY order_count DESC
        LIMIT 12
      `);
      return {
        type: 'monthly_orders',
        data: result.rows.map(row => ({
          month: new Date(row.order_month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          orders: parseInt(row.order_count),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Month with most orders: ${new Date(result.rows[0]?.order_month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} with ${result.rows[0]?.order_count} orders`
      };
    }

    // Average order value
    if (lowerQuestion.includes('average') && (lowerQuestion.includes('order') || lowerQuestion.includes('value'))) {
      result = await pool.query(`
        SELECT 
          AVG(total_amount) as avg_order_value,
          COUNT(*) as total_orders,
          SUM(total_amount) as total_revenue
        FROM orders
      `);
      const row = result.rows[0];
      return {
        type: 'average_order',
        data: [{
          metric: 'Average Order Value',
          value: parseFloat(row.avg_order_value)
        }],
        answer: `Average order value: $${parseFloat(row.avg_order_value).toFixed(2)}. Total orders: ${parseInt(row.total_orders)}. Total revenue: $${parseFloat(row.total_revenue).toFixed(2)}`
      };
    }

    // Total revenue
    if (lowerQuestion.includes('total') && (lowerQuestion.includes('revenue') || lowerQuestion.includes('sales'))) {
      result = await pool.query(`
        SELECT 
          SUM(total_amount) as total_revenue,
          COUNT(*) as total_orders,
          AVG(total_amount) as avg_order_value
        FROM orders
      `);
      const row = result.rows[0];
      return {
        type: 'total_revenue',
        data: [{
          metric: 'Total Revenue',
          value: parseFloat(row.total_revenue)
        }],
        answer: `Total revenue: $${parseFloat(row.total_revenue).toFixed(2)}. Total orders: ${parseInt(row.total_orders)}. Average order value: $${parseFloat(row.avg_order_value).toFixed(2)}`
      };
    }

    // Top products by sales
    if (lowerQuestion.includes('top') && (lowerQuestion.includes('product') || lowerQuestion.includes('selling'))) {
      result = await pool.query(`
        SELECT 
          p.name,
          SUM(oi.quantity) as total_sold,
          SUM(oi.subtotal) as total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        GROUP BY p.id, p.name
        ORDER BY total_sold DESC
        LIMIT 10
      `);
      return {
        type: 'top_products',
        data: result.rows.map(row => ({
          name: row.name,
          sales: parseInt(row.total_sold),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Top product: ${result.rows[0]?.name} with ${result.rows[0]?.total_sold} units sold`
      };
    }

    // Products by category
    if (lowerQuestion.includes('category') || lowerQuestion.includes('by category')) {
      result = await pool.query(`
        SELECT 
          p.category,
          COUNT(DISTINCT oi.order_id) as order_count,
          SUM(oi.quantity) as total_quantity,
          SUM(oi.subtotal) as total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.category IS NOT NULL
        GROUP BY p.category
        ORDER BY total_revenue DESC
      `);
      return {
        type: 'category_breakdown',
        data: result.rows.map(row => ({
          category: row.category,
          orders: parseInt(row.order_count),
          quantity: parseInt(row.total_quantity),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Categories: ${result.rows.map(r => `${r.category} (${r.total_revenue.toFixed(2)})`).join(', ')}`
      };
    }

    // Customer statistics
    if (lowerQuestion.includes('customer') && (lowerQuestion.includes('most') || lowerQuestion.includes('top'))) {
      result = await pool.query(`
        SELECT 
          c.name,
          c.city,
          COUNT(o.id) as order_count,
          SUM(o.total_amount) as total_spent
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        GROUP BY c.id, c.name, c.city
        ORDER BY order_count DESC, total_spent DESC
        LIMIT 10
      `);
      return {
        type: 'top_customers',
        data: result.rows.map(row => ({
          name: row.name,
          city: row.city,
          orders: parseInt(row.order_count),
          spent: parseFloat(row.total_spent || 0)
        })),
        answer: `Top customer: ${result.rows[0]?.name} with ${result.rows[0]?.order_count} orders`
      };
    }

    // Order status breakdown
    if (lowerQuestion.includes('status') || lowerQuestion.includes('order status')) {
      result = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count,
          SUM(total_amount) as total_revenue
        FROM orders
        GROUP BY status
        ORDER BY count DESC
      `);
      return {
        type: 'order_status',
        data: result.rows.map(row => ({
          status: row.status,
          count: parseInt(row.count),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Order statuses: ${result.rows.map(r => `${r.status}: ${r.count}`).join(', ')}`
      };
    }

    // Revenue by payment method
    if (lowerQuestion.includes('payment') || lowerQuestion.includes('payment method')) {
      result = await pool.query(`
        SELECT 
          payment_method,
          COUNT(*) as order_count,
          SUM(total_amount) as total_revenue
        FROM orders
        WHERE payment_method IS NOT NULL
        GROUP BY payment_method
        ORDER BY total_revenue DESC
      `);
      return {
        type: 'payment_methods',
        data: result.rows.map(row => ({
          method: row.payment_method,
          orders: parseInt(row.order_count),
          revenue: parseFloat(row.total_revenue)
        })),
        answer: `Payment methods: ${result.rows.map(r => `${r.payment_method}: $${r.total_revenue.toFixed(2)}`).join(', ')}`
      };
    }

  } catch (error) {
    console.error('Error executing analytical query:', error);
    return null;
  }

  return null;
}

/**
 * Get comprehensive statistics for general questions
 */
export async function getComprehensiveStats() {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM customers) as total_customers,
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM orders) as total_orders,
        (SELECT SUM(total_amount) FROM orders) as total_revenue,
        (SELECT AVG(total_amount) FROM orders) as avg_order_value,
        (SELECT COUNT(*) FROM order_items) as total_order_items
    `);

    return stats.rows[0];
  } catch (error) {
    console.error('Error getting comprehensive stats:', error);
    return null;
  }
}










