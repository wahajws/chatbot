import pkg from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
import net from 'net';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const execAsync = promisify(exec);
const { lookup } = dns.promises;

console.log('========================================');
console.log('Comprehensive Database Connection Diagnostic');
console.log('========================================\n');

const DB_HOST = process.env.DB_HOST || '47.250.116.135';
const DB_PORT = parseInt(process.env.DB_PORT) || 5432;
const DB_NAME = process.env.DB_NAME || 'nv_ams';
const DB_USER = process.env.DB_USER || 'dev_chatbot';

// Test 1: Environment Variables
console.log('Test 1: Environment Variables Check');
console.log('----------------------------------------');
console.log('  DB_HOST:', DB_HOST);
console.log('  DB_PORT:', DB_PORT);
console.log('  DB_NAME:', DB_NAME);
console.log('  DB_USER:', DB_USER);
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? '***SET***' : 'NOT SET');
console.log('  Connection String:', `postgresql://${DB_USER}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
console.log('');

// Test 2: DNS Resolution
console.log('Test 2: DNS Resolution');
console.log('----------------------------------------');
try {
  const addresses = await lookup(DB_HOST);
  console.log('  Hostname:', DB_HOST);
  console.log('  Resolved IP:', addresses.address);
  console.log('  Family:', addresses.family === 4 ? 'IPv4' : 'IPv6');
  console.log('  ✓ DNS resolution successful');
} catch (error) {
  console.log('  ✗ DNS resolution failed:', error.message);
  console.log('  This might be an IP address (normal)');
}
console.log('');

// Test 3: Network Interface Information
console.log('Test 3: Network Interface Information');
console.log('----------------------------------------');
try {
  const { stdout } = await execAsync('ipconfig');
  const lines = stdout.split('\n');
  let inAdapter = false;
  let adapterName = '';
  
  lines.forEach(line => {
    if (line.includes('adapter') || line.includes('Adapter')) {
      inAdapter = true;
      adapterName = line.trim();
    }
    if (inAdapter && (line.includes('IPv4') || line.includes('IP Address'))) {
      console.log(`  ${adapterName}`);
      console.log(`    ${line.trim()}`);
    }
    if (line.trim() === '') {
      inAdapter = false;
    }
  });
} catch (error) {
  console.log('  Could not get network info:', error.message);
}
console.log('');

// Test 4: Port Connectivity (Raw Socket Test)
console.log('Test 4: Raw Socket Connection Test');
console.log('----------------------------------------');
console.log(`  Testing connection to ${DB_HOST}:${DB_PORT}...`);

const socketTest = () => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 5000; // 5 seconds
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      console.log('  ✓ Socket connection successful!');
      console.log('  ✓ Port is open and accepting connections');
      socket.destroy();
      resolve({ success: true, message: 'Port is open' });
    });
    
    socket.on('timeout', () => {
      console.log('  ✗ Connection timeout (port may be filtered/blocked)');
      socket.destroy();
      resolve({ success: false, message: 'Timeout' });
    });
    
    socket.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        console.log('  ✗ Connection refused (port is closed or service not running)');
        resolve({ success: false, message: 'Connection refused' });
      } else if (error.code === 'EHOSTUNREACH') {
        console.log('  ✗ Host unreachable (network routing issue)');
        resolve({ success: false, message: 'Host unreachable' });
      } else if (error.code === 'ETIMEDOUT') {
        console.log('  ✗ Connection timeout (firewall blocking or network issue)');
        resolve({ success: false, message: 'Timeout' });
      } else {
        console.log(`  ✗ Connection error: ${error.code} - ${error.message}`);
        resolve({ success: false, message: error.message });
      }
      socket.destroy();
    });
    
    socket.connect(DB_PORT, DB_HOST);
  });
};

const socketResult = await socketTest();
console.log('');

// Test 5: PostgreSQL Connection Pool Test
console.log('Test 5: PostgreSQL Connection Pool Test');
console.log('----------------------------------------');
const testPool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

let poolClient = null;
let poolSuccess = false;

try {
  console.log('  Attempting connection with 10 second timeout...');
  const startTime = Date.now();
  
  poolClient = await Promise.race([
    testPool.connect(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Pool connection timeout')), 10000)
    )
  ]);
  
  const connectTime = Date.now() - startTime;
  console.log(`  ✓ PostgreSQL connection successful! (${connectTime}ms)`);
  poolSuccess = true;
  
  // Test a simple query
  try {
    const queryResult = await poolClient.query('SELECT version(), current_database(), current_user');
    console.log('  ✓ Query test successful');
    console.log('  Database:', queryResult.rows[0].current_database);
    console.log('  User:', queryResult.rows[0].current_user);
    console.log('  PostgreSQL Version:', queryResult.rows[0].version.split('\n')[0]);
  } catch (queryError) {
    console.log('  ✗ Query failed:', queryError.message);
  }
  
} catch (error) {
  console.log(`  ✗ PostgreSQL connection failed: ${error.message}`);
  if (error.code) {
    console.log(`  Error code: ${error.code}`);
  }
  if (error.errno) {
    console.log(`  Error number: ${error.errno}`);
  }
}

if (poolClient) {
  poolClient.release();
}
await testPool.end();
console.log('');

// Test 6: Firewall and Routing
console.log('Test 6: Network Routing and Firewall');
console.log('----------------------------------------');
try {
  console.log('  Checking routing to database server...');
  const { stdout } = await execAsync(`tracert -h 10 ${DB_HOST}`);
  console.log('  Routing path:');
  const lines = stdout.split('\n').slice(3, 13); // Get first 10 hops
  lines.forEach(line => {
    if (line.trim()) {
      console.log(`    ${line.trim()}`);
    }
  });
} catch (error) {
  console.log('  Could not trace route:', error.message);
  console.log('  (This is normal if tracert is blocked or unavailable)');
}
console.log('');

// Test 7: Alternative Ports Test
console.log('Test 7: Common PostgreSQL Ports Test');
console.log('----------------------------------------');
const commonPorts = [5432, 5433, 5434, 15432];
for (const port of commonPorts) {
  const testSocket = () => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.connect(port, DB_HOST);
    });
  };
  
  const isOpen = await testSocket();
  if (isOpen) {
    console.log(`  ✓ Port ${port} is open`);
  } else {
    console.log(`  ✗ Port ${port} is closed/filtered`);
  }
}
console.log('');

// Test 8: System Information
console.log('Test 8: System Information');
console.log('----------------------------------------');
try {
  const { stdout: osInfo } = await execAsync('systeminfo | findstr /B /C:"OS Name" /C:"OS Version"');
  console.log('  Operating System:');
  osInfo.split('\n').forEach(line => {
    if (line.trim()) {
      console.log(`    ${line.trim()}`);
    }
  });
} catch (error) {
  console.log('  Could not get OS info');
}

try {
  const { stdout: nodeVersion } = await execAsync('node --version');
  console.log('  Node.js Version:', nodeVersion.trim());
} catch (error) {
  console.log('  Could not get Node.js version');
}

try {
  const { stdout: pgVersion } = await execAsync('npm list pg');
  const versionLine = pgVersion.split('\n').find(line => line.includes('pg@'));
  if (versionLine) {
    console.log('  PostgreSQL Client:', versionLine.trim());
  }
} catch (error) {
  console.log('  Could not get pg version');
}
console.log('');

// Summary
console.log('========================================');
console.log('Diagnostic Summary');
console.log('========================================');
console.log(`Socket Test:        ${socketResult.success ? '✓ PASS' : '✗ FAIL'} (${socketResult.message})`);
console.log(`PostgreSQL Pool:    ${poolSuccess ? '✓ PASS' : '✗ FAIL'}`);
console.log('========================================\n');

if (!socketResult.success && !poolSuccess) {
  console.log('⚠️  DIAGNOSIS: Network connectivity issue');
  console.log('\nThe database server is not reachable from your network.');
  console.log('\nPossible causes:');
  console.log('  1. Database server is down or not running');
  console.log('  2. Firewall is blocking port 5432');
  console.log('  3. Network routing issue (server on different network/VPN required)');
  console.log('  4. IP address or port is incorrect');
  console.log('  5. Your IP address is not whitelisted on the database server');
  console.log('\nRecommended actions:');
  console.log('  1. Verify database server is running: Contact your DBA');
  console.log('  2. Check if VPN is required: Connect to company VPN');
  console.log('  3. Verify firewall rules: Check Windows Firewall and network firewall');
  console.log('  4. Test from another machine: Verify if issue is network-specific');
  console.log('  5. Contact network administrator: They can check routing and firewall rules');
  console.log('\nNote: The application is configured to start even if database is unavailable.');
  console.log('      It will automatically retry connections when the database becomes available.\n');
} else if (socketResult.success && !poolSuccess) {
  console.log('⚠️  DIAGNOSIS: Port is open but PostgreSQL connection fails');
  console.log('\nThe port is reachable but PostgreSQL is rejecting the connection.');
  console.log('\nPossible causes:');
  console.log('  1. Wrong database name, username, or password');
  console.log('  2. PostgreSQL is not running on that port');
  console.log('  3. PostgreSQL authentication configuration issue');
  console.log('  4. Database/user does not exist');
  console.log('\nRecommended actions:');
  console.log('  1. Verify credentials are correct');
  console.log('  2. Check PostgreSQL is running: Contact your DBA');
  console.log('  3. Verify database and user exist');
  console.log('  4. Check pg_hba.conf configuration on server\n');
} else {
  console.log('✓ DIAGNOSIS: Connection successful!');
  console.log('\nThe database connection is working properly.\n');
}

process.exit(0);

