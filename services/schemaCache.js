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
      console.log('[Schema Cache] No tables found in database');
      return { tables: [], totalTables: 0, cachedAt: new Date().toISOString() };
    }

    const schema = {
      totalTables: tablesResult.rows.length,
      tables: [],
      cachedAt: new Date().toISOString(),
      database: process.env.DB_NAME || 'unknown'
    };

    // Get detailed information for each table
    // Process ALL tables to ensure LLM has complete schema knowledge
    // This is critical - the LLM needs to know about ALL tables to answer questions accurately
    // OPTIMIZATION: Using parallel queries and pg_stat for row counts to improve performance
    const tablesToProcess = tablesResult.rows;
    console.log(`[Schema Cache] Processing ALL ${tablesToProcess.length} tables to ensure complete schema coverage`);
    console.log(`[Schema Cache] This ensures the LLM has knowledge of every table in the database`);
    
    if (tablesToProcess.length > 100) {
      console.log(`[Schema Cache] ⚠️  Large database detected (${tablesToProcess.length} tables). Using optimized queries for speed.`);
    }

    // OPTIMIZATION: Get approximate row counts from pg_stat_user_tables (much faster than COUNT(*))
    // This is an estimate but accurate enough for schema purposes
    let rowCountMap = {};
    try {
      const statsResult = await queryWithRetry(`
        SELECT 
          schemaname,
          relname as table_name,
          n_live_tup as row_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
      `, [], 1);
      
      statsResult.rows.forEach(row => {
        rowCountMap[row.table_name] = parseInt(row.row_count) || 0;
      });
      console.log(`[Schema Cache] ✓ Loaded approximate row counts for ${Object.keys(rowCountMap).length} tables (fast method)`);
    } catch (statsError) {
      console.log(`[Schema Cache] Could not get row counts from pg_stat (will skip):`, statsError.message);
    }
    
    for (let i = 0; i < tablesToProcess.length; i++) {
      const table = tablesToProcess[i];
      const tableName = table.table_name;
      
      // Log progress every 10 tables
      if (i % 10 === 0 && i > 0) {
        console.log(`[Schema Cache] Processed ${i}/${tablesToProcess.length} tables...`);
      }
      
      try {
        // OPTIMIZATION: Run independent queries in parallel using Promise.all
        const [columnsResult, indexesResult, constraintsResult, foreignKeysResult, primaryKeyResult] = await Promise.all([
          // Get columns
          queryWithRetry(`
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
          `, [tableName], 1).catch(() => ({ rows: [] })),
          
          // Get indexes
          queryWithRetry(`
            SELECT 
              indexname,
              indexdef
            FROM pg_indexes
            WHERE tablename = $1
              AND schemaname = 'public'
          `, [tableName], 1).catch(() => ({ rows: [] })),
          
          // Get constraints
          queryWithRetry(`
            SELECT
              constraint_name,
              constraint_type
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
              AND table_name = $1
          `, [tableName], 1).catch(() => ({ rows: [] })),
          
          // Get foreign keys (relationships)
          queryWithRetry(`
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
          `, [tableName], 1).catch(() => ({ rows: [] })),
          
          // Get primary key columns
          queryWithRetry(`
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
          `, [tableName], 1).catch(() => ({ rows: [] }))
        ]);

        // Use approximate row count from pg_stat (much faster than COUNT(*))
        // Fallback to 0 if not available
        const rowCount = rowCountMap[tableName] || 0;


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

    // Verify all tables were processed
    if (schema.tables.length < schema.totalTables) {
      console.log(`[Schema Cache] ⚠️  Warning: Only processed ${schema.tables.length} out of ${schema.totalTables} tables`);
      console.log(`[Schema Cache] Some tables may have failed to process. Check logs above for errors.`);
    } else {
      console.log(`[Schema Cache] ✓ Successfully processed all ${schema.tables.length} tables`);
      console.log(`[Schema Cache] The LLM will now have complete knowledge of all ${schema.tables.length} tables`);
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
 * Check if cached schema is stale (older than maxAge hours)
 * @param {Object} schema - The cached schema object
 * @param {number} maxAgeHours - Maximum age in hours (default: 1 hour)
 * @returns {boolean} - True if cache is stale
 */
function isCacheStale(schema, maxAgeHours = 1) {
  if (!schema || !schema.cachedAt) {
    return true; // No cache or no timestamp = stale
  }

  try {
    const cachedTime = new Date(schema.cachedAt);
    const now = new Date();
    const ageInHours = (now - cachedTime) / (1000 * 60 * 60);
    
    const isStale = ageInHours > maxAgeHours;
    if (isStale) {
      console.log(`[Schema Cache] Cache is stale: ${ageInHours.toFixed(2)} hours old (max: ${maxAgeHours} hours)`);
    } else {
      console.log(`[Schema Cache] Cache is fresh: ${ageInHours.toFixed(2)} hours old`);
    }
    
    return isStale;
  } catch (error) {
    console.error('[Schema Cache] Error checking cache age:', error.message);
    return true; // If we can't check, assume stale
  }
}

/**
 * Force refresh the schema cache
 * @returns {Promise<Object|null>} - The fresh schema or null if failed
 */
export async function refreshSchema() {
  console.log('[Schema Cache] Force refreshing schema cache...');
  const fresh = await getCompleteSchema();
  if (fresh) {
    await cacheSchema();
    console.log('[Schema Cache] ✓ Schema cache refreshed successfully');
  } else {
    console.log('[Schema Cache] ✗ Failed to refresh schema cache');
  }
  return fresh;
}

/**
 * Get schema (from cache or fetch fresh)
 * Automatically refreshes if cache is stale (older than 1 hour)
 * @param {boolean} useCache - Whether to use cache (default: true)
 * @param {boolean} forceRefresh - Force refresh even if cache is fresh (default: false)
 * @param {number} maxAgeHours - Maximum cache age in hours before auto-refresh (default: 1)
 * @returns {Promise<Object|null>} - The schema object or null
 */
export async function getSchema(useCache = true, forceRefresh = false, maxAgeHours = 1) {
  // If force refresh is requested, skip cache
  if (forceRefresh) {
    console.log('[Schema Cache] Force refresh requested, fetching fresh schema...');
    return await refreshSchema();
  }

  if (useCache) {
    const cached = await loadCachedSchema();
    if (cached) {
      // Check if cache is stale
      if (isCacheStale(cached, maxAgeHours)) {
        console.log('[Schema Cache] Cache is stale, refreshing automatically...');
        // Try to refresh in background, but return cached version immediately
        // This ensures we always have data, even if refresh fails
        refreshSchema().catch(err => {
          console.error('[Schema Cache] Background refresh failed:', err.message);
        });
        // Still return cached version for now, but it will be fresh next time
        return cached;
      }
      // Cache is fresh, return it
      return cached;
    }
  }

  // No cache or cache disabled, fetch fresh
  console.log('[Schema Cache] No valid cache, fetching fresh schema...');
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

