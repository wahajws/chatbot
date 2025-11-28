import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase, getDatabaseHealth, isDatabaseAvailable } from './config/database.js';
import { cacheSchema } from './services/schemaCache.js';
import chatRoutes from './routes/chat.js';
import knowledgeRoutes from './routes/knowledge.js';
import vectorHealthRoutes from './routes/vectorHealth.js';
import schemaRoutes from './routes/schema.js';
import analyticsRoutes from './routes/analytics.js';
import { runEmbeddingMigration } from './services/embeddingMigrationService.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
  console.log(`Created uploads directory: ${uploadDir}`);
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Chat API Server',
    version: '1.0.0',
    database: {
      available: isDatabaseAvailable(),
      health: getDatabaseHealth()
    },
    endpoints: {
      chat: 'POST /api/chat',
      history: 'GET /api/chat/history',
      getMessage: 'GET /api/chat/:id',
      knowledge: 'GET /api/knowledge',
      addKnowledge: 'POST /api/knowledge',
      searchKnowledge: 'GET /api/knowledge/search',
      health: 'GET /api/health',
      schema: 'GET /api/schema',
      schemaCached: 'GET /api/schema/cached',
      analyticsCharts: 'GET /api/analytics/charts',
      analyticsStats: 'GET /api/analytics/stats'
    }
  });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const health = await getDatabaseHealth();
  res.json({
    status: health.checkNow ? 'healthy' : 'unhealthy',
    database: {
      available: health.healthy,
      lastCheck: health.lastCheck ? new Date(health.lastCheck).toISOString() : null,
      currentCheck: health.checkNow
    },
    timestamp: new Date().toISOString()
  });
});

app.use('/api/chat', chatRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/vector-health', vectorHealthRoutes);
app.use('/api/schema', schemaRoutes);
app.use('/api/analytics', analyticsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Initialize database and start server
async function startServer() {
  try {
    console.log('[Server] Starting server initialization...');
    console.log('[Server] Environment variables:', {
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_NAME: process.env.DB_NAME,
      DB_USER: process.env.DB_USER,
      PORT: process.env.PORT || 3000,
      ALIBABA_API_BASE_URL: process.env.ALIBABA_LLM_API_BASE_URL,
      ALIBABA_MODEL: process.env.ALIBABA_LLM_API_MODEL,
      HAS_API_KEY: !!process.env.ALIBABA_LLM_API_KEY
    });
    
    console.log('[Server] Initializing database...');
    const dbInitialized = await initializeDatabase();
    
    if (dbInitialized) {
      console.log('[Server] Database initialized successfully');
      
      // Cache database schema in JSON format
      console.log('[Server] Caching database schema...');
      try {
        await cacheSchema();
      } catch (schemaError) {
        console.log('[Server] Schema caching failed (non-critical):', schemaError.message);
      }
    } else {
      console.log('[Server] Database initialization failed, but server will start anyway.');
      console.log('[Server] Database operations will retry automatically on first use.');
      console.log('[Server] Schema caching will be attempted when database becomes available.');
    }
    
    app.listen(PORT, () => {
      console.log('[Server] ========================================');
      console.log(`[Server] Server is running on port ${PORT}`);
      console.log(`[Server] API endpoint: http://localhost:${PORT}/api/chat`);
      console.log(`[Server] Health endpoint: http://localhost:${PORT}/api/vector-health`);
      console.log('[Server] ========================================');
      
      // Start background embedding migration (non-blocking)
      // Only if database was initialized successfully
      if (dbInitialized) {
        console.log('[Server] Starting background embedding migration...');
        runEmbeddingMigration();
      } else {
        console.log('[Server] Skipping embedding migration - database not available');
      }
    });
  } catch (error) {
    console.error('[Server] Failed to start server:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    process.exit(1);
  }
}

startServer();


