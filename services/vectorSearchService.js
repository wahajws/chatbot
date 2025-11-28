import pool from '../config/database.js';
import { generateEmbedding, generateEmbeddingsBatch, embeddingToVectorString } from './embeddingService.js';

/**
 * Search for similar messages using vector similarity
 * @param {string} query - Search query text
 * @param {number} limit - Maximum number of results (default: 5)
 * @param {number} similarityThreshold - Minimum similarity score (0-1, default: 0.7)
 * @returns {Promise<Array>} - Array of similar messages with similarity scores
 */
export async function searchSimilarMessages(query, limit = 5, similarityThreshold = 0.7) {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      // Silently return empty if embedding generation fails
      return [];
    }

    const vectorString = embeddingToVectorString(queryEmbedding);
    if (!vectorString) {
      return [];
    }

    // Search for similar messages using cosine similarity
    // 1 - cosine_distance = cosine_similarity
    const result = await pool.query(`
      SELECT 
        id,
        message,
        response,
        created_at,
        1 - (message_embedding <=> $1::vector) as similarity
      FROM messages
      WHERE message_embedding IS NOT NULL
        AND (1 - (message_embedding <=> $1::vector)) >= $2
      ORDER BY message_embedding <=> $1::vector
      LIMIT $3
    `, [vectorString, similarityThreshold, limit]);

    return result.rows.map(row => ({
      id: row.id,
      message: row.message,
      response: row.response,
      createdAt: row.created_at,
      similarity: parseFloat(row.similarity)
    }));
  } catch (error) {
    console.error('Error in vector similarity search for messages:', error);
    return [];
  }
}

/**
 * Search knowledge base using vector similarity
 * @param {string} query - Search query text
 * @param {number} limit - Maximum number of results (default: 5)
 * @param {number} similarityThreshold - Minimum similarity score (0-1, default: 0.7)
 * @returns {Promise<Array>} - Array of similar knowledge base entries
 */
export async function searchKnowledgeBaseVector(query, limit = 5, similarityThreshold = 0.7) {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      // Silently return empty if embedding generation fails
      return [];
    }

    const vectorString = embeddingToVectorString(queryEmbedding);
    if (!vectorString) {
      return [];
    }

    // Search for similar knowledge base entries using cosine similarity
    const result = await pool.query(`
      SELECT 
        id,
        title,
        content,
        category,
        created_at,
        1 - (content_embedding <=> $1::vector) as similarity
      FROM knowledge_base
      WHERE content_embedding IS NOT NULL
        AND (1 - (content_embedding <=> $1::vector)) >= $2
      ORDER BY content_embedding <=> $1::vector
      LIMIT $3
    `, [vectorString, similarityThreshold, limit]);

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      similarity: parseFloat(row.similarity)
    }));
  } catch (error) {
    console.error('Error in vector similarity search for knowledge base:', error);
    return [];
  }
}

/**
 * Search all database tables semantically using vector similarity
 * This searches across messages and knowledge_base
 * @param {string} query - Search query text
 * @param {number} limit - Maximum number of results per source (default: 3)
 * @param {number} similarityThreshold - Minimum similarity score (0-1, default: 0.65)
 * @returns {Promise<string>} - Formatted search results
 */
export async function semanticSearchDatabase(query, limit = 3, similarityThreshold = 0.65) {
  try {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return '';
    }

    let results = `Semantic search results for "${query}":\n\n`;

    // Search knowledge base
    const kbResults = await searchKnowledgeBaseVector(query, limit, similarityThreshold);
    if (kbResults.length > 0) {
      results += `Knowledge Base (${kbResults.length} similar entries):\n`;
      kbResults.forEach((item, idx) => {
        results += `  [${idx + 1}] Similarity: ${(item.similarity * 100).toFixed(1)}%\n`;
        if (item.title) results += `  Title: ${item.title}\n`;
        results += `  Content: ${item.content.substring(0, 200)}${item.content.length > 200 ? '...' : ''}\n`;
        if (item.category) results += `  Category: ${item.category}\n`;
        results += `\n`;
      });
    }

    // Search messages
    const messageResults = await searchSimilarMessages(query, limit, similarityThreshold);
    if (messageResults.length > 0) {
      results += `Similar Messages (${messageResults.length} similar conversations):\n`;
      messageResults.forEach((item, idx) => {
        results += `  [${idx + 1}] Similarity: ${(item.similarity * 100).toFixed(1)}%\n`;
        results += `  Question: ${item.message}\n`;
        if (item.response) {
          results += `  Answer: ${item.response.substring(0, 200)}${item.response.length > 200 ? '...' : ''}\n`;
        }
        results += `\n`;
      });
    }

    if (kbResults.length === 0 && messageResults.length === 0) {
      return `No semantically similar content found for "${query}" (threshold: ${(similarityThreshold * 100).toFixed(0)}%)`;
    }

    return results;
  } catch (error) {
    console.error('Error in semantic database search:', error);
    return '';
  }
}

/**
 * Store embedding for a message
 * @param {number} messageId - Message ID
 * @param {string} messageText - Message text
 * @param {string} responseText - Response text (optional)
 */
export async function storeMessageEmbeddings(messageId, messageText, responseText = null) {
  try {
    // Generate embeddings
    const textsToEmbed = [messageText];
    if (responseText) {
      textsToEmbed.push(responseText);
    }

    const embeddings = await generateEmbeddingsBatch(textsToEmbed);
    
    if (embeddings.length === 0 || !embeddings[0]) {
      // Silently skip if embeddings are not available (API might be disabled or invalid)
      return;
    }

    const messageEmbedding = embeddingToVectorString(embeddings[0]);
    if (!messageEmbedding) {
      return;
    }

    const responseEmbedding = responseText && embeddings[1] ? embeddingToVectorString(embeddings[1]) : null;

    // Check if vector columns exist before updating
    try {
      // Update message with embeddings
      if (responseEmbedding) {
        await pool.query(`
          UPDATE messages 
          SET message_embedding = $1::vector, response_embedding = $2::vector
          WHERE id = $3
        `, [messageEmbedding, responseEmbedding, messageId]);
      } else {
        await pool.query(`
          UPDATE messages 
          SET message_embedding = $1::vector
          WHERE id = $2
        `, [messageEmbedding, messageId]);
      }
    } catch (dbError) {
      // Silently handle if vector columns don't exist (schema might not have them yet)
      if (dbError.code !== '42703') { // 42703 = undefined_column
        throw dbError;
      }
    }
  } catch (error) {
    // Only log unexpected errors (not API key or column missing errors)
    const isExpectedError = error.message?.includes('column') || 
                           error.message?.includes('API') ||
                           error.code === '42703';
    if (!isExpectedError) {
      console.error('Error storing message embeddings:', error.message);
    }
    // Don't throw - embedding storage is optional
  }
}

/**
 * Store embedding for a knowledge base entry
 * @param {number} kbId - Knowledge base entry ID
 * @param {string} content - Content text
 */
export async function storeKnowledgeBaseEmbedding(kbId, content) {
  try {
    const embedding = await generateEmbedding(content);
    if (!embedding) {
      // Silently skip if embeddings are not available
      return;
    }

    const vectorString = embeddingToVectorString(embedding);
    if (!vectorString) {
      return;
    }

    try {
      await pool.query(`
        UPDATE knowledge_base 
        SET content_embedding = $1::vector
        WHERE id = $2
      `, [vectorString, kbId]);
    } catch (dbError) {
      // Silently handle if vector columns don't exist
      if (dbError.code !== '42703') { // 42703 = undefined_column
        throw dbError;
      }
    }
  } catch (error) {
    // Only log unexpected errors
    const isExpectedError = error.message?.includes('column') || 
                           error.message?.includes('API') ||
                           error.code === '42703';
    if (!isExpectedError) {
      console.error('Error storing knowledge base embedding:', error.message);
    }
    // Don't throw - embedding storage is optional
  }
}


