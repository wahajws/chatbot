import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

/**
 * GET /api/vector-health
 * Get vector database health and monitoring metrics
 */
router.get('/', async (req, res) => {
  try {
    // Check if pgvector extension exists
    const extensionCheck = await pool.query(
      "SELECT * FROM pg_extension WHERE extname = 'vector'"
    );
    
    const hasExtension = extensionCheck.rows.length > 0;
    
    // Get vector column statistics
    let messagesStats = null;
    let knowledgeBaseStats = null;
    let indexStats = null;
    
    if (hasExtension) {
      // Messages table vector stats - check if table and columns exist first
      try {
        // Check if messages table exists
        const tableExists = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'messages'
          )
        `);
        
        if (tableExists.rows[0].exists) {
          // Check which vector columns exist in messages table
          const messagesColumns = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'messages' 
              AND column_name LIKE '%embedding%'
          `);
          
          const hasMessageEmbedding = messagesColumns.rows.some(r => r.column_name === 'message_embedding');
          const hasResponseEmbedding = messagesColumns.rows.some(r => r.column_name === 'response_embedding');
          
          let query = 'SELECT COUNT(*) as total_messages';
          if (hasMessageEmbedding) {
            query += ', COUNT(message_embedding) as messages_with_embeddings';
            query += ', COUNT(*) - COUNT(message_embedding) as messages_without_embeddings';
          } else {
            query += ', 0 as messages_with_embeddings, COUNT(*) as messages_without_embeddings';
          }
          if (hasResponseEmbedding) {
            query += ', COUNT(response_embedding) as responses_with_embeddings';
          } else {
            query += ', 0 as responses_with_embeddings';
          }
          query += ' FROM messages';
          
          const messagesResult = await pool.query(query);
          messagesStats = messagesResult.rows[0];
        }
      } catch (err) {
        console.error('Error getting messages stats:', err);
      }
      
      // Knowledge base table vector stats - check if table and columns exist first
      try {
        // Check if knowledge_base table exists
        const tableExists = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'knowledge_base'
          )
        `);
        
        if (tableExists.rows[0].exists) {
          const kbColumns = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'knowledge_base' 
              AND column_name LIKE '%embedding%'
          `);
          
          const hasContentEmbedding = kbColumns.rows.some(r => r.column_name === 'content_embedding');
          
          let query = 'SELECT COUNT(*) as total_entries';
          if (hasContentEmbedding) {
            query += ', COUNT(content_embedding) as entries_with_embeddings';
            query += ', COUNT(*) - COUNT(content_embedding) as entries_without_embeddings';
          } else {
            query += ', 0 as entries_with_embeddings, COUNT(*) as entries_without_embeddings';
          }
          query += ' FROM knowledge_base';
          
          const kbResult = await pool.query(query);
          knowledgeBaseStats = kbResult.rows[0];
        }
      } catch (err) {
        console.error('Error getting knowledge base stats:', err);
      }
      
      // Index statistics
      try {
        const indexResult = await pool.query(`
          SELECT 
            schemaname,
            tablename,
            indexname,
            indexdef
          FROM pg_indexes
          WHERE indexname LIKE '%embedding%' OR indexname LIKE '%vector%'
          ORDER BY tablename, indexname
        `);
        indexStats = indexResult.rows;
      } catch (err) {
        console.error('Error getting index stats:', err);
      }
      
      // Vector column information
      let vectorColumns = [];
      try {
        const columnsResult = await pool.query(`
          SELECT 
            table_name,
            column_name,
            data_type,
            is_nullable
          FROM information_schema.columns
          WHERE data_type = 'USER-DEFINED'
            AND udt_name = 'vector'
          ORDER BY table_name, column_name
        `);
        vectorColumns = columnsResult.rows;
      } catch (err) {
        console.error('Error getting vector columns:', err);
      }
      
      // Sample embedding dimensions check - use first available vector column
      let embeddingDimensions = null;
      if (vectorColumns.length > 0) {
        try {
          const firstCol = vectorColumns[0];
          // Check if table exists before querying
          const tableExists = await pool.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' AND table_name = $1
            )
          `, [firstCol.table_name]);
          
          if (tableExists.rows[0].exists) {
            const dimCheck = await pool.query(`
              SELECT 
                array_length("${firstCol.column_name}"::float[], 1) as dimension
              FROM "${firstCol.table_name}"
              WHERE "${firstCol.column_name}" IS NOT NULL
              LIMIT 1
            `);
            if (dimCheck.rows.length > 0 && dimCheck.rows[0].dimension) {
              embeddingDimensions = dimCheck.rows[0].dimension;
            }
          }
        } catch (err) {
          // If query fails, use default
          console.log('Error checking embedding dimensions:', err.message);
          embeddingDimensions = 1536; // Default assumption
        }
      } else {
        embeddingDimensions = 1536; // Default if no vector columns found
      }
      
      // Get vector storage size information - check if tables exist
      let storageInfo = null;
      try {
        const tablesExist = await pool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
            AND table_name IN ('messages', 'knowledge_base')
        `);
        
        const existingTables = tablesExist.rows.map(r => r.table_name);
        let query = 'SELECT ';
        
        if (existingTables.includes('messages')) {
          query += `pg_size_pretty(pg_total_relation_size('messages')) as messages_size, `;
        } else {
          query += `'0 bytes' as messages_size, `;
        }
        
        if (existingTables.includes('knowledge_base')) {
          query += `pg_size_pretty(pg_total_relation_size('knowledge_base')) as knowledge_base_size, `;
        } else {
          query += `'0 bytes' as knowledge_base_size, `;
        }
        
        query += `pg_size_pretty(pg_database_size(current_database())) as database_size`;
        
        const storageResult = await pool.query(query);
        storageInfo = storageResult.rows[0];
      } catch (err) {
        console.error('Error getting storage info:', err);
      }
      
      // Get recent embedding activity (last 24 hours) - check if columns exist
      let recentActivity = null;
      try {
        // Check if messages table and columns exist
        const tableExists = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'messages'
          )
        `);
        
        if (tableExists.rows[0].exists) {
          const hasCreatedAt = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'messages' AND column_name = 'created_at'
          `);
          const hasMessageEmbedding = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'messages' AND column_name = 'message_embedding'
          `);
          
          let query = 'SELECT COUNT(*) as total_messages_24h';
          if (hasMessageEmbedding.rows.length > 0) {
            query += ', COUNT(message_embedding) as embedded_messages_24h';
          } else {
            query += ', 0 as embedded_messages_24h';
          }
          if (hasCreatedAt.rows.length > 0) {
            query += ', MAX(created_at) as last_message_time';
            query += ' FROM messages WHERE created_at >= NOW() - INTERVAL \'24 hours\'';
          } else {
            query += ', NULL as last_message_time';
            query += ' FROM messages';
          }
          
          const activityResult = await pool.query(query);
          recentActivity = activityResult.rows[0];
        }
      } catch (err) {
        console.error('Error getting recent activity:', err);
      }
      
      // Get index size and statistics - use correct PostgreSQL column names
      let indexSizes = [];
      try {
        const indexSizeResult = await pool.query(`
          SELECT 
            schemaname,
            relname as tablename,
            indexrelname as indexname,
            pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
            idx_scan as index_scans,
            idx_tup_read as tuples_read,
            idx_tup_fetch as tuples_fetched
          FROM pg_stat_user_indexes
          WHERE indexrelname LIKE '%embedding%' OR indexrelname LIKE '%vector%'
          ORDER BY pg_relation_size(indexrelid) DESC
        `);
        indexSizes = indexSizeResult.rows;
      } catch (err) {
        console.error('Error getting index sizes:', err);
      }
      
      // Get table statistics for vector columns - use correct PostgreSQL column names
      let tableStats = null;
      try {
        // Check which tables actually exist
        const tablesExist = await pool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
            AND table_name IN ('messages', 'knowledge_base')
        `);
        
        if (tablesExist.rows.length > 0) {
          const tableNames = tablesExist.rows.map(r => `'${r.table_name}'`).join(',');
          const tableStatsResult = await pool.query(`
            SELECT 
              schemaname,
              relname as tablename,
              n_tup_ins as inserts,
              n_tup_upd as updates,
              n_tup_del as deletes,
              n_live_tup as live_tuples,
              n_dead_tup as dead_tuples,
              last_vacuum,
              last_autovacuum,
              last_analyze,
              last_autoanalyze
            FROM pg_stat_user_tables
            WHERE relname IN (${tableNames})
            ORDER BY relname
          `);
          tableStats = tableStatsResult.rows;
        }
      } catch (err) {
        console.error('Error getting table stats:', err);
      }
      
      // Get vector column statistics (null vs non-null)
      let vectorColumnStats = [];
      try {
        for (const col of vectorColumns) {
          // Use identifier quoting to prevent SQL injection
          const colStats = await pool.query(`
            SELECT 
              COUNT(*) as total_rows,
              COUNT("${col.column_name}") as non_null_rows,
              COUNT(*) - COUNT("${col.column_name}") as null_rows
            FROM "${col.table_name}"
          `);
          vectorColumnStats.push({
            table: col.table_name,
            column: col.column_name,
            ...colStats.rows[0]
          });
        }
      } catch (err) {
        console.error('Error getting vector column stats:', err);
      }
      
      // Get average similarity scores (if we have sample data) - use dynamic column names
      let similarityStats = null;
      if (vectorColumns.length > 0) {
        try {
          // Use first vector column found for similarity calculation
          const firstCol = vectorColumns[0];
          const tableName = firstCol.table_name;
          const colName = firstCol.column_name;
          
          // Check if table has id column
          const hasId = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = 'id'
          `, [tableName]);
          
          if (hasId.rows.length > 0) {
            const similarityResult = await pool.query(`
              SELECT 
                AVG(1 - (m1."${colName}" <=> m2."${colName}")) as avg_similarity,
                MIN(1 - (m1."${colName}" <=> m2."${colName}")) as min_similarity,
                MAX(1 - (m1."${colName}" <=> m2."${colName}")) as max_similarity
              FROM "${tableName}" m1
              CROSS JOIN "${tableName}" m2
              WHERE m1.id != m2.id
                AND m1."${colName}" IS NOT NULL
                AND m2."${colName}" IS NOT NULL
              LIMIT 100
            `);
            if (similarityResult.rows.length > 0 && similarityResult.rows[0].avg_similarity) {
              similarityStats = similarityResult.rows[0];
            }
          }
        } catch (err) {
          // This might fail if there's not enough data, which is fine
          console.log('Similarity stats not available:', err.message);
        }
      }
      
      res.json({
        success: true,
        health: {
          extensionInstalled: hasExtension,
          status: hasExtension ? 'healthy' : 'extension_missing',
          timestamp: new Date().toISOString()
        },
        statistics: {
          messages: messagesStats,
          knowledgeBase: knowledgeBaseStats,
          embeddingDimensions: embeddingDimensions || 1536
        },
        indexes: indexStats || [],
        indexSizes: indexSizes,
        vectorColumns: vectorColumns,
        vectorColumnStats: vectorColumnStats,
        storage: storageInfo,
        recentActivity: recentActivity,
        tableStats: tableStats,
        similarityStats: similarityStats,
        coverage: {
          messages: messagesStats ? {
            total: parseInt(messagesStats.total_messages) || 0,
            withEmbeddings: parseInt(messagesStats.messages_with_embeddings) || 0,
            withoutEmbeddings: parseInt(messagesStats.messages_without_embeddings) || 0,
            coveragePercent: messagesStats.total_messages > 0 
              ? ((parseInt(messagesStats.messages_with_embeddings) || 0) / parseInt(messagesStats.total_messages) * 100).toFixed(1)
              : 0
          } : null,
          knowledgeBase: knowledgeBaseStats ? {
            total: parseInt(knowledgeBaseStats.total_entries) || 0,
            withEmbeddings: parseInt(knowledgeBaseStats.entries_with_embeddings) || 0,
            withoutEmbeddings: parseInt(knowledgeBaseStats.entries_without_embeddings) || 0,
            coveragePercent: knowledgeBaseStats.total_entries > 0
              ? ((parseInt(knowledgeBaseStats.entries_with_embeddings) || 0) / parseInt(knowledgeBaseStats.total_entries) * 100).toFixed(1)
              : 0
          } : null
        }
      });
    } else {
      res.json({
        success: true,
        health: {
          extensionInstalled: false,
          status: 'extension_missing',
          timestamp: new Date().toISOString(),
          message: 'pgvector extension is not installed. Please install it to enable vector search.'
        },
        statistics: null,
        indexes: [],
        vectorColumns: [],
        coverage: null
      });
    }
  } catch (error) {
    console.error('Error fetching vector health:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;

