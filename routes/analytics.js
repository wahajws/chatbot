import express from 'express';
import { getSuggestedCharts, getDashboardStats } from '../services/analyticsService.js';
import { generateSQLFromQuestion, executeSQLQuery, formatQueryResults } from '../services/sqlGenerator.js';
import { getLLMResponse } from '../services/llmService.js';
import { getSchema } from '../services/schemaCache.js';

const router = express.Router();

/**
 * GET /api/analytics/charts
 * Get AI-suggested charts with data
 */
router.get('/charts', async (req, res) => {
  try {
    console.log('[Analytics API] Fetching suggested charts...');
    const result = await getSuggestedCharts();
    
    res.json({
      success: true,
      charts: result.charts,
      suggestions: result.suggestions,
      count: result.charts.length
    });
  } catch (error) {
    console.error('[Analytics API] Error fetching charts:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      charts: [],
      suggestions: []
    });
  }
});

/**
 * GET /api/analytics/stats
 * Get dashboard statistics
 */
router.get('/stats', async (req, res) => {
  try {
    console.log('[Analytics API] Fetching dashboard stats...');
    const stats = await getDashboardStats();
    
    if (!stats) {
      return res.status(503).json({
        success: false,
        error: 'Database unavailable',
        message: 'Cannot fetch statistics. Database may be unavailable.'
      });
    }
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('[Analytics API] Error fetching stats:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/analytics/query
 * Process natural language query and return chart data
 */
router.post('/query', async (req, res) => {
  try {
    const { query, chartType } = req.body;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    console.log('[Analytics API] Processing natural language query:', query.substring(0, 50));

    // Get database schema for context
    const schema = await getSchema(true);
    const schemaSummary = schema ? 
      `Database has ${schema.totalTables} tables. Largest tables: ${schema.tables.slice(0, 5).map(t => `${t.name} (${t.rowCount} rows)`).join(', ')}` 
      : '';

    // Generate SQL from natural language
    const sqlQuery = await generateSQLFromQuestion(query, schemaSummary);
    
    if (!sqlQuery) {
      return res.status(400).json({
        success: false,
        error: 'Could not generate SQL query from your question'
      });
    }

    // Log the generated SQL for debugging (full query)
    console.log('[Analytics API] Generated SQL (full):', sqlQuery);
    console.log('[Analytics API] Generated SQL (preview):', sqlQuery.substring(0, 300));

    // Execute SQL query
    const queryResult = await executeSQLQuery(sqlQuery);
    
    if (queryResult && queryResult.error) {
      console.error('[Analytics API] SQL execution error:', queryResult.error);
      console.error('[Analytics API] Failed SQL:', sqlQuery);
      
      // Provide more helpful error messages
      let userFriendlyError = queryResult.error;
      if (queryResult.error.includes('syntax error')) {
        userFriendlyError = 'The generated SQL query has a syntax error. Please try rephrasing your question or be more specific.';
      } else if (queryResult.error.includes('does not exist')) {
        userFriendlyError = 'The query references tables or columns that don\'t exist. Please try a different question.';
      }
      
      return res.status(400).json({
        success: false,
        error: userFriendlyError,
        details: queryResult.error,
        sql: sqlQuery.substring(0, 300) // Include SQL for debugging
      });
    }
    
    if (!queryResult || !queryResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to execute query',
        sql: sqlQuery.substring(0, 200)
      });
    }

    if (!queryResult.rows || queryResult.rows.length === 0) {
      return res.json({
        success: true,
        chart: null,
        message: 'Query executed successfully but returned no data',
        sql: sqlQuery
      });
    }

    // Convert to chart format
    const rows = queryResult.rows;
    const columns = Object.keys(rows[0]);
    
    // Find name and value columns
    let nameCol = columns.find(c => /name|label|title|category|type|status|date|month|day|year/i.test(c)) || columns[0];
    let valueCol = columns.find(c => /count|total|sum|amount|value|quantity|sales|revenue/i.test(c)) || columns[1];
    
    // Handle multiple value columns (for year-on-year comparisons)
    const valueCols = columns.filter(c => 
      /count|total|sum|amount|value|quantity|sales|revenue|2024|2025/i.test(c)
    );

    let chartData;
    let chartTypeDetected = chartType || 'bar';

    if (valueCols.length > 1) {
      // Multiple value columns - use all of them (for grouped charts)
      chartData = rows.slice(0, 20).map(row => {
        const dataPoint = { name: String(row[nameCol] || '').trim() };
        valueCols.forEach(col => {
          const rawValue = row[col];
          const value = typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || parseInt(rawValue) || 0);
          dataPoint[col] = Math.abs(value);
        });
        return dataPoint;
      }).filter(d => d.name);
      // Use 'yearonyear' if columns suggest year comparison, otherwise 'bar' for grouped bars
      const hasYearColumns = valueCols.some(col => /2024|2025|year/i.test(col));
      chartTypeDetected = hasYearColumns ? 'yearonyear' : 'bar';
    } else {
      // Single value column
      chartData = rows.slice(0, 20).map(row => {
        const name = String(row[nameCol] || '').trim();
        const rawValue = row[valueCol];
        const value = typeof rawValue === 'number' ? rawValue : (parseFloat(rawValue) || parseInt(rawValue) || 0);
        
        if (name && !isNaN(value)) {
          return {
            name: name.length > 25 ? name.substring(0, 22) + '...' : name,
            value: Math.abs(value)
          };
        }
        return null;
      }).filter(Boolean);

      // Auto-detect chart type based on data
      if (rows.length > 0 && /date|time|month|day|year/i.test(nameCol)) {
        chartTypeDetected = 'line';
      } else if (rows.length <= 10) {
        chartTypeDetected = 'pie';
      }
    }

    if (chartData.length === 0) {
      return res.json({
        success: true,
        chart: null,
        message: 'Query executed but could not format data for chart',
        sql: sqlQuery
      });
    }

    res.json({
      success: true,
      chart: {
        title: query,
        type: chartTypeDetected,
        description: `Generated from: "${query}"`,
        data: chartData,
        sql: sqlQuery
      }
    });
  } catch (error) {
    console.error('[Analytics API] Error processing query:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/analytics/insights
 * Generate AI insights from chart data
 */
router.post('/insights', async (req, res) => {
  try {
    const { chart, query } = req.body;
    
    if (!chart || !chart.data || chart.data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Chart data is required'
      });
    }

    console.log('[Analytics API] Generating AI insights for chart...');

    // Format chart data for LLM
    const dataSummary = chart.data.slice(0, 15).map((d, idx) => {
      if (d.value !== undefined) {
        return `${idx + 1}. ${d.name}: ${typeof d.value === 'number' ? d.value.toLocaleString() : d.value}`;
      } else {
        // Multiple value columns
        const values = Object.keys(d).filter(k => k !== 'name').map(k => `${k}: ${d[k]}`).join(', ');
        return `${idx + 1}. ${d.name}: ${values}`;
      }
    }).join('\n');

    const insightPrompt = `Analyze this chart data and provide insights:

Chart Title: ${chart.title || 'Analytics Chart'}
Chart Type: ${chart.type}
User Query: ${query || 'N/A'}

Data:
${dataSummary}

Provide:
1. Key findings (2-3 bullet points)
2. Notable patterns or trends
3. Any anomalies or outliers
4. Actionable recommendations (if applicable)

Format as a clear, concise analysis. Be specific with numbers.`;

    const insights = await getLLMResponse(insightPrompt, [], null);

    res.json({
      success: true,
      insights: insights.trim()
    });
  } catch (error) {
    console.error('[Analytics API] Error generating insights:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate insights',
      message: error.message
    });
  }
});

/**
 * GET /api/analytics/suggestions
 * Get smart query suggestions based on database schema
 */
router.get('/suggestions', async (req, res) => {
  try {
    console.log('[Analytics API] Generating smart suggestions...');
    
    let schema;
    try {
      schema = await getSchema(true);
    } catch (schemaError) {
      console.log('[Analytics API] Schema fetch failed, using fallback suggestions:', schemaError.message);
      // Return business-friendly fallback suggestions
      const fallbackSuggestions = [
        'Show me sales trends over the last 6 months',
        'What are the top 5 outlets by total sales?',
        'Compare this year\'s sales to last year',
        'Which products are selling the most this month?',
        'Show me how sales are distributed by outlet',
        'What are the best performing outlets?',
        'Show me monthly sales comparison',
        'Which day of the week has the most sales?'
      ];
      return res.json({
        success: true,
        suggestions: fallbackSuggestions
      });
    }
    
    if (!schema || !schema.tables || schema.tables.length === 0) {
      console.log('[Analytics API] No schema available, using fallback suggestions');
      const fallbackSuggestions = [
        'Show me sales trends over the last 6 months',
        'What are the top 5 outlets by total sales?',
        'Compare this year\'s sales to last year',
        'Which products are selling the most this month?',
        'Show me how sales are distributed by outlet',
        'What are the best performing outlets?',
        'Show me monthly sales comparison',
        'Which day of the week has the most sales?'
      ];
      return res.json({
        success: true,
        suggestions: fallbackSuggestions
      });
    }

    // Find significant tables
    const significantTables = schema.tables
      .filter(table => table.rowCount > 10)
      .slice(0, 10)
      .map(table => ({
        name: table.name,
        rowCount: table.rowCount,
        columns: table.columns.map(c => c.name)
      }));

    const schemaSummary = significantTables.map(t => 
      `Table: ${t.name} (${t.rowCount} rows) - Columns: ${t.columns.slice(0, 8).join(', ')}`
    ).join('\n');

    // Identify key business entities from table names
    const businessEntities = {
      sales: significantTables.filter(t => /sales|revenue|amount|quantity/i.test(t.name)),
      outlets: significantTables.filter(t => /outlet|store|location/i.test(t.name)),
      products: significantTables.filter(t => /product|sku|item|bundle/i.test(t.name)),
      orders: significantTables.filter(t => /order|delivery|transaction/i.test(t.name)),
      targets: significantTables.filter(t => /target|goal|gis/i.test(t.name)),
      time: significantTables.filter(t => /date|month|year|day|calendar/i.test(t.name))
    };

    const entitySummary = Object.entries(businessEntities)
      .filter(([_, tables]) => tables.length > 0)
      .map(([entity, tables]) => `${entity}: ${tables.map(t => t.name).join(', ')}`)
      .join('\n');

    const suggestionPrompt = `You are helping business users explore their data. Based on this database schema, suggest 8 simple, clear questions in plain English that non-technical users would ask.

CRITICAL RULES:
1. Write ONLY in plain English - like talking to a colleague
2. NO SQL queries, NO technical terms like "SELECT", "JOIN", "GROUP BY"
3. Use simple business language
4. Make questions specific and actionable
5. Focus on insights users care about: trends, comparisons, top performers, distributions

Good examples:
- "Show me sales trends over the last 6 months"
- "What are the top 5 outlets by total sales?"
- "Compare this year's sales to last year"
- "Which products are selling the most this month?"
- "Show me how sales are distributed by outlet"

Bad examples (DO NOT USE):
- "SELECT outlet_id, SUM(sales_qty)..." (SQL query)
- "Query the sales table grouped by month" (too technical)
- "Get data from bat_ref_sales_history_d" (table names)

Database contains:
${entitySummary}

Key tables: ${significantTables.slice(0, 5).map(t => t.name).join(', ')}

Return ONLY a JSON array of 8 simple English questions:
["Question 1", "Question 2", "Question 3", "Question 4", "Question 5", "Question 6", "Question 7", "Question 8"]`;

    try {
      const llmResponse = await getLLMResponse(suggestionPrompt, [], null);
      
      // Extract JSON array from response
      const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        let suggestions = JSON.parse(jsonMatch[0]);
        
        // Filter out SQL queries and ensure we have English questions
        suggestions = suggestions
          .map(s => String(s).trim())
          .filter(s => {
            // Reject if it looks like SQL
            const upper = s.toUpperCase();
            const sqlKeywords = ['SELECT', 'WITH', 'FROM ', 'WHERE ', 'GROUP BY', 'ORDER BY', 'JOIN ', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'HAVING', 'LIMIT', 'UNION', 'INSERT', 'UPDATE', 'DELETE'];
            if (sqlKeywords.some(keyword => upper.includes(keyword))) {
              console.log('[Analytics API] Filtered out SQL-like suggestion:', s.substring(0, 50));
              return false;
            }
            // Reject function calls like COUNT(...), SUM(...), etc.
            if (s.match(/^[A-Z_]+\s*\(/) || s.match(/\b(COUNT|SUM|AVG|MAX|MIN|EXTRACT|DATE_TRUNC)\s*\(/i)) {
              console.log('[Analytics API] Filtered out function call:', s.substring(0, 50));
              return false;
            }
            // Reject table/column names (usually uppercase with underscores)
            if (s.match(/^[A-Z_][A-Z0-9_]*$/) && s.length > 5) {
              console.log('[Analytics API] Filtered out table name:', s);
              return false;
            }
            // Must be a readable question or statement in English
            if (s.length < 15 || s.length > 150) {
              return false;
            }
            // Should contain common question words or action verbs
            const hasQuestionWords = /^(what|which|show|compare|list|find|how|when|where|who)/i.test(s);
            const hasActionWords = /(show|display|compare|list|find|get|see|view)/i.test(s);
            if (!hasQuestionWords && !hasActionWords) {
              console.log('[Analytics API] Filtered out - not a question:', s.substring(0, 50));
              return false;
            }
            return true;
          })
          .slice(0, 8);
        
        if (suggestions.length > 0) {
          // Final cleanup: make suggestions more user-friendly
          const cleanedSuggestions = suggestions.map(s => {
            // Remove any remaining technical terms
            let cleaned = s
              .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|JOIN|COUNT|SUM|AVG)\b/gi, '')
              .replace(/\b(table|column|database|query|sql)\b/gi, '')
              .replace(/\([^)]*\)/g, '') // Remove parentheses with content
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim();
            
            // Ensure it starts with a question word or action verb
            if (!/^(what|which|show|compare|list|find|how|when|where|who|display|get|see|view)/i.test(cleaned)) {
              cleaned = 'Show me ' + cleaned.toLowerCase();
            }
            
            // Capitalize first letter
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            
            // Ensure it ends with proper punctuation
            if (!/[?.!]$/.test(cleaned)) {
              cleaned += '?';
            }
            
            return cleaned;
          }).filter(s => s.length >= 15 && s.length <= 150);
          
          if (cleanedSuggestions.length > 0) {
            return res.json({
              success: true,
              suggestions: cleanedSuggestions.slice(0, 8)
            });
          }
        }
      }
    } catch (llmError) {
      console.log('[Analytics API] LLM suggestions failed, using fallback:', llmError.message);
    }

    // Business-friendly fallback suggestions
    const fallbackSuggestions = [
      'Show me sales trends over the last 6 months',
      'What are the top 5 outlets by total sales?',
      'Compare this year\'s sales to last year',
      'Which products are selling the most this month?',
      'Show me how sales are distributed by outlet',
      'What are the best performing outlets?',
      'Show me monthly sales comparison',
      'Which day of the week has the most sales?'
    ];

    res.json({
      success: true,
      suggestions: fallbackSuggestions
    });
  } catch (error) {
    console.error('[Analytics API] Error generating suggestions:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions',
      message: error.message
    });
  }
});

export default router;









