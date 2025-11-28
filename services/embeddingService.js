import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment variables - all configurable
const ALIBABA_API_KEY = process.env.ALIBABA_LLM_API_KEY;
const ALIBABA_API_BASE_URL = process.env.ALIBABA_LLM_API_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || process.env.ALIBABA_LLM_API_MODEL || 'text-embedding-v1';
const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const EMBEDDING_ENABLED = process.env.EMBEDDING_ENABLED !== 'false'; // Default to true
const EMBEDDING_SILENT_MODE = process.env.EMBEDDING_SILENT_MODE === 'true'; // Reduce console noise

// Validate API key early
const hasValidApiKey = ALIBABA_API_KEY && ALIBABA_API_KEY.trim().length > 0 && !ALIBABA_API_KEY.includes('your_api_key');

// Cache authentication failure to avoid repeated API calls
let authFailureLogged = false;
let lastAuthError = null;

/**
 * Generate embedding vector for text using configurable embedding API
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<number[]>} - Embedding vector array or null if failed
 */
export async function generateEmbedding(text) {
  try {
    // Early validation
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      if (!EMBEDDING_SILENT_MODE) {
        console.warn('Embedding generation skipped: empty text provided');
      }
      return null;
    }

    // Check if embedding is enabled
    if (!EMBEDDING_ENABLED) {
      if (!EMBEDDING_SILENT_MODE) {
        console.log('Embedding generation is disabled (EMBEDDING_ENABLED=false)');
      }
      return null;
    }

    // Check API key
    if (!hasValidApiKey) {
      if (!EMBEDDING_SILENT_MODE && !authFailureLogged) {
        console.warn('Embedding generation skipped: Invalid or missing API key. Set ALIBABA_LLM_API_KEY in .env');
        authFailureLogged = true;
      }
      return null;
    }

    // If we've already confirmed auth failure, skip immediately
    if (authFailureLogged && lastAuthError) {
      return null;
    }

    // Try multiple API endpoint formats (all configurable)
    const endpoints = [
      {
        name: 'DashScope Native API',
        url: EMBEDDING_API_URL,
        method: 'native',
        model: EMBEDDING_MODEL
      },
      {
        name: 'OpenAI-Compatible API',
        url: `${ALIBABA_API_BASE_URL}/embeddings`,
        method: 'openai',
        model: EMBEDDING_MODEL
      },
      {
        name: 'DashScope Alternative',
        url: EMBEDDING_API_URL,
        method: 'native',
        model: EMBEDDING_MODEL.replace('v1', 'v2').replace('v2', 'v1') // Try alternative version
      }
    ];

    for (const endpoint of endpoints) {
      try {
        let requestBody;
        let response;

        if (endpoint.method === 'native') {
          // DashScope native format
          requestBody = {
            model: endpoint.model,
            input: {
              texts: [text]
            }
          };
          response = await axios.post(
            endpoint.url,
            requestBody,
            {
              headers: {
                'Authorization': `Bearer ${ALIBABA_API_KEY}`,
                'Content-Type': 'application/json',
                'X-DashScope-SSE': 'disable'
              },
              timeout: 30000 // 30 second timeout
            }
          );

          if (response.data?.output?.embeddings?.[0]?.embedding) {
            return response.data.output.embeddings[0].embedding;
          }
        } else {
          // OpenAI-compatible format
          requestBody = {
            model: endpoint.model,
            input: text
          };
          response = await axios.post(
            endpoint.url,
            requestBody,
            {
              headers: {
                'Authorization': `Bearer ${ALIBABA_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );

          if (response.data?.data?.[0]?.embedding) {
            return response.data.data[0].embedding;
          }
        }
      } catch (error) {
        // Only log if not silent mode and it's not an auth error (to reduce noise)
        const isAuthError = error.response?.status === 401 || error.response?.status === 403;
        const errorMessage = error.response?.data?.message || error.message;
        
        if (!EMBEDDING_SILENT_MODE && !isAuthError) {
          console.log(`${endpoint.name} failed: ${errorMessage}`);
        }
        
        // If it's an auth error, don't try other endpoints
        if (isAuthError) {
          authFailureLogged = true;
          lastAuthError = errorMessage;
          
          if (!EMBEDDING_SILENT_MODE) {
            console.warn('Embedding API authentication failed. Please check:');
            console.warn('1. ALIBABA_LLM_API_KEY is correct in .env');
            console.warn('2. Embedding API is enabled in your Alibaba DashScope account');
            console.warn('3. API key has permissions for embedding services');
            console.warn(`Error: ${errorMessage}`);
            console.warn('(This message will only appear once. Set EMBEDDING_SILENT_MODE=true to suppress)');
          }
          break;
        }
        
        // Continue to next endpoint
        continue;
      }
    }

    // All endpoints failed (but not due to auth - that's handled above)
    if (!EMBEDDING_SILENT_MODE && !authFailureLogged) {
      console.warn('Could not generate embedding - all API endpoints failed. Embedding features will be disabled.');
      console.warn('(Set EMBEDDING_SILENT_MODE=true in .env to suppress these messages)');
    }
    return null;
  } catch (error) {
    if (!EMBEDDING_SILENT_MODE) {
      console.error('Unexpected error generating embedding:', error.message);
    }
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @returns {Promise<number[][]>} - Array of embedding vectors (null for failed ones)
 */
export async function generateEmbeddingsBatch(texts) {
  try {
    // Early validation
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    // Check if embedding is enabled
    if (!EMBEDDING_ENABLED || !hasValidApiKey) {
      return texts.map(() => null);
    }

    // Filter out empty texts
    const validTexts = texts.filter(t => t && typeof t === 'string' && t.trim().length > 0);
    if (validTexts.length === 0) {
      return texts.map(() => null);
    }

    // Try batch embedding API first (more efficient)
    try {
      const response = await axios.post(
        EMBEDDING_API_URL,
        {
          model: EMBEDDING_MODEL,
          input: {
            texts: validTexts
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${ALIBABA_API_KEY}`,
            'Content-Type': 'application/json',
            'X-DashScope-SSE': 'disable'
          },
          timeout: 60000 // Longer timeout for batch requests
        }
      );

      if (response.data?.output?.embeddings) {
        const batchEmbeddings = response.data.output.embeddings.map(e => e?.embedding || null);
        
        // Map back to original array positions (handling empty texts)
        const result = [];
        let validIndex = 0;
        for (const text of texts) {
          if (text && typeof text === 'string' && text.trim().length > 0) {
            result.push(batchEmbeddings[validIndex] || null);
            validIndex++;
          } else {
            result.push(null);
          }
        }
        return result;
      }
    } catch (error) {
      const isAuthError = error.response?.status === 401 || error.response?.status === 403;
      
      if (isAuthError) {
        authFailureLogged = true;
        lastAuthError = error.response?.data?.message || error.message;
      }
      
      // Only log if not silent mode and not an auth error (auth errors are logged once above)
      if (!EMBEDDING_SILENT_MODE && !isAuthError) {
        const errorMsg = error.response?.data?.message || error.message;
        console.log('Batch embedding failed, generating individually...', errorMsg);
      }
    }

    // Fallback: Generate embeddings one by one (slower but more reliable)
    const embeddings = [];
    for (const text of texts) {
      if (text && typeof text === 'string' && text.trim().length > 0) {
        const embedding = await generateEmbedding(text);
        embeddings.push(embedding);
      } else {
        embeddings.push(null);
      }
    }

    return embeddings;
  } catch (error) {
    if (!EMBEDDING_SILENT_MODE) {
      console.error('Error generating batch embeddings:', error.message);
    }
    return texts.map(() => null);
  }
}

/**
 * Convert embedding array to PostgreSQL vector format string
 * @param {number[]} embedding - Embedding vector array
 * @returns {string} - PostgreSQL vector format: '[0.1,0.2,0.3,...]'
 */
export function embeddingToVectorString(embedding) {
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }
  return '[' + embedding.join(',') + ']';
}

