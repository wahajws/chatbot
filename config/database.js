import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('Please create a .env file with the required database configuration.');
  process.exit(1);
}

// Ensure password is a string (handle undefined/null cases)
const dbPassword = String(process.env.DB_PASSWORD || '');

if (!dbPassword) {
  console.error('DB_PASSWORD is empty or not set');
  process.exit(1);
}

// Optimized connection pool configuration
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: dbPassword,
  ssl: false, // Set to true if your database requires SSL
  max: 10, // Reduced from 20 to prevent connection exhaustion
  min: 2, // Maintain minimum connections for faster response
  idleTimeoutMillis: 60000, // Increased to 60 seconds - keep connections alive longer
  connectionTimeoutMillis: 20000, // Reduced to 20 seconds - fail faster if unreachable
  allowExitOnIdle: false, // Don't exit process when pool is idle
  keepAlive: true, // Keep connections alive
  keepAliveInitialDelayMillis: 10000, // Start keepalive after 10 seconds
  // Connection retry settings
  statement_timeout: 30000, // 30 second query timeout
  query_timeout: 30000, // 30 second query timeout
  // Application name for monitoring
  application_name: 'chatbot-api',
});

// Test database connection
pool.on('connect', (client) => {
  console.log('[DB Pool] New client connected to database');
});

pool.on('error', (err) => {
  // Don't exit on connection errors - handle gracefully
  console.error('[DB Pool] Pool error:', {
    message: err.message,
    code: err.code,
    errno: err.errno,
    address: err.address,
    port: err.port
  });
  // Only exit on critical errors, not connection timeouts
  if (err.code !== 'ETIMEDOUT' && err.code !== 'EHOSTUNREACH' && err.code !== 'ECONNREFUSED') {
    console.error('[DB Pool] Critical database error, exiting:', err);
    process.exit(-1);
  } else {
    console.log('[DB Pool] Connection error (non-critical), will retry on next query');
  }
});

// Connection health check
let isDatabaseHealthy = false;
let lastHealthCheck = null;
const HEALTH_CHECK_INTERVAL = 30000; // Check every 30 seconds

async function checkDatabaseHealth() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    isDatabaseHealthy = true;
    lastHealthCheck = Date.now();
    return true;
  } catch (error) {
    isDatabaseHealthy = false;
    lastHealthCheck = Date.now();
    return false;
  }
}

// Periodic health check (non-blocking)
setInterval(async () => {
  if (!isDatabaseHealthy) {
    console.log('[DB Health] Checking database connectivity...');
    const healthy = await checkDatabaseHealth();
    if (healthy) {
      console.log('[DB Health] ✓ Database is now reachable!');
    }
  }
}, HEALTH_CHECK_INTERVAL);

// Initialize pgvector extension with optimized retry logic
export async function initializeDatabase() {
  console.log('[DB Init] Starting database initialization...');
  let client = null;
  const maxRetries = 3;
  let retryDelay = 1000; // Start with 1 second
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DB Init] Connection attempt ${attempt}/${maxRetries}...`);
      
      // Optimized connection with shorter timeout for faster failure detection
      const connectPromise = pool.connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
      );
      
      const startTime = Date.now();
      client = await Promise.race([connectPromise, timeoutPromise]);
      const connectTime = Date.now() - startTime;
      
      console.log(`[DB Init] ✓ Database connection successful! (${connectTime}ms)`);
      
      // Quick health check
      try {
        await client.query('SELECT 1');
        console.log('[DB Init] ✓ Database health check passed');
      } catch (healthError) {
        console.log('[DB Init] ⚠ Health check failed, but connection established');
      }
      
      isDatabaseHealthy = true;
      lastHealthCheck = Date.now();
      break;
      
    } catch (error) {
      const errorInfo = {
        message: error.message,
        code: error.code,
        errno: error.errno
      };
      
      console.log(`[DB Init] ✗ Connection attempt ${attempt} failed:`, errorInfo);
      
      // Categorize error for better handling
      const isNetworkError = error.code === 'ETIMEDOUT' || 
                           error.code === 'EHOSTUNREACH' || 
                           error.code === 'ECONNREFUSED' ||
                           error.message?.includes('timeout');
      
      if (attempt === maxRetries) {
        if (isNetworkError) {
          console.error('[DB Init] ⚠ Network connectivity issue detected.');
          console.error('[DB Init]    Server will start, but database operations will fail until connectivity is restored.');
          console.error('[DB Init]    The application will automatically retry when database becomes available.');
        } else {
          console.error('[DB Init] ✗ All connection attempts failed due to:', error.message);
        }
        isDatabaseHealthy = false;
        return false;
      }
      
      // Exponential backoff with jitter
      const jitter = Math.random() * 500; // Add random 0-500ms
      const delay = retryDelay + jitter;
      console.log(`[DB Init] Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      retryDelay = Math.min(retryDelay * 2, 8000); // Cap at 8 seconds
    }
  }
  
  if (!client) {
    console.error('[DB Init] ✗ Failed to get database client after all retries');
    isDatabaseHealthy = false;
    return false;
  }
  
  try {
    // Check if pgvector extension exists
    const extensionCheck = await client.query(
      "SELECT * FROM pg_extension WHERE extname = 'vector'"
    );
    
    if (extensionCheck.rows.length === 0) {
      console.log('pgvector extension not found. Please install it first.');
    } else {
      console.log('pgvector extension is available');
    }
    
    // Create messages table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        response TEXT,
        message_embedding vector(1536),
        response_embedding vector(1536),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create knowledge_base table for storing information that can be queried
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255),
        content TEXT NOT NULL,
        content_embedding vector(1536),
        category VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create vector indexes for similarity search (using HNSW for better performance)
    try {
      // Index for knowledge_base content embeddings
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_embedding 
        ON knowledge_base 
        USING hnsw (content_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `).catch((err) => {
        // If HNSW fails, try IVFFlat
        console.log('HNSW index creation failed, trying IVFFlat...', err.message);
        return client.query(`
          CREATE INDEX IF NOT EXISTS idx_knowledge_embedding 
          ON knowledge_base 
          USING ivfflat (content_embedding vector_cosine_ops)
          WITH (lists = 100)
        `);
      }).catch((err) => {
        console.log('Vector index creation failed, will use sequential scan:', err.message);
      });

      // Index for messages embeddings
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_embedding 
        ON messages 
        USING hnsw (message_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `).catch((err) => {
        console.log('Messages vector index creation failed:', err.message);
      });
    } catch (vectorIndexError) {
      console.log('Vector indexing not available:', vectorIndexError.message);
    }
    
    // Create index for full-text search on content (fallback)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_content 
      ON knowledge_base USING gin(to_tsvector('english', content))
    `).catch(() => {
      // If full-text search index fails, create a simple text index
      console.log('Full-text search index not available, using simple index');
    });
    
    // Create simple index for category and title searches
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge_base(title)
    `);
    
    client.release();
    console.log('[DB Init] ✓ Database initialized successfully');
    isDatabaseHealthy = true;
    return true;
    
  } catch (error) {
    console.error('[DB Init] ✗ Error during database initialization:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n')[0] // First line of stack only
    });
    
    // Release client if we have one
    if (client) {
      try {
        client.release();
      } catch (releaseError) {
        console.log('[DB Init] Error releasing client:', releaseError.message);
      }
    }
    
    // Don't throw - allow server to start and retry later
    console.log('[DB Init] ⚠ Server will continue to start. Database operations will retry automatically.');
    isDatabaseHealthy = false;
    return false;
  }
}

// Export health check function
export async function getDatabaseHealth() {
  return {
    healthy: isDatabaseHealthy,
    lastCheck: lastHealthCheck,
    checkNow: await checkDatabaseHealth()
  };
}

export function isDatabaseAvailable() {
  return isDatabaseHealthy;
}

export default pool;


