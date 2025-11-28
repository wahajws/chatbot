import express from 'express';
import { loadCachedSchema, getSchema, SCHEMA_CACHE_FILE } from '../services/schemaCache.js';
import { existsSync } from 'fs';

const router = express.Router();

/**
 * GET /api/schema
 * Get cached database schema in JSON format
 */
router.get('/', async (req, res) => {
  try {
    const useCache = req.query.cache !== 'false';
    const schema = await getSchema(useCache);
    
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
      cached: useCache && existsSync(SCHEMA_CACHE_FILE),
      cacheFile: SCHEMA_CACHE_FILE
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error retrieving schema',
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
      cacheFile: SCHEMA_CACHE_FILE
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error loading cached schema',
      message: error.message
    });
  }
});

export default router;









