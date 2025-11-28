import { getSchema } from './schemaCache.js';
import { generateSQLFromQuestion, executeSQLQuery } from './sqlGenerator.js';
import { getLLMResponse } from './llmService.js';
import { queryWithRetry } from '../utils/dbRetry.js';
import { detectOrderTable, detectDateColumn } from './smartQueryService.js';

/**
 * Get AI-suggested chart visualizations based on database schema
 */
export async function getSuggestedCharts() {
  try {
    console.log('[Analytics Service] Getting AI-suggested charts...');
    
    // Get cached schema
    const schema = await getSchema(true);
    
    if (!schema || !schema.tables || schema.tables.length === 0) {
      console.log('[Analytics Service] No schema available');
      return { charts: [], suggestions: [] };
    }

    // Find tables with significant data (more than 10 rows)
    const significantTables = schema.tables
      .filter(table => table.rowCount > 10)
      .slice(0, 20) // Limit to top 20 tables
      .map(table => ({
        name: table.name,
        rowCount: table.rowCount,
        columns: table.columns.map(c => c.name),
        hasNumericColumns: table.columns.some(c => 
          /int|numeric|decimal|float|double|real|money|bigint|smallint/i.test(c.type)
        ),
        hasDateColumns: table.columns.some(c => 
          /date|time|timestamp/i.test(c.type)
        )
      }));

    if (significantTables.length === 0) {
      return { charts: [], suggestions: [] };
    }

    // Generate chart suggestions based on schema analysis
    console.log('[Analytics Service] Analyzing schema to generate chart suggestions...');
    
    // Generate intelligent suggestions based on table structure
    let suggestions = generateIntelligentSuggestions(significantTables, schema);
    
    // If we have very few suggestions, try LLM to get more
    if (suggestions.length < 4) {
      try {
        const schemaSummary = significantTables.map(t => 
          `Table: ${t.name} (${t.rowCount} rows) - Columns: ${t.columns.slice(0, 10).join(', ')}`
        ).join('\n');

        const suggestionPrompt = `Based on this database schema, suggest 3-5 relevant charts for analytics. For each, provide a SQL query that returns exactly 2 columns (name and value). Focus on the largest tables with the most data.

${schemaSummary}

Return JSON array format:
[{"title": "Chart Title", "type": "bar", "sql": "SELECT col AS name, COUNT(*) AS value FROM table GROUP BY col LIMIT 15", "description": "Description"}]`;

        console.log('[Analytics Service] Getting additional suggestions from LLM...');
        const llmResponse = await getLLMResponse(
          suggestionPrompt,
          [],
          `Database has ${schema.totalTables} tables.`
        );

        // Try to extract JSON from LLM response
        try {
          const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const llmSuggestions = JSON.parse(jsonMatch[0]);
            // Merge with existing suggestions
            suggestions = [...suggestions, ...llmSuggestions].slice(0, 8);
          }
        } catch (parseError) {
          console.log('[Analytics Service] Could not parse LLM suggestions, using schema-based suggestions');
        }
      } catch (llmError) {
        console.log('[Analytics Service] LLM suggestion failed, using schema-based suggestions:', llmError.message);
      }
    }

    // Limit to 6 suggestions
    suggestions = suggestions.slice(0, 6);

    // Add year-on-year sales comparison chart (always include if we have order data)
    try {
      const yearOnYearChart = await generateYearOnYearSalesChart(schema);
      if (yearOnYearChart) {
        suggestions.unshift(yearOnYearChart); // Add at the beginning
      }
    } catch (error) {
      console.log('[Analytics Service] Could not generate year-on-year chart:', error.message);
    }

    // Generate chart data for each suggestion
    const charts = [];
    for (const suggestion of suggestions) {
      try {
        if (!suggestion.sql) {
          // If no SQL provided, try to generate one
          const sqlQuery = await generateSQLFromQuestion(
            `Generate a ${suggestion.type} chart showing ${suggestion.title}`,
            schemaSummary
          );
          if (sqlQuery) {
            suggestion.sql = sqlQuery;
          } else {
            continue; // Skip if we can't generate SQL
          }
        }

        // If suggestion already has data (like year-on-year), use it directly
        if (suggestion.data && suggestion.data.length > 0) {
          charts.push({
            title: suggestion.title || 'Chart',
            type: suggestion.type || 'bar',
            description: suggestion.description || '',
            data: suggestion.data
          });
          continue;
        }

        // Execute the SQL query
        const result = await executeSQLQuery(suggestion.sql);
        
        if (result && result.success && result.rows && result.rows.length > 0) {
          // Convert to chart format
          const rows = result.rows;
          const columns = Object.keys(rows[0]);
          
          // Find name and value columns
          let nameCol = columns.find(c => /name|label|title|category|type|status/i.test(c)) || columns[0];
          let valueCol = columns.find(c => /count|total|sum|amount|value|quantity/i.test(c)) || columns[1];
          
          if (nameCol && valueCol && nameCol !== valueCol) {
            const chartData = rows.slice(0, 20).map(row => {
              const name = String(row[nameCol] || '').trim();
              const rawValue = row[valueCol];
              const value = typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || parseInt(rawValue) || 0);
              
              if (name && !isNaN(value)) {
                return {
                  name: name.length > 25 ? name.substring(0, 22) + '...' : name,
                  value: Math.abs(value)
                };
              }
              return null;
            }).filter(Boolean);

            if (chartData.length > 0) {
              charts.push({
                title: suggestion.title || 'Chart',
                type: suggestion.type || 'bar',
                description: suggestion.description || '',
                data: chartData
              });
            }
          }
        }
      } catch (error) {
        console.log(`[Analytics Service] Error generating chart for "${suggestion.title}":`, error.message);
        // Continue with other charts
      }
    }

    console.log(`[Analytics Service] Generated ${charts.length} charts`);
    return { charts, suggestions };
  } catch (error) {
    console.error('[Analytics Service] Error getting suggested charts:', error.message);
    return { charts: [], suggestions: [] };
  }
}

/**
 * Generate intelligent chart suggestions based on table structure
 */
function generateIntelligentSuggestions(tables, schema) {
  const suggestions = [];

  // Find order-related tables (delivery orders, orders, etc.)
  const orderTables = tables.filter(t => 
    /order|delivery|transaction|sale|invoice|consignment/i.test(t.name)
  );

  // Find product/item tables
  const productTables = tables.filter(t => 
    /product|item|inventory|stock|goods/i.test(t.name)
  );

  // Find customer tables
  const customerTables = tables.filter(t => 
    /customer|client|user|account|party/i.test(t.name)
  );

  // Find detail/item tables
  const detailTables = tables.filter(t => 
    /detail|item|line/i.test(t.name)
  );

  // Generate suggestions based on what we found
  if (orderTables.length > 0) {
    const orderTable = orderTables[0];
    const dateCol = orderTable.columns.find(c => /date|time|created|updated/i.test(c));
    const statusCol = orderTable.columns.find(c => /status|state|type/i.test(c));
    
    if (dateCol) {
      suggestions.push({
        title: `${orderTable.name} Over Time`,
        type: 'line',
        sql: `SELECT DATE("${dateCol}") AS name, COUNT(*) AS value FROM "${orderTable.name}" WHERE "${dateCol}" IS NOT NULL GROUP BY DATE("${dateCol}") ORDER BY name DESC LIMIT 15`,
        description: `Trends in ${orderTable.name} over time`
      });
    }
    
    if (statusCol) {
      suggestions.push({
        title: `${orderTable.name} by ${statusCol}`,
        type: 'bar',
        sql: `SELECT "${statusCol}" AS name, COUNT(*) AS value FROM "${orderTable.name}" WHERE "${statusCol}" IS NOT NULL GROUP BY "${statusCol}" ORDER BY value DESC LIMIT 10`,
        description: `Distribution of ${orderTable.name} by ${statusCol}`
      });
    }
  }

  // Delivery order details specific charts
  const deliveryDetailsTable = tables.find(t => /deliveryorderdetail/i.test(t.name));
  if (deliveryDetailsTable) {
    const qtyCol = deliveryDetailsTable.columns.find(c => /qty|quantity|amount/i.test(c));
    const productCol = deliveryDetailsTable.columns.find(c => /product|item|name/i.test(c));
    const statusCol = deliveryDetailsTable.columns.find(c => /status|state/i.test(c));
    
    if (qtyCol && productCol) {
      suggestions.push({
        title: 'Top Products by Quantity',
        type: 'bar',
        sql: `SELECT "${productCol}" AS name, SUM("${qtyCol}") AS value FROM "${deliveryDetailsTable.name}" WHERE "${productCol}" IS NOT NULL GROUP BY "${productCol}" ORDER BY value DESC LIMIT 15`,
        description: 'Top products by total quantity in delivery orders'
      });
    }
    
    if (statusCol) {
      suggestions.push({
        title: 'Delivery Details by Status',
        type: 'pie',
        sql: `SELECT "${statusCol}" AS name, COUNT(*) AS value FROM "${deliveryDetailsTable.name}" WHERE "${statusCol}" IS NOT NULL GROUP BY "${statusCol}" ORDER BY value DESC LIMIT 10`,
        description: 'Distribution of delivery order details by status'
      });
    }
  }

  if (productTables.length > 0) {
    const productTable = productTables[0];
    const categoryCol = productTable.columns.find(c => /category|type|group|class/i.test(c));
    
    if (categoryCol) {
      suggestions.push({
        title: 'Products by Category',
        type: 'pie',
        sql: `SELECT "${categoryCol}" AS name, COUNT(*) AS value FROM "${productTable.name}" WHERE "${categoryCol}" IS NOT NULL GROUP BY "${categoryCol}" ORDER BY value DESC LIMIT 10`,
        description: 'Product distribution by category'
      });
    }
  }

  // Credit notes chart
  const creditNotesTable = tables.find(t => /creditnote/i.test(t.name));
  if (creditNotesTable) {
    const amountCol = creditNotesTable.columns.find(c => /amount|total|value/i.test(c));
    const dateCol = creditNotesTable.columns.find(c => /date|created/i.test(c));
    
    if (amountCol && dateCol) {
      suggestions.push({
        title: 'Credit Notes Over Time',
        type: 'line',
        sql: `SELECT DATE("${dateCol}") AS name, COUNT(*) AS value FROM "${creditNotesTable.name}" WHERE "${dateCol}" IS NOT NULL GROUP BY DATE("${dateCol}") ORDER BY name DESC LIMIT 15`,
        description: 'Credit notes trend over time'
      });
    }
  }

  // Deals chart
  const dealsTable = tables.find(t => /deal/i.test(t.name));
  if (dealsTable) {
    const typeCol = dealsTable.columns.find(c => /type|category|status/i.test(c));
    if (typeCol) {
      suggestions.push({
        title: 'Deals by Type',
        type: 'bar',
        sql: `SELECT "${typeCol}" AS name, COUNT(*) AS value FROM "${dealsTable.name}" WHERE "${typeCol}" IS NOT NULL GROUP BY "${typeCol}" ORDER BY value DESC LIMIT 10`,
        description: 'Distribution of deals by type'
      });
    }
  }

  // Top tables by row count
  if (tables.length > 0) {
    const topTable = tables[0];
    if (topTable.rowCount > 1000) {
      const idCol = topTable.columns.find(c => /id|code|number/i.test(c)) || topTable.columns[0];
      suggestions.push({
        title: `Top ${topTable.name} (Sample)`,
        type: 'bar',
        sql: `SELECT "${idCol}"::text AS name, 1 AS value FROM "${topTable.name}" LIMIT 15`,
        description: `Sample data from ${topTable.name}`
      });
    }
  }

  return suggestions.slice(0, 8);
}

/**
 * Generate year-on-year sales comparison chart
 */
async function generateYearOnYearSalesChart(schema) {
  try {
    const orderTable = await detectOrderTable();
    if (!orderTable) {
      return null;
    }

    const dateColumn = detectDateColumn(orderTable.columns);
    const revenueColumn = orderTable.columns.find(c => 
      c.name.toLowerCase().includes('total') || 
      c.name.toLowerCase().includes('amount') ||
      c.name.toLowerCase().includes('grandtotal') ||
      c.name.toLowerCase().includes('revenue')
    );

    if (!dateColumn || !revenueColumn) {
      return null;
    }

    // Handle date column variations (createdat vs created_at)
    // Check if both variations exist
    const hasCreatedAt = orderTable.columns.some(c => c.name.toLowerCase() === 'created_at');
    const hasCreatedat = orderTable.columns.some(c => c.name.toLowerCase() === 'createdat');
    
    let dateColumnExpr;
    if (hasCreatedAt && hasCreatedat) {
      dateColumnExpr = `COALESCE("createdat", "created_at")`;
    } else if (dateColumn.includes('_')) {
      dateColumnExpr = `"${dateColumn}"`;
    } else {
      dateColumnExpr = `COALESCE("${dateColumn}", "created_at")`;
    }

    // Generate SQL for year-on-year comparison
    const sql = `WITH monthly_sales AS (
      SELECT 
        EXTRACT(YEAR FROM ${dateColumnExpr}) as year,
        EXTRACT(MONTH FROM ${dateColumnExpr}) as month,
        COALESCE(SUM("${revenueColumn.name}"), 0) as sales
      FROM "${orderTable.tableName}"
      WHERE EXTRACT(YEAR FROM ${dateColumnExpr}) IN (2024, 2025)
        AND ${dateColumnExpr} IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM ${dateColumnExpr}), EXTRACT(MONTH FROM ${dateColumnExpr})
    )
    SELECT 
      month,
      MAX(CASE WHEN year = 2024 THEN sales ELSE 0 END) as sales_2024,
      MAX(CASE WHEN year = 2025 THEN sales ELSE 0 END) as sales_2025
    FROM monthly_sales
    GROUP BY month
    ORDER BY month`;

    // Execute query
    const result = await queryWithRetry(sql);
    
    if (result && result.rows && result.rows.length > 0) {
      // Convert to chart format with two data keys for grouped bar chart
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const chartData = result.rows.map(row => ({
        name: monthNames[parseInt(row.month) - 1] || `Month ${row.month}`,
        '2024': parseFloat(row.sales_2024) || 0,
        '2025': parseFloat(row.sales_2025) || 0
      }));

      if (chartData.length > 0) {
        return {
          title: 'Year-on-Year Sales Comparison',
          type: 'yearonyear', // Special type for grouped bar chart
          description: 'Monthly sales comparison: 2024 vs 2025',
          sql: sql,
          data: chartData
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Analytics Service] Error generating year-on-year chart:', error.message);
    return null;
  }
}

/**
 * Get database statistics for dashboard
 */
export async function getDashboardStats() {
  try {
    const schema = await getSchema(true);
    
    if (!schema) {
      return null;
    }

    // Calculate statistics
    const totalTables = schema.totalTables || 0;
    const totalRows = schema.tables.reduce((sum, table) => sum + (table.rowCount || 0), 0);
    const largestTable = schema.tables.reduce((max, table) => 
      (table.rowCount || 0) > (max.rowCount || 0) ? table : max,
      schema.tables[0] || { name: 'N/A', rowCount: 0 }
    );

    // Find order-related tables
    const orderTables = schema.tables.filter(t => 
      /order|delivery|transaction/i.test(t.name)
    );
    const totalOrders = orderTables.reduce((sum, t) => sum + (t.rowCount || 0), 0);

    return {
      totalTables,
      totalRows,
      largestTable: {
        name: largestTable.name,
        rowCount: largestTable.rowCount
      },
      totalOrders,
      databaseSize: schema.databaseSize || 'Unknown'
    };
  } catch (error) {
    console.error('[Analytics Service] Error getting dashboard stats:', error.message);
    return null;
  }
}

