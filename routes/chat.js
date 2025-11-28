import express from 'express';
import { getLLMResponse } from '../services/llmService.js';
import { formatResponse } from '../services/responseFormatter.js';
import { getDatabaseSchema, getDatabaseSummary } from '../services/databaseService.js';
import { generateSQLFromQuestion, executeSQLQuery, formatQueryResults } from '../services/sqlGenerator.js';
import { getSchema, generateBusinessContext } from '../services/schemaCache.js';
import { getDataProfiling, formatProfilingSummary } from '../services/dataProfilingService.js';
import { executeSmartQuery, detectOrderTable, detectDateColumn } from '../services/smartQueryService.js';
import pool from '../config/database.js';

let params = {}; // For passing parameters to smart queries

/**
 * Generate fallback SQL for common question patterns when LLM fails
 */
function generateFallbackSQL(question, databaseContext) {
  const questionLower = question.toLowerCase();
  
  // Orders grouped by month - try multiple table/column name variations
  if (questionLower.includes('grouped by month') || questionLower.includes('group by month') || 
      (questionLower.includes('orders') && questionLower.includes('month'))) {
    // Try delivery_orders (with underscore) first, then deliveryorders
    return `SELECT EXTRACT(YEAR FROM COALESCE(createdat, created_at)) as year, EXTRACT(MONTH FROM COALESCE(createdat, created_at)) as month, COUNT(*) as ordercount FROM delivery_orders GROUP BY EXTRACT(YEAR FROM COALESCE(createdat, created_at)), EXTRACT(MONTH FROM COALESCE(createdat, created_at)) ORDER BY year, month`;
  }
  
  // Orders grouped by day
  if (questionLower.includes('grouped by day') || questionLower.includes('group by day') ||
      (questionLower.includes('orders') && questionLower.includes('day'))) {
    return `SELECT DATE(COALESCE(createdat, created_at)) as day, COUNT(*) as ordercount FROM deliveryorders GROUP BY DATE(COALESCE(createdat, created_at)) ORDER BY day DESC`;
  }
  
  // List delivery orders with details
  if (questionLower.includes('list delivery orders') && questionLower.includes('details')) {
    return `SELECT do.*, dod.* FROM deliveryorders do JOIN deliveryorderdetails dod ON do.id = dod.deliveryorderid AND do.accountid = dod.accountid LIMIT 20`;
  }
  
  return null;
}

/**
 * Generate simpler fallback SQL if complex one fails (tries to find correct column names)
 */
function generateSimplerFallbackSQL(question) {
  const questionLower = question.toLowerCase();
  
  if (questionLower.includes('grouped by month') || questionLower.includes('group by month') || 
      (questionLower.includes('orders') && questionLower.includes('month'))) {
    // Try delivery_orders (with underscore) first, then deliveryorders
    // Try with created_at first (most common)
    return `SELECT EXTRACT(YEAR FROM created_at) as year, EXTRACT(MONTH FROM created_at) as month, COUNT(*) as ordercount FROM delivery_orders GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at) ORDER BY year, month`;
  }
  
  return null;
}

const router = express.Router();

/**
 * POST /api/chat
 * Accepts a simple message and returns LLM response
 * Body: { message: string, conversationId?: number }
 */
router.post('/', async (req, res) => {
  try {
    console.log('[Chat API] Received request:', { 
      message: req.body.message?.substring(0, 50) + '...', 
      conversationId: req.body.conversationId 
    });
    
    const { message, conversationId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.log('[Chat API] Validation failed: empty message');
      return res.status(400).json({
        error: 'Message is required and must be a non-empty string'
      });
    }
    
    console.log('[Chat API] Message validated, processing...');

    // Get conversation history if conversationId is provided
    let conversationHistory = [];
    if (conversationId) {
      const historyResult = await pool.query(
        `SELECT message, response FROM messages 
         WHERE id <= $1 
         ORDER BY id ASC 
         LIMIT 10`,
        [conversationId]
      );
      
      historyResult.rows.forEach((row) => {
        if (row.message) {
          conversationHistory.push({ role: 'user', content: row.message });
        }
        if (row.response) {
          conversationHistory.push({ role: 'assistant', content: row.response });
        }
      });
    }

    // Get database context - use enhanced schema with relationships and business context
    console.log('[Chat API] Loading enhanced database schema from cache...');
    let databaseContext = '';
    
    try {
      // Load cached schema (JSON format) - stored on server startup
      const cachedSchema = await getSchema(true); // Use cache if available
      
      if (cachedSchema && cachedSchema.tables && cachedSchema.tables.length > 0) {
        console.log('[Chat API] Using cached schema:', {
          totalTables: cachedSchema.totalTables,
          cachedAt: cachedSchema.cachedAt
        });
        
        // Generate comprehensive business context with relationships
        const businessContext = generateBusinessContext(cachedSchema);
        databaseContext = businessContext + '\n\n';
        
        // Add data profiling for better understanding (async, don't block if it fails)
        try {
          const profiling = await getDataProfiling(true);
          if (profiling) {
            const profilingSummary = formatProfilingSummary(profiling);
            if (profilingSummary) {
              databaseContext += profilingSummary + '\n\n';
            }
          }
        } catch (profilingError) {
          console.log('[Chat API] Data profiling not available:', profilingError.message);
          // Continue without profiling - not critical
        }
      } else {
        // Fallback to fetching schema if cache not available
        console.log('[Chat API] Cache not available or empty, fetching fresh schema...');
        try {
          const schema = await getDatabaseSchema();
          databaseContext += schema + '\n\n';
        } catch (schemaError) {
          console.log('[Chat API] Error fetching schema:', schemaError.message);
          databaseContext = 'Database schema not available. Please ensure database is connected.\n\n';
        }
      }
    } catch (schemaError) {
      console.log('[Chat API] Error loading schema cache:', schemaError.message);
      // Try fallback
      try {
        const schema = await getDatabaseSchema();
        databaseContext += schema + '\n\n';
      } catch (fallbackError) {
        console.log('[Chat API] Fallback schema fetch also failed:', fallbackError.message);
        databaseContext = 'Database schema not available. Please ensure database is connected.\n\n';
      }
    }
    
    // Check if this is a follow-up question that needs context from previous messages
    const isFollowUp = /^(yes|yeah|yep|sure|ok|alright|do it|go ahead|please|tell me more|show me|give me|what|which|how|when|where|who) (was|is|are|were|about|for|the|this|that)/i.test(message) ||
                       /^(yes|yeah|yep|sure|ok|alright|do it|go ahead|please)$/i.test(message.trim());
    
    // If follow-up, try to extract context from recent conversation
    let enhancedMessage = message;
    if (isFollowUp && conversationHistory.length > 0) {
      // Get the last user question from history
      const lastUserMessages = conversationHistory.filter(m => m.role === 'user').slice(-2);
      if (lastUserMessages.length > 0) {
        const lastQuestion = lastUserMessages[lastUserMessages.length - 1].content || lastUserMessages[lastUserMessages.length - 1].message;
        // Enhance the follow-up with context
        if (message.toLowerCase().includes('time') || message.toLowerCase().includes('when')) {
          enhancedMessage = `${lastQuestion}. ${message}. Show the actual time/date information.`;
        } else if (message.toLowerCase().includes('more') || message.toLowerCase().includes('details') || message.toLowerCase().includes('information')) {
          enhancedMessage = `${lastQuestion}. ${message}. Provide detailed information.`;
        } else if (message.toLowerCase().includes('do it') || message.toLowerCase() === 'yes') {
          enhancedMessage = `${lastQuestion}. Execute this query and show results.`;
        } else {
          enhancedMessage = `${lastQuestion}. ${message}`;
        }
      }
    }
    
    // Simplified flow: User query -> LLM generates SQL -> Execute -> Return results
    console.log('[Chat API] Processing query with LLM SQL generation...');
    
    // Check if this is a question that MUST have SQL (list, show, which, best, etc.)
    const mustHaveSQL = /^(list|show|display|give me|tell me|which|what|how many|how much|best|top|most|highest|lowest|grouped|group|breakdown|total|revenue|growth|rate)/i.test(message.trim());
    
    // Try smart query service FIRST for complex questions (runs in parallel with LLM)
    const questionLower = message.toLowerCase();
    let smartQueryPattern = null;
    let smartQueryParams = {};
    
    if (questionLower.includes('grouped by month') || questionLower.includes('group by month') || 
        (questionLower.includes('orders') && questionLower.includes('month') && !questionLower.includes('growth'))) {
      smartQueryPattern = 'orders_grouped_by_month';
    } else if (questionLower.includes('breakdown') && questionLower.includes('status') && 
               (questionLower.includes('current month') || questionLower.includes('this month'))) {
      smartQueryPattern = 'orders_by_status';
    } else if (questionLower.includes('revenue per customer') || questionLower.includes('revenue per account') ||
               (questionLower.includes('total revenue') && questionLower.includes('customer'))) {
      const minOrdersMatch = message.match(/more than (\d+)/i) || message.match(/>\s*(\d+)/i);
      smartQueryParams.minOrders = minOrdersMatch ? parseInt(minOrdersMatch[1]) : 5;
      smartQueryPattern = 'revenue_per_customer';
    } else if (questionLower.includes('month-over-month') || questionLower.includes('month over month') ||
               questionLower.includes('growth rate')) {
      const monthsMatch = message.match(/last (\d+)/i);
      smartQueryParams.months = monthsMatch ? parseInt(monthsMatch[1]) : 6;
      smartQueryPattern = 'month_over_month_growth';
    } else if (questionLower.includes('quantity greater than') || 
               (questionLower.includes('items') && questionLower.includes('quantity'))) {
      const qtyMatch = message.match(/quantity (?:greater than|>|more than) (\d+)/i);
      smartQueryParams.minQuantity = qtyMatch ? parseInt(qtyMatch[1]) : 10;
      smartQueryPattern = 'orders_with_high_quantity';
    }
    
    // Always try to generate and execute SQL query
    let sqlQueryResult = null;
    let sqlQuery = null;
    let sqlGenerationAttempts = 0;
    const maxAttempts = mustHaveSQL ? 2 : 1; // Retry once for critical questions
    
    // Try smart query in parallel (if pattern detected)
    let smartQueryPromise = null;
    if (smartQueryPattern) {
      console.log(`[Chat API] Attempting smart query for pattern: ${smartQueryPattern}`, smartQueryParams);
      smartQueryPromise = executeSmartQuery(smartQueryPattern, smartQueryParams).catch(err => {
        console.log('[Chat API] Smart query error:', err.message);
        return null;
      });
    }
    
    while (sqlGenerationAttempts < maxAttempts && !sqlQuery) {
      try {
        sqlGenerationAttempts++;
        console.log(`[Chat API] Generating SQL query (attempt ${sqlGenerationAttempts}/${maxAttempts})...`);
        // Use LLM to generate SQL query from the question
        sqlQuery = await generateSQLFromQuestion(enhancedMessage, databaseContext);
        
        if (sqlQuery) {
          console.log('[Chat API] Generated SQL:', sqlQuery);
          break; // Success, exit retry loop
        } else if (mustHaveSQL && sqlGenerationAttempts < maxAttempts) {
          console.log('[Chat API] No SQL generated, retrying with enhanced prompt...');
          // Add emphasis for retry
          enhancedMessage = `IMPORTANT: Generate a SQL query to answer this question: ${message}. This requires executing a query, not just explaining.`;
        }
      } catch (error) {
        console.log(`[Chat API] SQL generation attempt ${sqlGenerationAttempts} failed:`, error.message);
        if (sqlGenerationAttempts >= maxAttempts) {
          break; // Give up after max attempts
        }
      }
    }
    
    if (sqlQuery) {
      try {
        // Execute the generated SQL query
        console.log('[Chat API] Executing SQL query...');
        sqlQueryResult = await executeSQLQuery(sqlQuery);
        
        if (sqlQueryResult && sqlQueryResult.success) {
          console.log('[Chat API] SQL query executed successfully, rows:', sqlQueryResult.rowCount);
          
          // Format results for LLM context - PUT THIS FIRST so it's prioritized
          const formattedResults = formatQueryResults(sqlQueryResult);
          if (formattedResults) {
            console.log('[Chat API] Formatted query results, length:', formattedResults.length);
            // Put query results at the top for maximum visibility
            databaseContext = formattedResults + '\n\n' + databaseContext;
          }
        } else if (sqlQueryResult && sqlQueryResult.error) {
          console.log('[Chat API] SQL query failed:', sqlQueryResult.error);
          // If query failed, include error in context so LLM can explain
          databaseContext += `Query execution error: ${sqlQueryResult.error}\n\n`;
        }
      } catch (error) {
        // Handle SQL execution errors gracefully
        const isConnectionError = error.code === 'ETIMEDOUT' || 
                                 error.code === 'EHOSTUNREACH' || 
                                 error.code === 'ECONNREFUSED';
        console.log('[Chat API] SQL execution error:', {
          message: error.message,
          code: error.code,
          isConnectionError
        });
        if (!isConnectionError) {
          databaseContext += `Query execution error: ${error.message}\n\n`;
        }
      }
    } else {
      console.log('[Chat API] No SQL query generated after', sqlGenerationAttempts, 'attempt(s)');
    }
    
    // Check smart query result (if it was running in parallel)
    if (smartQueryPromise && (!sqlQueryResult || !sqlQueryResult.success)) {
      try {
        const smartResult = await smartQueryPromise;
        if (smartResult && smartResult.success) {
          console.log('[Chat API] Smart query executed successfully, rows:', smartResult.rowCount);
          const formattedResults = formatQueryResults(smartResult);
          if (formattedResults) {
            console.log('[Chat API] Formatted smart query results, length:', formattedResults.length);
            databaseContext = formattedResults + '\n\n' + databaseContext;
            sqlQueryResult = smartResult; // Mark as successful
          }
        } else if (smartResult && smartResult.error) {
          console.log('[Chat API] Smart query failed:', smartResult.error);
        }
      } catch (error) {
        console.log('[Chat API] Smart query error:', error.message);
      }
    }
    
    // If still no results and mustHaveSQL, try fallback
    if (mustHaveSQL && (!sqlQueryResult || !sqlQueryResult.success)) {
      console.log('[Chat API] Attempting fallback SQL generation for critical question...');
      const fallbackSQL = generateFallbackSQL(message, databaseContext);
      if (fallbackSQL) {
        console.log('[Chat API] Fallback SQL generated:', fallbackSQL);
        sqlQuery = fallbackSQL;
        // Try to execute the fallback SQL
        try {
          sqlQueryResult = await executeSQLQuery(sqlQuery);
          if (sqlQueryResult && sqlQueryResult.success) {
            console.log('[Chat API] Fallback SQL executed successfully, rows:', sqlQueryResult.rowCount);
            const formattedResults = formatQueryResults(sqlQueryResult);
            if (formattedResults) {
              console.log('[Chat API] Formatted fallback results, length:', formattedResults.length);
              // Put query results at the top for maximum visibility
              databaseContext = formattedResults + '\n\n' + databaseContext;
            }
          } else if (sqlQueryResult && sqlQueryResult.error) {
            console.log('[Chat API] Fallback SQL execution failed:', sqlQueryResult.error);
            // Try simpler query if complex one fails
            const simplerSQL = generateSimplerFallbackSQL(message);
            if (simplerSQL) {
              console.log('[Chat API] Trying simpler fallback SQL:', simplerSQL);
              const simplerResult = await executeSQLQuery(simplerSQL);
              if (simplerResult && simplerResult.success) {
                const formattedResults = formatQueryResults(simplerResult);
                if (formattedResults) {
                  databaseContext = formattedResults + '\n\n' + databaseContext;
                  sqlQueryResult = simplerResult;
                }
              }
            }
          }
        } catch (error) {
          console.log('[Chat API] Fallback SQL execution error:', error.message);
          // Try simpler query
          const simplerSQL = generateSimplerFallbackSQL(message);
          if (simplerSQL) {
            try {
              const simplerResult = await executeSQLQuery(simplerSQL);
              if (simplerResult && simplerResult.success) {
                const formattedResults = formatQueryResults(simplerResult);
                if (formattedResults) {
                  databaseContext = formattedResults + '\n\n' + databaseContext;
                  sqlQueryResult = simplerResult;
                }
              }
            } catch (e) {
              console.log('[Chat API] Simpler fallback also failed:', e.message);
            }
          }
        }
      } else {
        databaseContext += `NOTE: A SQL query should have been generated for this question but was not. Please try to answer using the schema information provided.\n\n`;
      }
    }
    
    // Add database summary for context (if no query results)
    if (!sqlQueryResult || !sqlQueryResult.success) {
      try {
        const summary = await getDatabaseSummary();
        if (summary) {
          databaseContext += summary;
        }
      } catch (error) {
        // Silently handle summary errors - not critical
      }
    }

    // Get LLM response with database context
    console.log('[Chat API] Calling LLM with context length:', databaseContext.length);
    console.log('[Chat API] Conversation history length:', conversationHistory.length);
    let llmResponse;
    try {
      llmResponse = await getLLMResponse(message, conversationHistory, databaseContext);
      console.log('[Chat API] LLM response received, length:', llmResponse?.length || 0);
    } catch (error) {
      console.error('[Chat API] LLM API error:', {
        message: error.message,
        code: error.code,
        response: error.response?.data
      });
      
      // Handle LLM API errors gracefully
      const isNetworkError = error.message?.includes('ENOTFOUND') || 
                            error.message?.includes('ETIMEDOUT') ||
                            error.message?.includes('ECONNREFUSED');
      
      if (isNetworkError) {
        console.log('[Chat API] Network error detected, returning 503');
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          message: 'Unable to connect to LLM service. Please check your internet connection and try again.'
        });
      }
      
      // Re-throw other errors to be handled by error middleware
      throw error;
    }
    
    // Check if user EXPLICITLY requested a chart (not just any question)
    const isChartRequest = /chart|graph|visualiz|visualization|visualize|bar\s+chart|bar\s+graph|plot|diagram|generate.*chart/i.test(message);
    console.log('[Chat API] Is chart request?', isChartRequest);
    
    let chartData = null;
    
    // If chart is requested, try to generate chart data from SQL results
    if (isChartRequest) {
      console.log('[Chat API] Chart requested, checking SQL results...');
      console.log('[Chat API] SQL result status:', {
        hasResult: !!sqlQueryResult,
        success: sqlQueryResult?.success,
        rowCount: sqlQueryResult?.rows?.length || 0
      });
      
      // If we have SQL results, convert them to chart format
      if (sqlQueryResult && sqlQueryResult.success && sqlQueryResult.rows && sqlQueryResult.rows.length > 0) {
        console.log('[Chat API] Converting SQL results to chart data...');
        const rows = sqlQueryResult.rows;
        const columns = Object.keys(rows[0]);
        console.log('[Chat API] Available columns:', columns);
        
        // Try to find name and value columns (expanded patterns)
        let nameCol = columns.find(c => /name|label|title|category|city|state|day|date|product|customer|type|status|delivery|order|detail|item|description|id/i.test(c));
        let valueCol = columns.find(c => /count|total|sum|amount|revenue|sales|quantity|value|price|orders|qty|number|num|size|volume/i.test(c));
        
        // If no value column found, look for numeric columns
        if (!valueCol) {
          valueCol = columns.find((c, idx) => {
            if (idx === 0 && nameCol) return false; // Skip if it's the name column
            const firstValue = rows[0]?.[c];
            return typeof firstValue === 'number' || !isNaN(parseFloat(firstValue));
          });
        }
        
        // Fallback to first two columns
        if (!nameCol && columns.length > 0) nameCol = columns[0];
        if (!valueCol && columns.length > 1) valueCol = columns[1];
        if (!valueCol && columns.length > 0 && nameCol !== columns[0]) valueCol = columns[0];
        
        console.log('[Chat API] Selected columns for chart:', { nameCol, valueCol });
        
        if (nameCol && valueCol && nameCol !== valueCol) {
          const chartRows = rows.slice(0, 20).map((row, idx) => {
            const name = String(row[nameCol] || row[nameCol.toLowerCase()] || `Item ${idx + 1}`).trim();
            const rawValue = row[valueCol] || row[valueCol.toLowerCase()];
            const value = typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || parseInt(rawValue) || 0);
            
            if (name && !isNaN(value)) {
              return {
                name: name.length > 30 ? name.substring(0, 27) + '...' : name,
                value: Math.abs(value) // Use absolute value
              };
            }
            return null;
          }).filter(Boolean);
          
          console.log('[Chat API] Generated chart rows:', chartRows.length);
          
          if (chartRows.length > 0) {
            chartData = {
              type: 'bar',
              data: chartRows,
              title: message.replace(/^(show|display|graph|chart|can you generate|create|generate)\s+(me\s+)?(a\s+)?(bar\s+)?/i, '').trim() || 'Chart Data'
            };
            console.log('[Chat API] Chart data created successfully:', {
              type: chartData.type,
              dataPoints: chartData.data.length,
              title: chartData.title
            });
          } else {
            console.log('[Chat API] No valid chart rows generated from SQL results');
          }
        } else {
          console.log('[Chat API] Could not find suitable columns for chart:', { nameCol, valueCol, columns });
        }
      } else {
        console.log('[Chat API] No SQL results available for chart generation');
        // If no SQL results but chart was requested, the LLM should have generated SQL
        // This might mean the SQL query failed or wasn't generated
      }
    }
    
    // Format and clean the response
    console.log('[Chat API] Formatting response...');
    llmResponse = formatResponse(llmResponse);
    console.log('[Chat API] Formatted response, length:', llmResponse.length);

    // Save to database
    console.log('[Chat API] Saving message to database...');
    const result = await pool.query(
      `INSERT INTO messages (message, response) 
       VALUES ($1, $2) 
       RETURNING id, created_at`,
      [message, llmResponse]
    );

    const savedMessage = result.rows[0];
    console.log('[Chat API] Message saved with ID:', savedMessage.id);
    
    // Note: Vector database/embeddings are disabled per user request

    console.log('[Chat API] Sending response to client:', {
      id: savedMessage.id,
      responseLength: llmResponse.length,
      hasChartData: !!chartData
    });
    
    res.json({
      success: true,
      id: savedMessage.id,
      message: message,
      response: llmResponse,
      createdAt: savedMessage.created_at,
      chartData: chartData || null
    });
      } catch (error) {
        console.error('[Chat API] Error in chat endpoint:', {
          message: error.message,
          stack: error.stack,
          code: error.code,
          errno: error.errno
        });
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });

/**
 * GET /api/chat/history
 * Get chat history
 * Query params: limit (default: 20), offset (default: 0)
 */
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, message, response, created_at 
       FROM messages 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      messages: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/chat/:id
 * Get a specific message by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT id, message, response, created_at 
       FROM messages 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;


