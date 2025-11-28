import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ALIBABA_API_KEY = process.env.ALIBABA_LLM_API_KEY;
const ALIBABA_API_BASE_URL = process.env.ALIBABA_LLM_API_BASE_URL;
const ALIBABA_MODEL = process.env.ALIBABA_LLM_API_MODEL || 'qwen-plus';

/**
 * Get response from Alibaba LLM API
 * @param {string} message - User message
 * @param {Array} conversationHistory - Previous conversation messages (optional)
 * @param {string} databaseContext - Context from database search (optional)
 * @returns {Promise<string>} - LLM response
 */
export async function getLLMResponse(message, conversationHistory = [], databaseContext = null) {
  try {
    console.log('[LLM Service] Getting LLM response...', {
      messageLength: message.length,
      historyLength: conversationHistory.length,
      contextLength: databaseContext?.length || 0
    });
    
    const messages = [];
    
    // Check if user EXPLICITLY asked for a chart (not just any question)
    const isChartRequest = /chart|graph|visualiz|visualization|visualize|bar\s+chart|bar\s+graph|plot|diagram/i.test(message);
    console.log('[LLM Service] Is chart request?', isChartRequest);
    
    // Add system message with database context if available
    if (databaseContext) {
      // Check if query results are present (most important data)
      const hasQueryResults = databaseContext.includes('QUERY RESULTS:');
      const queryResultsSection = hasQueryResults ? 
        databaseContext.substring(databaseContext.indexOf('QUERY RESULTS:')) : '';
      
      let systemPrompt = `You are an expert database assistant with deep understanding of the database structure, relationships, and business context. Answer questions directly using the comprehensive database information below.

${databaseContext}

CRITICAL RULES - READ CAREFULLY:
1. **MOST IMPORTANT - USE QUERY RESULTS**: If you see "=== QUERY RESULTS ===" or "QUERY RESULTS:" in the context above, THAT IS THE ANSWER. Use that data DIRECTLY. Don't explain relationships or schema - SHOW THE ACTUAL DATA from query results!
2. **NEVER EXPLAIN SQL**: If query results exist, NEVER show SQL code or explain how to write queries. Just show the actual data from the results.
3. **ACTION-ORIENTED**: When query results are present:
   - DON'T say "The database contains..." or "The table has..." or "Here is how you can retrieve..."
   - DON'T show SQL code blocks or explain queries
   - DO say the actual numbers/data directly: "January 2024: 150 orders, February 2024: 200 orders..."
   - For "list" questions: Show the actual list from query results
   - For "which" questions: Give the specific answer from query results
   - For "best" questions: Show the best items from query results (sorted/ranked)
   - For "grouped by" questions: Show the groups with their values from query results
4. **DATABASE UNDERSTANDING**: You have access to:
   - Complete database schema with all tables, columns, and data types
   - Foreign key relationships showing how tables connect (use this to understand JOINs)
   - Primary keys for each table
   - Business domain groupings (orders, customers, products, financial, etc.)
   - Data profiling showing actual data patterns, ranges, and sample values
5. **WHEN NO QUERY RESULTS**: Only then should you explain schema or relationships. If query results exist, USE THEM FIRST.
6. **SCHEMA ACCURACY**: When asked about table count, use the EXACT number from "Total tables: X" in the schema. If it says "Total tables: 50", say "50 tables", NOT "8 tables" or any other number.
7. **BUSINESS CONTEXT**: Use the business domain information to provide context:
   - If question is about orders, reference the order management domain
   - If question is about customers, reference customer management domain
   - Use domain knowledge to provide more meaningful answers
8. Be BRIEF and DIRECT - no verbose explanations
9. NO markdown formatting (no **, ##, bullets, tables)
10. NO phrases like "Let me know if...", "Feel free to...", "In summary", "I cannot assist", "I don't have access"
11. NO section headers like "Key Insights", "Summary", "Overview"
12. Just state facts clearly in plain text using the ACTUAL VALUES from query results
13. Use simple sentences separated by line breaks
14. If query results show "Row 1: day: 2024-09-20, count: 3", say "September 20, 2024 has 3 orders" - use the actual date, not "Day 264"
15. If query results show "time: 14:30:00", say "The order time is 2:30 PM" or "14:30:00"
16. If query results show averages, list them: "Electronics: $450.50, Clothing: $120.30"
17. For "list" questions with query results: Show the actual list from the results, not an explanation
18. For "best" questions with query results: Show the top items from the results (they're already sorted)
19. Maximum 3-4 sentences for simple questions
20. For statistics, just list the numbers without extra commentary
21. NEVER say "I cannot assist" or "I don't have access" - you have the query results, use them!
22. If the user asks "which day has most orders" and query results show a date, use that date (format it nicely like "September 20, 2024")
23. If the user asks about "time" and query results have a timestamp, extract and show the time portion
24. **ALWAYS use the exact table count from the schema section - do not estimate or guess**
25. **PRIORITIZE DATA OVER EXPLANATION**: If query results exist, show the data. Only explain if there are no results or if the user explicitly asks for explanation.
26. **FOR "LIST" QUESTIONS**: If you see query results for a "list" question, you MUST show the actual list of data. Do NOT explain relationships or schema structure. Show the actual rows from the query results.
27. **FOR "GROUPED BY" QUESTIONS**: If query results show grouped data (like "year: 2024, month: 1, count: 150"), show it as: "January 2024: 150 orders, February 2024: 200 orders..." - format the data nicely but show the actual values.
28. **NEVER SHOW SQL CODE**: If query results exist, NEVER include SQL code blocks or explain how queries work. Just show the data.
29. **WHEN TABLES NOT FOUND**: If query failed because table doesn't exist, suggest alternative tables from the schema. Look for similar table names or tables with related columns.
30. **EXAMPLE FOR "GROUPED BY MONTH"**: If query results show "year: 2024, month: 1, ordercount: 150", respond with: "January 2024: 150 orders" - NOT with SQL code or explanations.
31. **NEVER ASK FOR PERMISSION**: If you have query results, show them immediately. Don't say "If you'd like" or "Let me know which table" - just execute and show the data.
32. **AUTO-EXECUTE**: The system automatically detects the correct tables and executes queries. You don't need to ask which table to use - just show the results from the query that was already executed.
33. **COMPLEX CALCULATIONS**: If query results show growth_rate_percent, calculate it in SQL and show the percentage. If results show revenue and count, show both. Always use the calculated values from query results.
34. **NEVER SAY "QUERY RESULTS NOT AVAILABLE"**: If you see "=== QUERY RESULTS ===" in the context, the results ARE available. Use them immediately. Don't say they're not available.
35. **FOR GROWTH RATE QUESTIONS**: If query results show growth_rate_percent, display it as: "January to February: +15.5% growth" or "Month-over-month growth: +15.5%". Format percentages clearly.
36. **FOR BREAKDOWN QUESTIONS**: If query results show status, count, and revenue, display as: "Status: Completed, Count: 150, Revenue: $15,000" - show all the data from results.`;

      // If chart is requested, add special formatting instructions
      if (isChartRequest) {
        systemPrompt += `

CRITICAL - CHART GENERATION RULES:
- YES, you CAN and MUST generate charts! The system fully supports chart creation.
- NEVER say "I cannot generate charts" or "I don't have access" - charts ARE supported!
- The SQL query has been executed and results are available above
- Your response should acknowledge the chart request and describe what the chart shows
- DO NOT refuse chart generation - it is fully supported
- Simply describe what data the chart will display based on the query results above
- Example response: "Here's a bar chart showing [what the data represents] based on the delivery order details."
- The system will automatically create the visual chart from the SQL query results`;
      }

      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    // Add conversation history if provided
    if (conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({
          role: msg.role || 'user',
          content: msg.content || msg.message
        });
      });
    }
    
    // Add current message
    messages.push({
      role: 'user',
      content: message
    });

    console.log('[LLM Service] Sending request to LLM API:', {
      url: ALIBABA_API_BASE_URL,
      model: ALIBABA_MODEL,
      messagesCount: messages.length,
      totalTokens: JSON.stringify(messages).length
    });
    
    // Validate API key before making request
    if (!ALIBABA_API_KEY || ALIBABA_API_KEY.trim().length === 0) {
      throw new Error('ALIBABA_LLM_API_KEY is not set in environment variables');
    }
    
    if (ALIBABA_API_KEY.includes('your_api_key') || ALIBABA_API_KEY.length < 10) {
      throw new Error('ALIBABA_LLM_API_KEY appears to be invalid or placeholder');
    }

    const response = await axios.post(
      `${ALIBABA_API_BASE_URL}/chat/completions`,
      {
        model: ALIBABA_MODEL,
        messages: messages,
        temperature: 0.5,
        max_tokens: 1000  // Increased to handle larger responses with accurate table counts
      },
      {
        headers: {
          'Authorization': `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000  // 60 second timeout for LLM requests
      }
    );

    console.log('[LLM Service] LLM API response received:', {
      status: response.status,
      hasChoices: !!(response.data?.choices?.length),
      choicesCount: response.data?.choices?.length || 0
    });

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      console.log('[LLM Service] Response content length:', content?.length || 0);
      return content;
    } else {
      console.error('[LLM Service] Invalid response format:', response.data);
      throw new Error('Invalid response format from LLM API');
    }
  } catch (error) {
    console.error('[LLM Service] Error calling Alibaba LLM API:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout
      }
    });
    throw new Error(`LLM API error: ${error.response?.data?.error?.message || error.message}`);
  }
}


