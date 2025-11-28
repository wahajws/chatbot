import pool from '../config/database.js';
import { queryWithRetry } from '../utils/dbRetry.js';

/**
 * Get database schema information (tables, columns, data types)
 * @returns {Promise<string>} - Formatted schema information
 */
export async function getDatabaseSchema() {
  try {
    console.log('[DB Service] Getting database schema...');
    // Get all tables in the public schema with retry
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('[DB Service] Found tables:', tablesResult.rows.length);

    if (tablesResult.rows.length === 0) {
      console.log('[DB Service] No tables found in database');
      return 'Database has no tables.';
    }

    const totalTables = tablesResult.rows.length;
    let schemaInfo = `DATABASE SCHEMA:\n`;
    schemaInfo += `Total tables: ${totalTables}\n\n`;
    
    // For large databases, get a summary first, then detailed info for first 20 tables
    const MAX_DETAILED_TABLES = 20;
    const tablesToDetail = tablesResult.rows.slice(0, MAX_DETAILED_TABLES);
    const remainingTables = tablesResult.rows.slice(MAX_DETAILED_TABLES);

    // Get all table names and row counts in one query for summary
    console.log('[DB Service] Getting row counts for', tablesResult.rows.length, 'tables...');
    let allTableInfo = [];
    for (let i = 0; i < tablesResult.rows.length; i++) {
      const table = tablesResult.rows[i];
      const tableName = table.table_name;
      try {
        if (i % 10 === 0) {
          console.log(`[DB Service] Processing table ${i + 1}/${tablesResult.rows.length}: ${tableName}`);
        }
        const countResult = await queryWithRetry(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const rowCount = parseInt(countResult.rows[0].count);
        allTableInfo.push({ name: tableName, rows: rowCount });
      } catch (e) {
        console.log(`[DB Service] Could not get row count for ${tableName}:`, e.message);
        // Skip tables that can't be queried (permissions, etc.)
        allTableInfo.push({ name: tableName, rows: 0 });
      }
    }
    console.log('[DB Service] Completed row count queries');

    // Add summary of all tables
    schemaInfo += `ALL TABLES (${totalTables} total):\n`;
    allTableInfo.forEach(table => {
      schemaInfo += `- ${table.name} (${table.rows} rows)\n`;
    });
    schemaInfo += `\n`;

    // Get detailed column information for first N tables (or all if less than MAX)
    schemaInfo += `DETAILED SCHEMA (first ${Math.min(totalTables, MAX_DETAILED_TABLES)} tables):\n\n`;
    
    for (const table of tablesToDetail) {
      const tableName = table.table_name;
      const tableInfo = allTableInfo.find(t => t.name === tableName);
      const rowCount = tableInfo ? tableInfo.rows : 0;
      
      // Get columns for this table
      const columnsResult = await queryWithRetry(`
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' 
          AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      schemaInfo += `Table: ${tableName} (${rowCount} rows)\n`;
      schemaInfo += `Columns: ${columnsResult.rows.map(col => `${col.column_name} (${col.data_type})`).join(', ')}\n\n`;
    }

    // If there are more tables, mention them
    if (remainingTables.length > 0) {
      schemaInfo += `\nAdditional ${remainingTables.length} tables (schema details available on request):\n`;
      remainingTables.forEach(table => {
        const tableInfo = allTableInfo.find(t => t.name === table.table_name);
        const rowCount = tableInfo ? tableInfo.rows : 0;
        schemaInfo += `- ${table.table_name} (${rowCount} rows)\n`;
      });
    }

    return schemaInfo;
  } catch (error) {
    // Don't log connection errors as errors - they're expected with network issues
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED' ||
                             error.message?.includes('Connection terminated');
    
    if (!isConnectionError) {
      console.error('Error getting database schema:', error.message);
    }
    return 'Unable to retrieve database schema at this time.';
  }
}

/**
 * Search all tables in the database for relevant data based on query
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results per table (default: 5)
 * @returns {Promise<string>} - Formatted search results
 */
export async function searchDatabaseData(query, limit = 5) {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return '';
    }

    // Get all tables
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      return 'No tables found in database.';
    }

    const searchTerm = `%${query.trim().toLowerCase()}%`;
    let results = `Search results for "${query}":\n\n`;

    // Search each table
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      
      try {
        // Get column names for this table
        const columnsResult = await queryWithRetry(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public' 
            AND table_name = $1
        `, [tableName]);

        if (columnsResult.rows.length === 0) continue;

        // Get all columns - we'll search in all of them by converting to text
        const allColumns = columnsResult.rows.map(c => c.column_name);

        // Build WHERE clause - search in all columns by converting to text
        let whereClause = '';
        if (allColumns.length > 0) {
          // Search in all columns by converting them to text
          const conditions = allColumns.map(col => 
            `LOWER(COALESCE("${col}"::text, '')) LIKE $1`
          ).join(' OR ');
          whereClause = `WHERE ${conditions}`;
        }

        // Query the table (use identifier quoting for table name)
        if (whereClause) {
          const querySQL = `
            SELECT * 
            FROM "${tableName}" 
            ${whereClause}
            LIMIT $2
          `;

          const dataResult = await queryWithRetry(querySQL, [searchTerm, limit]);

          if (dataResult.rows.length > 0) {
            results += `Table: ${tableName}\n`;
            results += `Found ${dataResult.rows.length} matching row(s):\n`;
            
            dataResult.rows.forEach((row, idx) => {
              results += `  Row ${idx + 1}:\n`;
              Object.entries(row).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                  results += `    ${key}: ${value}\n`;
                }
              });
              results += `\n`;
            });
          }
        }
      } catch (error) {
        // Skip tables that can't be queried (e.g., system tables)
        continue;
      }
    }

    return results;
  } catch (error) {
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED';
    if (!isConnectionError) {
      console.error('Error searching database data:', error.message);
    }
    return '';
  }
}

/**
 * Get database summary - overview of tables and their row counts
 * @returns {Promise<string>} - Summary of database contents
 */
export async function getDatabaseSummary() {
  try {
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      return 'Database is empty (no tables found).';
    }

    let summary = `DATABASE SUMMARY:\n`;
    summary += `Total tables: ${tablesResult.rows.length}\n\n`;

    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      try {
        const countResult = await queryWithRetry(`SELECT COUNT(*) as count FROM "${tableName}"`);
        const rowCount = countResult.rows[0].count;
        summary += `${tableName}: ${rowCount} rows\n`;
      } catch (e) {
        summary += `${tableName}: (unable to count rows)\n`;
      }
    }

    return summary;
  } catch (error) {
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED';
    if (!isConnectionError) {
      console.error('Error getting database summary:', error.message);
    }
    return 'Unable to retrieve database summary at this time.';
  }
}

/**
 * Get detailed statistics for sales database
 * @returns {Promise<string>} - Detailed statistics
 */
export async function getDetailedStatistics() {
  try {
    let stats = `DETAILED STATISTICS:\n\n`;

    // Check if we have sales tables
    const hasCustomers = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers')`);
    const hasOrders = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders')`);
    const hasProducts = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products')`);

    if (hasCustomers.rows[0].exists) {
      const customerCount = await pool.query('SELECT COUNT(*) as count FROM customers');
      stats += `Customers: ${customerCount.rows[0].count}\n`;
    }

    if (hasProducts.rows[0].exists) {
      const productCount = await pool.query('SELECT COUNT(*) as count FROM products');
      stats += `Products: ${productCount.rows[0].count}\n`;
    }

    if (hasOrders.rows[0].exists) {
      const orderCount = await pool.query('SELECT COUNT(*) as count FROM orders');
      const revenue = await pool.query('SELECT SUM(total_amount) as total FROM orders');
      const avgOrder = await pool.query('SELECT AVG(total_amount) as avg FROM orders');
      
      stats += `Orders: ${orderCount.rows[0].count}\n`;
      if (revenue.rows[0].total) {
        stats += `Total Revenue: $${parseFloat(revenue.rows[0].total).toFixed(2)}\n`;
        stats += `Average Order Value: $${parseFloat(avgOrder.rows[0].avg).toFixed(2)}\n`;
      }
    }

    return stats;
  } catch (error) {
    console.error('Error getting detailed statistics:', error);
    return '';
  }
}

/**
 * Get sample data from all tables
 * @param {number} limit - Number of rows per table (default: 3)
 * @returns {Promise<string>} - Formatted sample data
 */
export async function getSampleData(limit = 3) {
  try {
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      return 'No tables found.';
    }

    let sampleData = `Sample Data from Database:\n\n`;

    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      try {
        const dataResult = await queryWithRetry(
          `SELECT * FROM "${tableName}" LIMIT $1`,
          [limit]
        );

        if (dataResult.rows.length > 0) {
          sampleData += `Table: ${tableName}\n`;
          dataResult.rows.forEach((row, idx) => {
            sampleData += `  Sample ${idx + 1}:\n`;
            Object.entries(row).forEach(([key, value]) => {
              if (value !== null && value !== undefined) {
                const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                sampleData += `    ${key}: ${valStr.substring(0, 100)}${valStr.length > 100 ? '...' : ''}\n`;
              }
            });
            sampleData += `\n`;
          });
        }
      } catch (e) {
        // Skip tables that can't be queried
        continue;
      }
    }

    return sampleData;
  } catch (error) {
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED';
    if (!isConnectionError) {
      console.error('Error getting sample data:', error.message);
    }
    return 'Unable to retrieve sample data at this time.';
  }
}

