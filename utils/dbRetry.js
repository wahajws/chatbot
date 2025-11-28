import pool from '../config/database.js';

/**
 * Execute a database query with retry logic
 * @param {Function} queryFn - Function that returns a promise with the query
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 1000)
 * @returns {Promise} - Query result
 */
export async function executeWithRetry(queryFn, maxRetries = 3, retryDelay = 1000) {
  let lastError;
  
  // Optimized: Only log on first attempt and final failure
  let loggedStart = false;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!loggedStart && attempt === 1) {
        console.log(`[DB Retry] Starting query execution (max retries: ${maxRetries})`);
        loggedStart = true;
      }
      
      const result = await queryFn();
      
      if (attempt > 1) {
        console.log(`[DB Retry] ✓ Query succeeded on attempt ${attempt}`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = 
        error.code === 'ETIMEDOUT' ||
        error.code === 'EHOSTUNREACH' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('Connection terminated') ||
        error.message?.includes('Connection closed') ||
        error.message?.includes('timeout');
      
      if (!isRetryable) {
        console.log(`[DB Retry] ✗ Non-retryable error: ${error.message}`);
        throw error;
      }
      
      if (attempt === maxRetries) {
        console.log(`[DB Retry] ✗ Max retries (${maxRetries}) reached. Error: ${error.message}`);
        throw error;
      }
      
      // Optimized exponential backoff with jitter
      const exponentialDelay = retryDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 200; // Add 0-200ms random jitter
      const delay = Math.min(exponentialDelay + jitter, 10000); // Cap at 10 seconds
      
      console.log(`[DB Retry] ⚠ Attempt ${attempt} failed (${error.code || 'unknown'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Get a client from the pool with retry logic
 */
export async function getClientWithRetry(maxRetries = 3) {
  return executeWithRetry(
    async () => {
      const client = await pool.connect();
      return client;
    },
    maxRetries,
    1000
  );
}

/**
 * Execute a query with automatic retry and connection handling
 * @param {string} queryText - SQL query text
 * @param {Array} params - Query parameters
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 */
export async function queryWithRetry(queryText, params = [], maxRetries = 3) {
  // Optimized: Only log query details in debug mode or on first attempt
  const shouldLog = process.env.DB_DEBUG === 'true' || maxRetries === 1;
  
  if (shouldLog) {
    const queryPreview = queryText.length > 100 ? queryText.substring(0, 100) + '...' : queryText;
    console.log(`[DB Query] Executing: ${queryPreview}`);
    if (params.length > 0 && params.length <= 5) { // Only log if params are reasonable
      console.log(`[DB Query] Params:`, params);
    }
  }
  
  return executeWithRetry(
    async () => {
      const startTime = Date.now();
      const result = await pool.query(queryText, params);
      const queryTime = Date.now() - startTime;
      
      if (shouldLog || queryTime > 1000) { // Log slow queries
        console.log(`[DB Query] ✓ Success - ${result.rows.length} rows in ${queryTime}ms`);
      }
      
      return result;
    },
    maxRetries,
    1000
  );
}

