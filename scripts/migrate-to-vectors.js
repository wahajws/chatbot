import pool from '../config/database.js';
import { storeKnowledgeBaseEmbedding, storeMessageEmbeddings } from '../services/vectorSearchService.js';

/**
 * Migration script to add vector embeddings to existing data
 * Run this once to populate embeddings for existing messages and knowledge base entries
 */
async function migrateToVectors() {
  try {
    console.log('Starting vector migration...');
    
    const client = await pool.connect();
    
    // Check if pgvector extension exists
    const extensionCheck = await client.query(
      "SELECT * FROM pg_extension WHERE extname = 'vector'"
    );
    
    if (extensionCheck.rows.length === 0) {
      console.error('ERROR: pgvector extension not found. Please install it first:');
      console.error('  CREATE EXTENSION vector;');
      client.release();
      process.exit(1);
    }
    
    console.log('pgvector extension found ✓');
    
    // Add vector columns if they don't exist
    try {
      await client.query(`
        ALTER TABLE messages 
        ADD COLUMN IF NOT EXISTS message_embedding vector(1536),
        ADD COLUMN IF NOT EXISTS response_embedding vector(1536)
      `);
      console.log('Added vector columns to messages table ✓');
    } catch (err) {
      console.log('Vector columns may already exist in messages table');
    }
    
    try {
      await client.query(`
        ALTER TABLE knowledge_base 
        ADD COLUMN IF NOT EXISTS content_embedding vector(1536)
      `);
      console.log('Added vector columns to knowledge_base table ✓');
    } catch (err) {
      console.log('Vector columns may already exist in knowledge_base table');
    }
    
    client.release();
    
    // Migrate messages
    console.log('\nMigrating messages...');
    const messagesResult = await pool.query(`
      SELECT id, message, response 
      FROM messages 
      WHERE message_embedding IS NULL 
        AND message IS NOT NULL
      ORDER BY id
    `);
    
    console.log(`Found ${messagesResult.rows.length} messages without embeddings`);
    
    for (let i = 0; i < messagesResult.rows.length; i++) {
      const row = messagesResult.rows[i];
      console.log(`Processing message ${i + 1}/${messagesResult.rows.length} (ID: ${row.id})...`);
      
      try {
        await storeMessageEmbeddings(row.id, row.message, row.response || null);
        console.log(`  ✓ Stored embeddings for message ${row.id}`);
      } catch (err) {
        console.log(`  ✗ Failed to store embeddings for message ${row.id}:`, err.message);
      }
      
      // Small delay to avoid rate limiting
      if (i < messagesResult.rows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Migrate knowledge base
    console.log('\nMigrating knowledge base...');
    const kbResult = await pool.query(`
      SELECT id, content 
      FROM knowledge_base 
      WHERE content_embedding IS NULL 
        AND content IS NOT NULL
      ORDER BY id
    `);
    
    console.log(`Found ${kbResult.rows.length} knowledge base entries without embeddings`);
    
    for (let i = 0; i < kbResult.rows.length; i++) {
      const row = kbResult.rows[i];
      console.log(`Processing KB entry ${i + 1}/${kbResult.rows.length} (ID: ${row.id})...`);
      
      try {
        await storeKnowledgeBaseEmbedding(row.id, row.content);
        console.log(`  ✓ Stored embeddings for KB entry ${row.id}`);
      } catch (err) {
        console.log(`  ✗ Failed to store embeddings for KB entry ${row.id}:`, err.message);
      }
      
      // Small delay to avoid rate limiting
      if (i < kbResult.rows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('\n✓ Migration completed!');
    console.log(`  - Processed ${messagesResult.rows.length} messages`);
    console.log(`  - Processed ${kbResult.rows.length} knowledge base entries`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateToVectors();










