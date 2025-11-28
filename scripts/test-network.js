import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

console.log('========================================');
console.log('Network Connectivity Test');
console.log('========================================\n');

const DB_HOST = process.env.DB_HOST || '47.250.116.135';
const DB_PORT = process.env.DB_PORT || '5432';

console.log(`Testing connectivity to: ${DB_HOST}:${DB_PORT}\n`);

async function testPing() {
  console.log('Test 1: Ping Test');
  console.log('----------------------------------------');
  
  try {
    console.log(`Pinging ${DB_HOST}...`);
    const { stdout, stderr } = await execAsync(`ping -n 4 ${DB_HOST}`);
    console.log(stdout);
    if (stderr) {
      console.log('Stderr:', stderr);
    }
    return true;
  } catch (error) {
    console.log(`✗ Ping failed: ${error.message}`);
    return false;
  }
}

async function testTelnet() {
  console.log('\nTest 2: Port Connectivity Test (Telnet)');
  console.log('----------------------------------------');
  
  try {
    console.log(`Testing connection to ${DB_HOST}:${DB_PORT}...`);
    console.log('Note: This test uses PowerShell Test-NetConnection');
    
    const { stdout, stderr } = await execAsync(
      `powershell -Command "Test-NetConnection -ComputerName ${DB_HOST} -Port ${DB_PORT} -InformationLevel Detailed"`
    );
    
    console.log(stdout);
    
    if (stdout.includes('TcpTestSucceeded : True')) {
      console.log('✓ Port is reachable!');
      return true;
    } else if (stdout.includes('TcpTestSucceeded : False')) {
      console.log('✗ Port is NOT reachable (connection refused or filtered)');
      return false;
    }
    
    return false;
  } catch (error) {
    console.log(`✗ Port test failed: ${error.message}`);
    console.log('\nTrying alternative method...');
    
    // Alternative: Try with timeout
    try {
      const { stdout } = await execAsync(
        `powershell -Command "$result = Test-NetConnection -ComputerName ${DB_HOST} -Port ${DB_PORT} -WarningAction SilentlyContinue; Write-Output \"TcpTestSucceeded: $($result.TcpTestSucceeded)\""`
      );
      console.log(stdout);
      
      if (stdout.includes('True')) {
        return true;
      }
    } catch (e) {
      console.log('Alternative test also failed');
    }
    
    return false;
  }
}

async function testDNS() {
  console.log('\nTest 3: DNS Resolution Test');
  console.log('----------------------------------------');
  
  try {
    console.log(`Resolving ${DB_HOST}...`);
    const { stdout } = await execAsync(`nslookup ${DB_HOST}`);
    console.log(stdout);
    return true;
  } catch (error) {
    console.log(`✗ DNS resolution failed: ${error.message}`);
    return false;
  }
}

async function runTests() {
  const results = {
    ping: false,
    port: false,
    dns: false
  };
  
  results.dns = await testDNS();
  results.ping = await testPing();
  results.port = await testTelnet();
  
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`DNS Resolution:    ${results.dns ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Ping Test:          ${results.ping ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Port Connectivity:  ${results.port ? '✓ PASS' : '✗ FAIL'}`);
  console.log('========================================\n');
  
  if (!results.port) {
    console.log('⚠️  Port 5432 is not reachable. This explains the connection timeout.');
    console.log('\nPossible solutions:');
    console.log('  1. Check if the database server is running');
    console.log('  2. Verify the IP address and port are correct');
    console.log('  3. Check firewall rules (both local and server-side)');
    console.log('  4. If using a VPN, ensure it\'s connected');
    console.log('  5. Contact your database administrator to verify:');
    console.log('     - Server is accessible from your network');
    console.log('     - Port 5432 is open');
    console.log('     - Your IP is whitelisted (if required)\n');
  } else if (results.port && !results.ping) {
    console.log('⚠️  Port is reachable but ping failed. This might be normal if ICMP is disabled.');
    console.log('   The database connection should work despite ping failure.\n');
  } else {
    console.log('✓ Network connectivity looks good!');
    console.log('   The issue might be with PostgreSQL authentication or configuration.\n');
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});









