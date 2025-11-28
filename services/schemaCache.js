import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';
import { queryWithRetry } from '../utils/dbRetry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CACHE_DIR = join(__dirname, '..', '.cache');
const SCHEMA_CACHE_FILE = join(CACHE_DIR, 'database-schema.json');

/**
 * Get complete database schema information
 */
async function getCompleteSchema() {
  try {
    console.log('[Schema Cache] Fetching database schema...');
    
    // Get all tables
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      return { tables: [], totalTables: 0, cachedAt: new Date().toISOString() };
    }

    const schema = {
      totalTables: tablesResult.rows.length,
      tables: [],
      cachedAt: new Date().toISOString(),
      database: process.env.DB_NAME || 'unknown'
    };

    // Get detailed information for each table
    // Limit to first 50 tables to avoid too many queries
    const tablesToProcess = tablesResult.rows.slice(0, 50);
    console.log(`[Schema Cache] Processing ${tablesToProcess.length} tables (limited to 50 for performance)`);
    
    for (let i = 0; i < tablesToProcess.length; i++) {
      const table = tablesToProcess[i];
      const tableName = table.table_name;
      
      // Log progress every 10 tables
      if (i % 10 === 0 && i > 0) {
        console.log(`[Schema Cache] Processed ${i}/${tablesToProcess.length} tables...`);
      }
      
      try {
        // Get columns
        const columnsResult = await queryWithRetry(`
          SELECT 
            column_name,
            data_type,
            character_maximum_length,
            is_nullable,
            column_default,
            ordinal_position
          FROM information_schema.columns
          WHERE table_schema = 'public' 
            AND table_name = $1
          ORDER BY ordinal_position
        `, [tableName], 1); // Only 1 retry for schema queries

        // Get row count (skip for very large tables to save time)
        let rowCount = 0;
        try {
          const countResult = await queryWithRetry(
            `SELECT COUNT(*) as count FROM "${tableName}"`,
            [],
            1 // Only 1 retry
          );
          rowCount = parseInt(countResult.rows[0].count);
        } catch (countError) {
          // If count fails, skip it (might be a view or permission issue)
          console.log(`[Schema Cache] Could not get row count for ${tableName}:`, countError.message);
        }

        // Get indexes
        let indexesResult = { rows: [] };
        try {
          indexesResult = await queryWithRetry(`
            SELECT 
              indexname,
              indexdef
            FROM pg_indexes
            WHERE tablename = $1
              AND schemaname = 'public'
          `, [tableName], 1); // Only 1 retry
        } catch (indexError) {
          // Skip indexes if query fails
          console.log(`[Schema Cache] Could not get indexes for ${tableName}:`, indexError.message);
        }

        // Get constraints
        let constraintsResult = { rows: [] };
        try {
          constraintsResult = await queryWithRetry(`
            SELECT
              constraint_name,
              constraint_type
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = $1
          `, [tableName], 1); // Only 1 retry
        } catch (constraintError) {
          // Skip constraints if query fails
          console.log(`[Schema Cache] Could not get constraints for ${tableName}:`, constraintError.message);
        }

        // Get foreign keys (relationships)
        let foreignKeysResult = { rows: [] };
        try {
          foreignKeysResult = await queryWithRetry(`
            SELECT
              tc.constraint_name,
              kcu.column_name,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = $1
          `, [tableName], 1); // Only 1 retry
        } catch (fkError) {
          console.log(`[Schema Cache] Could not get foreign keys for ${tableName}:`, fkError.message);
        }

        // Get primary key columns
        let primaryKeyResult = { rows: [] };
        try {
          primaryKeyResult = await queryWithRetry(`
            SELECT
              kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = $1
            ORDER BY kcu.ordinal_position
          `, [tableName], 1);
        } catch (pkError) {
          console.log(`[Schema Cache] Could not get primary key for ${tableName}:`, pkError.message);
        }

        // Check for vector columns
        const vectorColumns = columnsResult.rows.filter(col => 
          col.data_type === 'USER-DEFINED' || 
          col.data_type === 'vector'
        );

        // Mark columns that are primary keys or foreign keys
        const primaryKeyColumns = primaryKeyResult.rows.map(r => r.column_name);
        const foreignKeyMap = {};
        foreignKeysResult.rows.forEach(fk => {
          foreignKeyMap[fk.column_name] = {
            referencesTable: fk.foreign_table_name,
            referencesColumn: fk.foreign_column_name,
            constraintName: fk.constraint_name
          };
        });

        schema.tables.push({
          name: tableName,
          rowCount: rowCount,
          columns: columnsResult.rows.map(col => ({
            name: col.column_name,
            type: col.data_type,
            maxLength: col.character_maximum_length,
            nullable: col.is_nullable === 'YES',
            default: col.column_default,
            position: col.ordinal_position,
            isVector: col.data_type === 'USER-DEFINED' || col.data_type === 'vector',
            isPrimaryKey: primaryKeyColumns.includes(col.column_name),
            isForeignKey: foreignKeyMap[col.column_name] ? true : false,
            foreignKey: foreignKeyMap[col.column_name] || null
          })),
          indexes: indexesResult.rows.map(idx => ({
            name: idx.indexname,
            definition: idx.indexdef
          })),
          constraints: constraintsResult.rows.map(con => ({
            name: con.constraint_name,
            type: con.constraint_type
          })),
          foreignKeys: foreignKeysResult.rows.map(fk => ({
            column: fk.column_name,
            referencesTable: fk.foreign_table_name,
            referencesColumn: fk.foreign_column_name,
            constraintName: fk.constraint_name
          })),
          primaryKey: primaryKeyColumns,
          hasVectorColumns: vectorColumns.length > 0,
          vectorColumnCount: vectorColumns.length
        });

        console.log(`[Schema Cache] Processed table: ${tableName} (${rowCount} rows, ${columnsResult.rows.length} columns)`);
      } catch (error) {
        console.log(`[Schema Cache] Error processing table ${tableName}:`, error.message);
        // Add table with minimal info
        schema.tables.push({
          name: tableName,
          rowCount: 0,
          columns: [],
          indexes: [],
          constraints: [],
          hasVectorColumns: false,
          error: error.message
        });
      }
    }

    // Get pgvector extension info
    try {
      const vectorExtResult = await queryWithRetry(`
        SELECT * FROM pg_extension WHERE extname = 'vector'
      `);
      
      schema.pgvector = {
        installed: vectorExtResult.rows.length > 0,
        version: vectorExtResult.rows[0]?.extversion || null
      };
    } catch (error) {
      schema.pgvector = {
        installed: false,
        error: error.message
      };
    }

    // Get database statistics
    try {
      const statsResult = await queryWithRetry(`
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) as size,
          pg_database_size(current_database()) as size_bytes
      `);
      schema.databaseSize = statsResult.rows[0].size;
      schema.databaseSizeBytes = parseInt(statsResult.rows[0].size_bytes);
    } catch (error) {
      console.log('[Schema Cache] Could not get database size:', error.message);
    }

    return schema;
  } catch (error) {
    console.error('[Schema Cache] Error fetching schema:', error.message);
    return null;
  }
}

/**
 * Save schema to JSON cache file
 */
export async function cacheSchema() {
  try {
    // Create cache directory if it doesn't exist
    if (!existsSync(CACHE_DIR)) {
      await mkdir(CACHE_DIR, { recursive: true });
      console.log(`[Schema Cache] Created cache directory: ${CACHE_DIR}`);
    }

    const schema = await getCompleteSchema();
    
    if (!schema) {
      console.log('[Schema Cache] No schema to cache');
      return false;
    }

    // Write to JSON file with pretty formatting
    await writeFile(
      SCHEMA_CACHE_FILE,
      JSON.stringify(schema, null, 2),
      'utf8'
    );

    console.log(`[Schema Cache] ✓ Schema cached successfully:`);
    console.log(`[Schema Cache]   - Total tables: ${schema.totalTables}`);
    console.log(`[Schema Cache]   - File: ${SCHEMA_CACHE_FILE}`);
    console.log(`[Schema Cache]   - pgvector installed: ${schema.pgvector?.installed || false}`);
    
    return true;
  } catch (error) {
    console.error('[Schema Cache] Error caching schema:', error.message);
    return false;
  }
}

/**
 * Load schema from cache
 */
export async function loadCachedSchema() {
  try {
    if (!existsSync(SCHEMA_CACHE_FILE)) {
      console.log('[Schema Cache] No cached schema found');
      return null;
    }

    const cachedData = await readFile(SCHEMA_CACHE_FILE, 'utf8');
    const schema = JSON.parse(cachedData);
    
    console.log(`[Schema Cache] ✓ Loaded cached schema from ${SCHEMA_CACHE_FILE}`);
    console.log(`[Schema Cache]   - Cached at: ${schema.cachedAt}`);
    console.log(`[Schema Cache]   - Total tables: ${schema.totalTables}`);
    
    return schema;
  } catch (error) {
    console.error('[Schema Cache] Error loading cached schema:', error.message);
    return null;
  }
}

/**
 * Get schema (from cache or fetch fresh)
 */
export async function getSchema(useCache = true) {
  if (useCache) {
    const cached = await loadCachedSchema();
    if (cached) {
      return cached;
    }
  }

  // If no cache or cache disabled, fetch fresh
  const fresh = await getCompleteSchema();
  if (fresh) {
    // Cache it for next time
    await cacheSchema();
  }
  
  return fresh;
}

/**
 * Build relationship graph from schema
 * Returns a map of table relationships for easy lookup
 */
export function buildRelationshipGraph(schema) {
  if (!schema || !schema.tables) {
    return {};
  }

  const graph = {};
  
  schema.tables.forEach(table => {
    if (!graph[table.name]) {
      graph[table.name] = {
        outgoing: [], // Tables this table references
        incoming: []  // Tables that reference this table
      };
    }

    // Add outgoing relationships (foreign keys)
    if (table.foreignKeys && table.foreignKeys.length > 0) {
      table.foreignKeys.forEach(fk => {
        graph[table.name].outgoing.push({
          column: fk.column,
          referencesTable: fk.referencesTable,
          referencesColumn: fk.referencesColumn
        });

        // Add incoming relationship to referenced table
        if (!graph[fk.referencesTable]) {
          graph[fk.referencesTable] = {
            outgoing: [],
            incoming: []
          };
        }
        graph[fk.referencesTable].incoming.push({
          fromTable: table.name,
          fromColumn: fk.column,
          toColumn: fk.referencesColumn
        });
      });
    }
  });

  return graph;
}

/**
 * Generate comprehensive business context from schema
 * This helps the LLM understand the database structure and relationships
 */
export function generateBusinessContext(schema) {
  if (!schema || !schema.tables || schema.tables.length === 0) {
    return 'Database schema not available.';
  }

  let context = `DATABASE BUSINESS CONTEXT:\n`;
  context += `Total tables: ${schema.totalTables}\n`;
  context += `Database: ${schema.database || 'unknown'}\n\n`;

  // Build relationship graph
  const relationships = buildRelationshipGraph(schema);

  // Group tables by likely business domain (based on naming patterns)
  const domainGroups = {
    orders: [],
    customers: [],
    products: [],
    inventory: [],
    financial: [],
    delivery: [],
    discounts: [],
    other: []
  };

  schema.tables.forEach(table => {
    const name = table.name.toLowerCase();
    if (name.includes('order')) {
      domainGroups.orders.push(table);
    } else if (name.includes('customer') || name.includes('client')) {
      domainGroups.customers.push(table);
    } else if (name.includes('product') || name.includes('item')) {
      domainGroups.products.push(table);
    } else if (name.includes('inventory') || name.includes('stock')) {
      domainGroups.inventory.push(table);
    } else if (name.includes('bank') || name.includes('transfer') || name.includes('payment') || name.includes('credit') || name.includes('debit')) {
      domainGroups.financial.push(table);
    } else if (name.includes('delivery') || name.includes('ship')) {
      domainGroups.delivery.push(table);
    } else if (name.includes('discount') || name.includes('promo')) {
      domainGroups.discounts.push(table);
    } else {
      domainGroups.other.push(table);
    }
  });

  // Add business domain descriptions
  context += `BUSINESS DOMAINS:\n`;
  if (domainGroups.orders.length > 0) {
    context += `- Order Management: ${domainGroups.orders.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.customers.length > 0) {
    context += `- Customer Management: ${domainGroups.customers.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.products.length > 0) {
    context += `- Product Catalog: ${domainGroups.products.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.inventory.length > 0) {
    context += `- Inventory: ${domainGroups.inventory.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.financial.length > 0) {
    context += `- Financial Transactions: ${domainGroups.financial.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.delivery.length > 0) {
    context += `- Delivery/Shipping: ${domainGroups.delivery.map(t => t.name).join(', ')}\n`;
  }
  if (domainGroups.discounts.length > 0) {
    context += `- Promotions/Discounts: ${domainGroups.discounts.map(t => t.name).join(', ')}\n`;
  }
  context += `\n`;

  // Add detailed table information with relationships
  context += `DETAILED TABLE SCHEMA WITH RELATIONSHIPS:\n\n`;
  schema.tables.forEach(table => {
    context += `Table: ${table.name} (${table.rowCount} rows)\n`;
    
    // Primary key
    if (table.primaryKey && table.primaryKey.length > 0) {
      context += `  Primary Key: ${table.primaryKey.join(', ')}\n`;
    }

    // Columns with key indicators
    context += `  Columns:\n`;
    table.columns.forEach(col => {
      let colDesc = `    - ${col.name} (${col.type}`;
      if (col.isPrimaryKey) colDesc += ', PRIMARY KEY';
      if (col.isForeignKey) {
        colDesc += `, FOREIGN KEY -> ${col.foreignKey.referencesTable}.${col.foreignKey.referencesColumn}`;
      }
      if (!col.nullable) colDesc += ', NOT NULL';
      colDesc += ')';
      context += colDesc + '\n';
    });

    // Foreign key relationships
    if (table.foreignKeys && table.foreignKeys.length > 0) {
      context += `  Relationships:\n`;
      table.foreignKeys.forEach(fk => {
        context += `    - ${fk.column} -> ${fk.referencesTable}.${fk.referencesColumn}\n`;
      });
    }

    // Reverse relationships (tables that reference this one)
    if (relationships[table.name] && relationships[table.name].incoming.length > 0) {
      context += `  Referenced by:\n`;
      relationships[table.name].incoming.forEach(rel => {
        context += `    - ${rel.fromTable}.${rel.fromColumn} -> ${table.name}.${rel.toColumn}\n`;
      });
    }

    context += `\n`;
  });

  return context;
}

export { SCHEMA_CACHE_FILE };

