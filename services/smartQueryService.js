import { getSchema } from './schemaCache.js';
import { queryWithRetry } from '../utils/dbRetry.js';

/**
 * Smart table and column detection from schema
 */
export async function detectOrderTable() {
  const schema = await getSchema(true);
  if (!schema || !schema.tables) {
    return null;
  }

  // Find order-related tables
  const orderTables = schema.tables.filter(table => {
    const name = table.name.toLowerCase();
    return name.includes('order') || name.includes('delivery') || name.includes('invoice');
  });

  // Prefer deliveryorders or delivery_orders
  const deliveryOrderTable = orderTables.find(t => 
    t.name.toLowerCase() === 'deliveryorders' || 
    t.name.toLowerCase() === 'delivery_orders'
  );

  if (deliveryOrderTable) {
    return {
      tableName: deliveryOrderTable.name,
      rowCount: deliveryOrderTable.rowCount,
      columns: deliveryOrderTable.columns
    };
  }

  // Return first order table if found
  if (orderTables.length > 0) {
    return {
      tableName: orderTables[0].name,
      rowCount: orderTables[0].rowCount,
      columns: orderTables[0].columns
    };
  }

  return null;
}

/**
 * Detect date column in a table
 */
export function detectDateColumn(columns) {
  if (!columns || columns.length === 0) {
    return null;
  }

  // Look for common date column names
  const dateColumnNames = ['created_at', 'createdat', 'created', 'order_date', 'date', 'timestamp', 'createdon'];
  
  for (const colName of dateColumnNames) {
    const col = columns.find(c => 
      c.name.toLowerCase() === colName.toLowerCase() ||
      c.name.toLowerCase().includes('created') ||
      c.name.toLowerCase().includes('date')
    );
    if (col) {
      return col.name;
    }
  }

  // Return first timestamp/date type column
  const dateCol = columns.find(c => 
    c.type.includes('timestamp') || 
    c.type.includes('date') ||
    c.type.includes('time')
  );

  return dateCol ? dateCol.name : null;
}

/**
 * Generate smart SQL for "orders grouped by month"
 */
export async function generateSmartGroupedByMonthSQL() {
  const orderTable = await detectOrderTable();
  if (!orderTable) {
    return null;
  }

  const dateColumn = detectDateColumn(orderTable.columns);
  if (!dateColumn) {
    return null;
  }

  // Generate SQL using detected table and column names
  return `SELECT EXTRACT(YEAR FROM "${dateColumn}") as year, EXTRACT(MONTH FROM "${dateColumn}") as month, COUNT(*) as ordercount FROM "${orderTable.tableName}" GROUP BY EXTRACT(YEAR FROM "${dateColumn}"), EXTRACT(MONTH FROM "${dateColumn}") ORDER BY year, month`;
}

/**
 * Generate SQL for delivery orders by status with revenue
 */
export async function generateOrdersByStatusSQL() {
  const orderTable = await detectOrderTable();
  if (!orderTable) {
    return null;
  }

  const dateColumn = detectDateColumn(orderTable.columns);
  const statusColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('status') || 
    c.name.toLowerCase().includes('state')
  );
  const revenueColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('total') || 
    c.name.toLowerCase().includes('amount') ||
    c.name.toLowerCase().includes('grandtotal') ||
    c.name.toLowerCase().includes('revenue')
  );

  if (!statusColumn || !revenueColumn) {
    return null;
  }

  // Get current month
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  return `SELECT "${statusColumn.name}" as status, COUNT(*) as ordercount, COALESCE(SUM("${revenueColumn.name}"), 0) as totalrevenue FROM "${orderTable.tableName}" WHERE EXTRACT(YEAR FROM "${dateColumn}") = ${currentYear} AND EXTRACT(MONTH FROM "${dateColumn}") = ${currentMonth} GROUP BY "${statusColumn.name}" ORDER BY ordercount DESC`;
}

/**
 * Generate SQL for revenue per customer with order count filter
 */
export async function generateRevenuePerCustomerSQL(minOrders = 5) {
  const orderTable = await detectOrderTable();
  if (!orderTable) {
    return null;
  }

  const accountColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('account') || 
    c.name.toLowerCase().includes('customer')
  );
  const revenueColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('total') || 
    c.name.toLowerCase().includes('amount') ||
    c.name.toLowerCase().includes('grandtotal')
  );

  if (!accountColumn || !revenueColumn) {
    return null;
  }

  return `SELECT "${accountColumn.name}" as accountid, COUNT(*) as ordercount, COALESCE(SUM("${revenueColumn.name}"), 0) as totalrevenue FROM "${orderTable.tableName}" GROUP BY "${accountColumn.name}" HAVING COUNT(*) > ${minOrders} ORDER BY totalrevenue DESC`;
}

/**
 * Generate SQL for month-over-month growth rate
 */
export async function generateMonthOverMonthGrowthSQL(months = 6) {
  const orderTable = await detectOrderTable();
  if (!orderTable) {
    return null;
  }

  const dateColumn = detectDateColumn(orderTable.columns);
  if (!dateColumn) {
    return null;
  }

  // Use window function to calculate growth rate
  return `WITH monthly_orders AS (
    SELECT 
      EXTRACT(YEAR FROM "${dateColumn}") as year,
      EXTRACT(MONTH FROM "${dateColumn}") as month,
      COUNT(*) as ordercount
    FROM "${orderTable.tableName}"
    WHERE "${dateColumn}" >= CURRENT_DATE - INTERVAL '${months} months'
    GROUP BY EXTRACT(YEAR FROM "${dateColumn}"), EXTRACT(MONTH FROM "${dateColumn}")
  ),
  with_previous AS (
    SELECT 
      year,
      month,
      ordercount,
      LAG(ordercount) OVER (ORDER BY year, month) as previous_count
    FROM monthly_orders
  )
  SELECT 
    year,
    month,
    ordercount,
    previous_count,
    CASE 
      WHEN previous_count > 0 THEN 
        ROUND(((ordercount - previous_count)::numeric / previous_count * 100)::numeric, 2)
      ELSE NULL
    END as growth_rate_percent
  FROM with_previous
  ORDER BY year, month`;
}

/**
 * Generate SQL for delivery orders with high quantity items
 */
export async function generateOrdersWithHighQuantitySQL(minQuantity = 10) {
  const schema = await getSchema(true);
  if (!schema || !schema.tables) {
    return null;
  }

  // Find deliveryorders and deliveryorderdetails tables
  const orderTable = schema.tables.find(t => 
    t.name.toLowerCase() === 'deliveryorders' || 
    t.name.toLowerCase() === 'delivery_orders'
  );
  const detailTable = schema.tables.find(t => 
    t.name.toLowerCase() === 'deliveryorderdetails' || 
    t.name.toLowerCase() === 'delivery_order_details'
  );

  if (!orderTable || !detailTable) {
    return null;
  }

  const accountColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('account')
  );
  const revenueColumn = orderTable.columns.find(c => 
    c.name.toLowerCase().includes('total') || 
    c.name.toLowerCase().includes('grandtotal')
  );
  const quantityColumn = detailTable.columns.find(c => 
    c.name.toLowerCase().includes('quantity') || 
    c.name.toLowerCase().includes('qty')
  );

  // Find the join column
  const orderIdColumn = orderTable.columns.find(c => 
    c.name.toLowerCase() === 'id'
  );
  const detailOrderIdColumn = detailTable.columns.find(c => 
    c.name.toLowerCase().includes('deliveryorderid') || 
    c.name.toLowerCase().includes('orderid')
  );

  if (!accountColumn || !revenueColumn || !quantityColumn || !orderIdColumn || !detailOrderIdColumn) {
    return null;
  }

  return `SELECT DISTINCT 
    do."${orderIdColumn.name}" as orderid,
    do."${accountColumn.name}" as accountid,
    do."${revenueColumn.name}" as totalordervalue,
    MAX(dod."${quantityColumn.name}") as maxquantity
  FROM "${orderTable.name}" do
  JOIN "${detailTable.name}" dod ON do."${orderIdColumn.name}" = dod."${detailOrderIdColumn.name}"
  WHERE dod."${quantityColumn.name}" > ${minQuantity}
  GROUP BY do."${orderIdColumn.name}", do."${accountColumn.name}", do."${revenueColumn.name}"
  ORDER BY totalordervalue DESC`;
}

/**
 * Execute smart query and return results
 */
export async function executeSmartQuery(queryPattern, params = {}) {
  try {
    let sql = null;

    if (queryPattern === 'orders_grouped_by_month') {
      sql = await generateSmartGroupedByMonthSQL();
    } else if (queryPattern === 'orders_by_status') {
      sql = await generateOrdersByStatusSQL();
    } else if (queryPattern === 'revenue_per_customer') {
      sql = await generateRevenuePerCustomerSQL(params.minOrders || 5);
    } else if (queryPattern === 'month_over_month_growth') {
      sql = await generateMonthOverMonthGrowthSQL(params.months || 6);
    } else if (queryPattern === 'orders_with_high_quantity') {
      sql = await generateOrdersWithHighQuantitySQL(params.minQuantity || 10);
    }

    if (!sql) {
      return null;
    }

    console.log('[Smart Query] Executing smart query:', sql.substring(0, 200));
    const result = await queryWithRetry(sql);
    console.log('[Smart Query] Query executed successfully, rows:', result.rows.length);
    
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rows.length,
      sql: sql
    };
  } catch (error) {
    console.error('[Smart Query] Error executing smart query:', error.message);
    return {
      success: false,
      error: error.message,
      sql: sql
    };
  }
}

