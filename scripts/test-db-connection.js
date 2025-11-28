import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

console.log('========================================');
console.log('Database Connection Test Script');
console.log('========================================\n');

// Display configuration
console.log('Configuration:');
console.log('  Host:', process.env.DB_HOST);
console.log('  Port:', process.env.DB_PORT);
console.log('  Database:', process.env.DB_NAME);
console.log('  User:', process.env.DB_USER);
console.log('  Password:', process.env.DB_PASSWORD ? '***' : 'NOT SET');
console.log('');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

let client = null;

async function testConnection() {
  console.log('Test 1: Basic Connection Test');
  console.log('----------------------------------------');
  
  try {
    console.log('Attempting to connect...');
    const startTime = Date.now();
    
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
      )
    ]);
    
    const connectTime = Date.now() - startTime;
    console.log(`✓ Connection successful! (took ${connectTime}ms)`);
    return true;
  } catch (error) {
    console.log(`✗ Connection failed: ${error.message}`);
    console.log(`  Error code: ${error.code}`);
    console.log(`  Error errno: ${error.errno}`);
    return false;
  }
}

async function testSimpleQuery() {
  console.log('\nTest 2: Simple Query Test');
  console.log('----------------------------------------');
  
  if (!client) {
    console.log('✗ No client available, skipping test');
    return false;
  }
  
  try {
    console.log('Executing: SELECT NOW()');
    const startTime = Date.now();
    const result = await client.query('SELECT NOW() as current_time');
    const queryTime = Date.now() - startTime;
    
    console.log(`✓ Query successful! (took ${queryTime}ms)`);
    console.log(`  Result: ${result.rows[0].current_time}`);
    return true;
  } catch (error) {
    console.log(`✗ Query failed: ${error.message}`);
    return false;
  }
}

async function testDatabaseInfo() {
  console.log('\nTest 3: Database Information');
  console.log('----------------------------------------');
  
  if (!client) {
    console.log('✗ No client available, skipping test');
    return false;
  }
  
  try {
    // Get database size
    console.log('Getting database size...');
    const sizeResult = await client.query(`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        pg_database_size(current_database()) as size_bytes
    `);
    console.log(`  Database size: ${sizeResult.rows[0].database_size}`);
    console.log(`  Size in bytes: ${sizeResult.rows[0].size_bytes}`);
    
    // Get table count
    console.log('\nGetting table count...');
    const tableResult = await client.query(`
      SELECT COUNT(*) as table_count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
    `);
    console.log(`  Total tables: ${tableResult.rows[0].table_count}`);
    
    // Get total row count across all tables
    console.log('\nGetting total row count (this may take a while for large databases)...');
    const startTime = Date.now();
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
      LIMIT 10
    `);
    
    let totalRows = 0;
    let tablesChecked = 0;
    
    for (const table of tablesResult.rows) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) as count FROM "${table.table_name}"`);
        const rowCount = parseInt(countResult.rows[0].count);
        totalRows += rowCount;
        tablesChecked++;
        console.log(`  ${table.table_name}: ${rowCount.toLocaleString()} rows`);
      } catch (e) {
        console.log(`  ${table.table_name}: Error counting rows`);
      }
    }
    
    const countTime = Date.now() - startTime;
    console.log(`\n  Total rows in first ${tablesChecked} tables: ${totalRows.toLocaleString()}`);
    console.log(`  Counting took: ${countTime}ms`);
    
    // Get connection info
    console.log('\nGetting connection information...');
    const connResult = await client.query(`
      SELECT 
        current_database() as database,
        current_user as user,
        version() as postgres_version,
        inet_server_addr() as server_address,
        inet_server_port() as server_port
    `);
    console.log(`  Database: ${connResult.rows[0].database}`);
    console.log(`  User: ${connResult.rows[0].user}`);
    console.log(`  Server: ${connResult.rows[0].server_address || 'N/A'}:${connResult.rows[0].server_port || 'N/A'}`);
    console.log(`  PostgreSQL Version: ${connResult.rows[0].postgres_version.split('\n')[0]}`);
    
    return true;
  } catch (error) {
    console.log(`✗ Failed to get database info: ${error.message}`);
    return false;
  }
}

async function testTableList() {
  console.log('\nTest 4: List All Tables');
  console.log('----------------------------------------');
  
  if (!client) {
    console.log('✗ No client available, skipping test');
    return false;
  }
  
  try {
    console.log('Getting list of all tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`✓ Found ${result.rows.length} tables:`);
    result.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.table_name}`);
    });
    
    return true;
  } catch (error) {
    console.log(`✗ Failed to list tables: ${error.message}`);
    return false;
  }
}

async function runTests() {
  const results = {
    connection: false,
    simpleQuery: false,
    dbInfo: false,
    tableList: false
  };
  
  try {
    // Test 1: Connection
    results.connection = await testConnection();
    
    if (!results.connection) {
      console.log('\n========================================');
      console.log('Connection failed. Cannot proceed with other tests.');
      console.log('Possible issues:');
      console.log('  1. Database server is down or unreachable');
      console.log('  2. Network connectivity issues');
      console.log('  3. Firewall blocking connection');
      console.log('  4. Wrong host/port/database name');
      console.log('  5. Database credentials are incorrect');
      console.log('========================================');
      process.exit(1);
    }
    
    // Test 2: Simple Query
    results.simpleQuery = await testSimpleQuery();
    
    // Test 3: Database Info
    results.dbInfo = await testDatabaseInfo();
    
    // Test 4: Table List
    results.tableList = await testTableList();
    
    console.log('\n========================================');
    console.log('Test Summary');
    console.log('========================================');
    console.log(`Connection:        ${results.connection ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`Simple Query:     ${results.simpleQuery ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`Database Info:     ${results.dbInfo ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`Table List:        ${results.tableList ? '✓ PASS' : '✗ FAIL'}`);
    console.log('========================================\n');
    
    if (results.connection && results.simpleQuery) {
      console.log('✓ Database connection is working!');
      console.log('  The issue might be with the application startup timing.');
      console.log('  Try restarting the server or check network stability.\n');
    }
    
  } catch (error) {
    console.error('\n========================================');
    console.error('Unexpected Error:');
    console.error('========================================');
    console.error(error);
    console.error('========================================\n');
  } finally {
    if (client) {
      client.release();
      console.log('Connection released.');
    }
    await pool.end();
    console.log('Pool closed.');
    process.exit(0);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});









