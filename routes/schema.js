import express from 'express';
import { loadCachedSchema, getSchema, refreshSchema, SCHEMA_CACHE_FILE } from '../services/schemaCache.js';
import { existsSync } from 'fs';

const router = express.Router();

/**
 * GET /api/schema
 * Get database schema in JSON format
 * Automatically refreshes if cache is stale (older than 1 hour)
 * Query params:
 *   - cache: 'true' (default) or 'false' to disable cache
 *   - refresh: 'true' to force refresh
 *   - maxAge: Maximum cache age in hours (default: 1)
 */
router.get('/', async (req, res) => {
  try {
    const useCache = req.query.cache !== 'false';
    const forceRefresh = req.query.refresh === 'true';
    const maxAgeHours = parseFloat(req.query.maxAge) || 1;
    
    const schema = await getSchema(useCache, forceRefresh, maxAgeHours);
    
    if (!schema) {
      return res.status(503).json({
        error: 'Schema not available',
        message: 'Database connection failed. Please check database connectivity.',
        cacheFile: SCHEMA_CACHE_FILE,
        cacheExists: existsSync(SCHEMA_CACHE_FILE)
      });
    }
    
    res.json({
      success: true,
      schema: schema,
      cached: useCache && existsSync(SCHEMA_CACHE_FILE) && !forceRefresh,
      cacheFile: SCHEMA_CACHE_FILE,
      cachedAt: schema.cachedAt
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error retrieving schema',
      message: error.message
    });
  }
});

/**
 * POST /api/schema/refresh
 * Force refresh the schema cache
 * This will fetch fresh schema from the database and update the cache
 */
router.post('/refresh', async (req, res) => {
  try {
    console.log('[Schema API] Manual refresh requested');
    const schema = await refreshSchema();
    
    if (!schema) {
      return res.status(503).json({
        error: 'Schema refresh failed',
        message: 'Database connection failed. Please check database connectivity.',
        cacheFile: SCHEMA_CACHE_FILE
      });
    }
    
    res.json({
      success: true,
      message: 'Schema cache refreshed successfully',
      schema: schema,
      cached: true,
      cacheFile: SCHEMA_CACHE_FILE,
      cachedAt: schema.cachedAt
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error refreshing schema',
      message: error.message
    });
  }
});

/**
 * GET /api/schema/cached
 * Get only cached schema (don't fetch fresh)
 */
router.get('/cached', async (req, res) => {
  try {
    const schema = await loadCachedSchema();
    
    if (!schema) {
      return res.status(404).json({
        error: 'No cached schema found',
        message: 'Schema has not been cached yet. Start the server to cache the schema.',
        cacheFile: SCHEMA_CACHE_FILE
      });
    }
    
    res.json({
      success: true,
      schema: schema,
      cached: true,
      cacheFile: SCHEMA_CACHE_FILE,
      cachedAt: schema.cachedAt
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error loading cached schema',
      message: error.message
    });
  }
});

export default router;









