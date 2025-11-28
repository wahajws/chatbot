import express from 'express';
import { 
  getDatabaseSchema,
  searchDatabaseData,
  getDatabaseSummary,
  getSampleData
} from '../services/databaseService.js';

const router = express.Router();

/**
 * GET /api/knowledge/schema
 * Get database schema information
 */
router.get('/schema', async (req, res) => {
  try {
    const schema = await getDatabaseSchema();
    res.json({
      success: true,
      schema: schema
    });
  } catch (error) {
    console.error('Error fetching database schema:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/knowledge/summary
 * Get database summary
 */
router.get('/summary', async (req, res) => {
  try {
    console.log('[Knowledge API] Fetching database summary...');
    const summary = await getDatabaseSummary();
    res.json({
      success: true,
      summary: summary
    });
  } catch (error) {
    console.error('[Knowledge API] Error fetching database summary:', error.message);
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED';
    
    if (isConnectionError) {
      res.status(503).json({
        success: false,
        error: 'Database unavailable',
        message: 'Database connection failed. Please check database connectivity.',
        summary: 'Database connection error. Please ensure the database server is running and accessible.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/knowledge/sample
 * Get sample data from all tables
 * Query params: limit (default: 3) - number of rows per table
 */
router.get('/sample', async (req, res) => {
  try {
    console.log('[Knowledge API] Fetching sample data...');
    const limit = parseInt(req.query.limit) || 3;
    const sampleData = await getSampleData(limit);
    
    res.json({
      success: true,
      data: sampleData
    });
  } catch (error) {
    console.error('[Knowledge API] Error fetching sample data:', error.message);
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED';
    
    if (isConnectionError) {
      res.status(503).json({
        success: false,
        error: 'Database unavailable',
        message: 'Database connection failed. Please check database connectivity.',
        data: 'Database connection error.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

/**
 * GET /api/knowledge/search
 * Search the database for relevant data (text search)
 * Query params: q (search query), limit (default: 5)
 */
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit) || 5;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Search query (q) is required'
      });
    }

    const results = await searchDatabaseData(query, limit);

    res.json({
      success: true,
      query: query,
      results: results
    });
  } catch (error) {
    console.error('Error searching database:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Vector search endpoint removed - vector database is disabled per user request

export default router;

