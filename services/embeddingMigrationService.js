import pool from '../config/database.js';
import { queryWithRetry } from '../utils/dbRetry.js';
import { storeKnowledgeBaseEmbedding, storeMessageEmbeddings } from './vectorSearchService.js';
import dotenv from 'dotenv';

dotenv.config();

const AUTO_MIGRATE_ON_STARTUP = process.env.AUTO_MIGRATE_EMBEDDINGS !== 'false'; // Default: true
const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE) || 10; // Process 10 at a time
const BATCH_DELAY = parseInt(process.env.EMBEDDING_BATCH_DELAY) || 2000; // 2 seconds between batches
const EMBEDDING_SILENT_MODE = process.env.EMBEDDING_SILENT_MODE === 'true';

/**
 * Check if vector columns exist in the database
 */
async function checkVectorColumns() {
  try {
    const messagesCheck = await queryWithRetry(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'messages' 
        AND column_name IN ('message_embedding', 'response_embedding')
    `);
    
    const kbCheck = await queryWithRetry(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'knowledge_base' 
        AND column_name = 'content_embedding'
    `);
    
    return {
      messages: messagesCheck.rows.length > 0,
      knowledgeBase: kbCheck.rows.length > 0
    };
  } catch (error) {
    return { messages: false, knowledgeBase: false };
  }
}

/**
 * Add vector columns if they don't exist
 */
async function ensureVectorColumns() {
  try {
    const columns = await checkVectorColumns();
    
    if (!columns.messages) {
      try {
        await queryWithRetry(`
          ALTER TABLE messages 
          ADD COLUMN IF NOT EXISTS message_embedding vector(1536),
          ADD COLUMN IF NOT EXISTS response_embedding vector(1536)
        `);
        if (!EMBEDDING_SILENT_MODE) {
          console.log('✓ Added vector columns to messages table');
        }
      } catch (err) {
        // Columns might already exist or table doesn't exist
      }
    }
    
    if (!columns.knowledgeBase) {
      try {
        await queryWithRetry(`
          ALTER TABLE knowledge_base 
          ADD COLUMN IF NOT EXISTS content_embedding vector(1536)
        `);
        if (!EMBEDDING_SILENT_MODE) {
          console.log('✓ Added vector columns to knowledge_base table');
        }
      } catch (err) {
        // Columns might already exist or table doesn't exist
      }
    }
  } catch (error) {
    // Silently handle - might be schema issues
  }
}

/**
 * Process messages in batches
 */
async function processMessagesBatch() {
  try {
    // Check if messages table exists
    const tableExists = await queryWithRetry(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'messages'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      return { processed: 0, total: 0 };
    }
    
    // Check if vector columns exist
    const hasVectorColumns = await queryWithRetry(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'messages' 
        AND column_name = 'message_embedding'
    `);
    
    if (hasVectorColumns.rows.length === 0) {
      return { processed: 0, total: 0 };
    }
    
    // Get count of messages without embeddings
    const countResult = await queryWithRetry(`
      SELECT COUNT(*) as total
      FROM messages 
      WHERE message_embedding IS NULL 
        AND message IS NOT NULL
    `);
    
    const total = parseInt(countResult.rows[0].total) || 0;
    
    if (total === 0) {
      return { processed: 0, total: 0 };
    }
    
    if (!EMBEDDING_SILENT_MODE) {
      console.log(`📊 Found ${total} messages without embeddings. Processing in background...`);
    }
    
    let processed = 0;
    let offset = 0;
    
    while (offset < total) {
      // Get batch of messages
      const messagesResult = await queryWithRetry(`
        SELECT id, message, response 
        FROM messages 
        WHERE message_embedding IS NULL 
          AND message IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      
      if (messagesResult.rows.length === 0) {
        break;
      }
      
      // Process batch
      for (const row of messagesResult.rows) {
        try {
          await storeMessageEmbeddings(row.id, row.message, row.response || null);
          processed++;
        } catch (err) {
          // Silently skip errors (API might be unavailable)
        }
      }
      
      offset += BATCH_SIZE;
      
      // Delay between batches to avoid rate limiting
      if (offset < total) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
    
    return { processed, total };
  } catch (error) {
    if (!EMBEDDING_SILENT_MODE) {
      console.error('Error processing messages:', error.message);
    }
    return { processed: 0, total: 0 };
  }
}

/**
 * Process knowledge base entries in batches
 */
async function processKnowledgeBaseBatch() {
  try {
    // Check if knowledge_base table exists
    const tableExists = await queryWithRetry(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'knowledge_base'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      return { processed: 0, total: 0 };
    }
    
    // Check if vector columns exist
    const hasVectorColumns = await queryWithRetry(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'knowledge_base' 
        AND column_name = 'content_embedding'
    `);
    
    if (hasVectorColumns.rows.length === 0) {
      return { processed: 0, total: 0 };
    }
    
    // Get count of KB entries without embeddings
    const countResult = await queryWithRetry(`
      SELECT COUNT(*) as total
      FROM knowledge_base 
      WHERE content_embedding IS NULL 
        AND content IS NOT NULL
    `);
    
    const total = parseInt(countResult.rows[0].total) || 0;
    
    if (total === 0) {
      return { processed: 0, total: 0 };
    }
    
    if (!EMBEDDING_SILENT_MODE) {
      console.log(`📊 Found ${total} knowledge base entries without embeddings. Processing in background...`);
    }
    
    let processed = 0;
    let offset = 0;
    
    while (offset < total) {
      // Get batch of KB entries
      const kbResult = await queryWithRetry(`
        SELECT id, content 
        FROM knowledge_base 
        WHERE content_embedding IS NULL 
          AND content IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);
      
      if (kbResult.rows.length === 0) {
        break;
      }
      
      // Process batch
      for (const row of kbResult.rows) {
        try {
          await storeKnowledgeBaseEmbedding(row.id, row.content);
          processed++;
        } catch (err) {
          // Silently skip errors (API might be unavailable)
        }
      }
      
      offset += BATCH_SIZE;
      
      // Delay between batches
      if (offset < total) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
    
    return { processed, total };
  } catch (error) {
    if (!EMBEDDING_SILENT_MODE) {
      console.error('Error processing knowledge base:', error.message);
    }
    return { processed: 0, total: 0 };
  }
}

/**
 * Run embedding migration in background (non-blocking)
 */
export async function runEmbeddingMigration() {
  if (!AUTO_MIGRATE_ON_STARTUP) {
    if (!EMBEDDING_SILENT_MODE) {
      console.log('⏭️  Auto-migration disabled (AUTO_MIGRATE_EMBEDDINGS=false)');
    }
    return;
  }
  
  // Run in background - don't block server startup
  setImmediate(async () => {
    try {
      // Check if pgvector extension exists
      const extensionCheck = await queryWithRetry(
        "SELECT * FROM pg_extension WHERE extname = 'vector'"
      );
      
      if (extensionCheck.rows.length === 0) {
        if (!EMBEDDING_SILENT_MODE) {
          console.log('⏭️  Skipping embedding migration: pgvector extension not installed');
        }
        return;
      }
      
      if (!EMBEDDING_SILENT_MODE) {
        console.log('🔄 Starting background embedding migration...');
      }
      
      // Ensure vector columns exist
      await ensureVectorColumns();
      
      // Process messages
      const messagesResult = await processMessagesBatch();
      
      // Process knowledge base
      const kbResult = await processKnowledgeBaseBatch();
      
      if (!EMBEDDING_SILENT_MODE) {
        const totalProcessed = messagesResult.processed + kbResult.processed;
        const totalFound = messagesResult.total + kbResult.total;
        
        if (totalProcessed > 0) {
          console.log(`✅ Background embedding migration completed:`);
          console.log(`   - Messages: ${messagesResult.processed}/${messagesResult.total}`);
          console.log(`   - Knowledge Base: ${kbResult.processed}/${kbResult.total}`);
          console.log(`   - Total: ${totalProcessed}/${totalFound}`);
        } else if (totalFound === 0) {
          console.log('✅ All records already have embeddings');
        }
      }
    } catch (error) {
      // Handle connection errors gracefully
      const isConnectionError = error.code === 'ETIMEDOUT' || 
                               error.code === 'EHOSTUNREACH' || 
                               error.code === 'ECONNREFUSED' ||
                               error.message?.includes('Connection terminated');
      
      if (!EMBEDDING_SILENT_MODE && !isConnectionError) {
        console.error('❌ Background embedding migration error:', error.message);
      }
      // Don't throw - this is background process
    }
  });
}

