import pool from '../config/database.js';
import { queryWithRetry } from '../utils/dbRetry.js';
import { getSchema } from './schemaCache.js';
import { generateTableSuggestions, findRelatedTables } from './tableDiscoveryService.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ALIBABA_API_KEY = process.env.ALIBABA_LLM_API_KEY;
const ALIBABA_API_BASE_URL = process.env.ALIBABA_LLM_API_BASE_URL;
const ALIBABA_MODEL = process.env.ALIBABA_LLM_API_MODEL || 'qwen-plus';

/**
 * Get database schema information for SQL generation
 * Uses cached schema if available, otherwise fetches fresh
 * Includes relationships and business context
 */
async function getSchemaForSQL() {
  try {
    // Try to use cached schema first
    const schemaData = await getSchema(true);
    
    if (schemaData && schemaData.tables) {
      let schema = 'DATABASE SCHEMA WITH RELATIONSHIPS:\n';
      schema += `Total tables: ${schemaData.totalTables}\n`;
      schema += `Database: ${schemaData.database || 'unknown'}\n\n`;
      
      schemaData.tables.forEach(table => {
        schema += `Table: ${table.name} (${table.rowCount} rows)\n`;
        
        // Primary key
        if (table.primaryKey && table.primaryKey.length > 0) {
          schema += `  Primary Key: ${table.primaryKey.join(', ')}\n`;
        }
        
        // Columns with relationship info
        schema += `  Columns:\n`;
        table.columns.forEach(col => {
          let colDesc = `    - ${col.name} (${col.type}`;
          if (col.isPrimaryKey) colDesc += ', PK';
          if (col.isForeignKey) {
            colDesc += `, FK -> ${col.foreignKey.referencesTable}.${col.foreignKey.referencesColumn}`;
          }
          if (!col.nullable) colDesc += ', NOT NULL';
          colDesc += ')';
          schema += colDesc + '\n';
        });
        
        // Foreign key relationships (for JOIN understanding)
        if (table.foreignKeys && table.foreignKeys.length > 0) {
          schema += `  Relationships (use for JOINs):\n`;
          table.foreignKeys.forEach(fk => {
            schema += `    - ${table.name}.${fk.column} = ${fk.referencesTable}.${fk.referencesColumn}\n`;
          });
        }
        
        schema += '\n';
      });
      
      return schema;
    }
    
    // Fallback to direct query if cache not available
    const tablesResult = await queryWithRetry(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    let schema = 'DATABASE SCHEMA:\n';
    
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      try {
        const columnsResult = await queryWithRetry(`
          SELECT 
            column_name,
            data_type,
            is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' 
            AND table_name = $1
          ORDER BY ordinal_position
        `, [tableName]);

        schema += `\nTable: ${tableName}\n`;
        schema += `Columns: ${columnsResult.rows.map(c => `${c.column_name} (${c.data_type})`).join(', ')}\n`;
      } catch (e) {
        // Skip tables that can't be queried
        continue;
      }
    }

    return schema;
  } catch (error) {
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED' ||
                             error.message?.includes('Connection terminated');
    if (!isConnectionError) {
      console.error('Error getting schema for SQL:', error.message);
    }
    return '';
  }
}

/**
 * Use LLM to generate SQL query from natural language question
 */
export async function generateSQLFromQuestion(question, databaseContext = '') {
  try {
    console.log('[SQL Generator] Generating SQL from question:', question.substring(0, 100));
    console.log('[SQL Generator] Getting schema for SQL generation...');
    const schema = await getSchemaForSQL();
    console.log('[SQL Generator] Schema retrieved, length:', schema.length);
    
    // Check if this is for a chart (needs name-value pairs)
    const isChartQuery = /chart|graph|visualiz|visualization|visualize|bar\s+chart|bar\s+graph|plot|diagram|generate.*chart/i.test(question);
    console.log('[SQL Generator] Is chart query?', isChartQuery);
    
    let chartInstructions = '';
    if (isChartQuery) {
      chartInstructions = `
CRITICAL - CHART DATA REQUIREMENTS:
- MUST return exactly 2 columns: one for labels/names, one for values
- First column should be the category/name (text/varchar) - use alias like "name", "label", "category"
- Second column should be the numeric value (count, sum, amount, etc.) - use alias like "value", "count", "total"
- LIMIT results to 15-20 rows for chart display
- For "delivery order details" or similar: GROUP BY a meaningful category and COUNT or SUM the values
- Example: SELECT status AS name, COUNT(*) AS value FROM deliveryorderdetails GROUP BY status ORDER BY value DESC LIMIT 15
- For delivery orders: GROUP BY status, product_name, or date and aggregate quantities/amounts
- Always use ORDER BY to sort results (DESC for highest values)
`;
    }
    
    // Get table suggestions for better error handling
    const schemaData = await getSchema(true);
    let tableSuggestions = '';
    if (schemaData) {
      const suggestions = generateTableSuggestions(schemaData, question);
      if (suggestions.length > 0) {
        tableSuggestions = '\n\nTABLE SUGGESTIONS:\n';
        suggestions.forEach(s => {
          tableSuggestions += `${s.suggestion}\n`;
        });
        tableSuggestions += '\n';
      }
    }

    const prompt = `You are an expert SQL query generator. Generate a PostgreSQL SQL query to answer the user's question using the database schema.

DATABASE SCHEMA:
${schema}

USER QUESTION: ${question}

${tableSuggestions ? `IMPORTANT - TABLE SUGGESTIONS:\n${tableSuggestions}\n` : ''}
${databaseContext ? `ADDITIONAL CONTEXT:\n${databaseContext}\n` : ''}
${chartInstructions}

CRITICAL RULES:
1. Generate ONLY a valid PostgreSQL SQL query - NO explanations, NO comments, NO markdown
2. Return ONLY the SQL query, nothing else
3. Use EXACT table and column names from the schema above (case-sensitive, use double quotes if needed)
4. **ALWAYS GENERATE SQL**: For questions like "list", "show", "which", "what", "how many", "best", "most", "breakdown", "total", "revenue", "growth", "rate" - ALWAYS generate a SQL query. Don't just explain, EXECUTE!
5. **COMPLEX CALCULATIONS**: For growth rate, percentages, averages:
   - Growth rate: ((current - previous) / previous * 100) - use LAG() window function
   - Percentages: (value / total * 100)
   - Always include calculations in SQL, don't just explain how to calculate
6. **IF TABLE NOT FOUND**: If the exact table name doesn't exist, use the TABLE SUGGESTIONS above to find alternative tables. For example, if "customers" table doesn't exist, look for "accounts", "users", or tables with customer-related columns.
7. **WORKAROUNDS**: If a direct table doesn't exist, use available data creatively:
   - For "customers who haven't placed orders": Use deliveryorders table and find accounts that don't appear in orders
   - For "revenue per category": If no category column exists, group by productid or use available grouping columns
   - For "list X with Y": Even if exact tables don't match, JOIN the closest matching tables
8. **RELATIONSHIPS & JOINs**: Use the "Relationships" section in the schema to understand how tables connect:
   - If schema shows "TableA.column = TableB.column", use: JOIN TableB ON TableA.column = TableB.column
   - Foreign keys (FK) indicate relationships - use them for JOINs
   - When joining multiple tables, follow the relationship chain
   - For "list X with Y": JOIN the tables using the relationships shown
9. **"BEST" QUESTIONS**: When question asks for "best", "top", "highest", "most valuable":
   - Look for columns like: value, amount, price, discount, discount_amount, discount_percentage, savings, total_value
   - If deals table has discount/value columns, ORDER BY those columns DESC
   - If no value column, look for usage metrics: COUNT of related records, frequency of use
   - Example: "best deals" -> ORDER BY discount_amount DESC or value DESC, or COUNT of uses DESC
10. **"GROUPED BY" QUESTIONS**: When question asks to "group by month", "group by day", "group by category":
   - Use DATE_TRUNC('month', column) or EXTRACT(YEAR/MONTH FROM column) for date grouping
   - Always include the grouping columns in SELECT and GROUP BY
   - Include COUNT(*) or SUM() to show aggregated values
   - Example: "grouped by month" -> SELECT EXTRACT(YEAR FROM createdat) as year, EXTRACT(MONTH FROM createdat) as month, COUNT(*) as count FROM deliveryorders GROUP BY year, month ORDER BY year, month
11. For date operations:
   - Extract day: DATE(column_name) or DATE_TRUNC('day', column_name)
   - Group by date: DATE(column_name) or DATE_TRUNC('day', column_name)
   - Format dates: TO_CHAR(column_name, 'YYYY-MM-DD') for display
   - For "which day has most orders": Use deliveryorders table with created_at, GROUP BY DATE(created_at)
12. For aggregations: COUNT(*), SUM(column), AVG(column), MAX(column), MIN(column)
13. For "average sell" or "average sales": Calculate from order_items (quantity * unit_price) or orders (total_amount)
14. For "each type" or "by category": Use GROUP BY on the category/type column
15. **JOIN Strategy**: 
   - When question mentions data from multiple tables, JOIN them using the relationships shown in schema
   - Use INNER JOIN by default, LEFT JOIN if you need all records from the main table
   - Example: If schema shows "orders.customer_id -> customers.id", use: JOIN customers ON orders.customer_id = customers.id
   - For "list X with Y": JOIN the tables and SELECT relevant columns from both
16. Use GROUP BY when grouping by category, type, date, etc.
17. Use ORDER BY for sorting (DESC for highest/most/best, ASC for lowest/least)
18. Use LIMIT for "top", "most", "best", or charts (10-15 rows), but NOT for "grouped by" questions (show all groups)
19. For "which day has most orders": SELECT DATE(created_at) as day, COUNT(*) as count FROM deliveryorders GROUP BY DATE(created_at) ORDER BY count DESC LIMIT 1
20. For "list delivery orders with details": SELECT do.*, dod.* FROM deliveryorders do JOIN deliveryorderdetails dod ON do.id = dod.deliveryorderid AND do.accountid = dod.accountid LIMIT 20
21. For "orders grouped by month": SELECT EXTRACT(YEAR FROM createdat) as year, EXTRACT(MONTH FROM createdat) as month, COUNT(*) as ordercount FROM deliveryorders GROUP BY EXTRACT(YEAR FROM createdat), EXTRACT(MONTH FROM createdat) ORDER BY year, month
22. Return format: SQL: SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY ... LIMIT ...

EXAMPLES:
Question: "which day has the most orders?"
SQL: SELECT DATE(created_at) as day, COUNT(*) as order_count FROM deliveryorders GROUP BY DATE(created_at) ORDER BY order_count DESC LIMIT 1

Question: "which is the best deals?"
SQL: SELECT * FROM deals ORDER BY COALESCE(discount_amount, value, 0) DESC LIMIT 10
OR if no value column: SELECT dealtype, COUNT(*) as usage_count FROM deals GROUP BY dealtype ORDER BY usage_count DESC LIMIT 10

Question: "list delivery orders with their associated order details"
SQL: SELECT do.*, dod.* FROM deliveryorders do JOIN deliveryorderdetails dod ON do.id = dod.deliveryorderid AND do.accountid = dod.accountid LIMIT 20

Question: "average sell of each type of product"
SQL: SELECT p.category, AVG(oi.unit_price * oi.quantity) as avg_sales FROM order_items oi JOIN products p ON oi.product_id = p.id GROUP BY p.category

Question: "show me customers by city"
SQL: SELECT city, COUNT(*) as customer_count FROM customers GROUP BY city ORDER BY customer_count DESC

Question: "which products are in the most orders?"
SQL: SELECT productid, COUNT(*) as order_count FROM deliveryorderdetails GROUP BY productid ORDER BY order_count DESC LIMIT 10

Now generate the SQL query for: ${question}`;

    console.log('[SQL Generator] Sending request to LLM for SQL generation...');
    console.log('[SQL Generator] Prompt length:', prompt.length);
    
    const response = await axios.post(
      `${ALIBABA_API_BASE_URL}/chat/completions`,
      {
        model: ALIBABA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a SQL expert. Generate only SQL queries, no explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${ALIBABA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    console.log('[SQL Generator] LLM response received:', {
      status: response.status,
      hasChoices: !!(response.data?.choices?.length)
    });

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      let sqlQuery = response.data.choices[0].message.content.trim();
      console.log('[SQL Generator] Raw SQL from LLM:', sqlQuery.substring(0, 300));
      
      // Extract SQL from response (remove "SQL:" prefix if present)
      sqlQuery = sqlQuery.replace(/^SQL:\s*/i, '').trim();
      
      // Remove markdown code blocks if present
      sqlQuery = sqlQuery.replace(/```sql\n?/gi, '').replace(/```\n?/g, '').trim();
      
      // Remove any explanations before or after SQL
      // Look for common patterns like "Here is the SQL:" or "The query is:"
      sqlQuery = sqlQuery.replace(/^[^S]*?(?=SELECT)/i, '').trim();
      
      // Don't remove content before finding the SQL block - we'll do that in the extraction phase
      // Just remove obvious prefixes
      sqlQuery = sqlQuery.trim();
      
      // More careful extraction - find the SQL block
      // Look for SELECT or WITH at the start of a line
      const lines = sqlQuery.split('\n');
      let sqlStartIndex = -1;
      let sqlEndIndex = lines.length;
      
      // Find where SQL starts
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().toUpperCase();
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
          sqlStartIndex = i;
          break;
        }
      }
      
      // If we found SQL start, extract from there
      if (sqlStartIndex >= 0) {
        // More conservative approach: look for clear end markers
        // Only stop if we find a semicolon followed by clear non-SQL text
        let foundSemicolon = false;
        let lastSQLKeywordLine = sqlStartIndex;
        
        // Track SQL keywords to know we're still in SQL
        const sqlKeywords = /^(SELECT|WITH|FROM|WHERE|JOIN|GROUP|ORDER|HAVING|LIMIT|UNION|AND|OR|INNER|LEFT|RIGHT|FULL|OUTER|ON|AS|CASE|WHEN|THEN|ELSE|END|EXTRACT|DATE|COUNT|SUM|AVG|MAX|MIN|COALESCE|CURRENT_DATE|CURRENT_TIMESTAMP)/i;
        
        for (let i = sqlStartIndex; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          
          // Track if this line contains SQL keywords
          if (trimmed.match(sqlKeywords) || 
              trimmed.match(/^[A-Z_][A-Z0-9_]*\s*[=<>!]/i) ||
              trimmed.match(/[(),]/)) {
            lastSQLKeywordLine = i;
            foundSemicolon = false;
          }
          
          // If line ends with semicolon, mark it
          if (trimmed.endsWith(';')) {
            foundSemicolon = true;
            lastSQLKeywordLine = i;
          }
          
          // Only stop if we've found a semicolon AND the next non-empty line is clearly not SQL
          if (foundSemicolon && trimmed.endsWith(';')) {
            let nextNonEmpty = i + 1;
            while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
              nextNonEmpty++;
            }
            
            if (nextNonEmpty < lines.length) {
              const nextLine = lines[nextNonEmpty].trim();
              // Only stop if next line is clearly an explanation (starts with common explanation words)
              if (nextLine.match(/^(This|The|Here|Note|Explanation|Query|Result|Returns|Shows|Displays|Finds|Gets)/i) ||
                  (nextLine.length > 50 && !nextLine.match(sqlKeywords) && !nextLine.match(/[(),]/))) {
                sqlEndIndex = i + 1;
                break;
              }
            } else {
              // End of input after semicolon - include everything up to semicolon
              sqlEndIndex = i + 1;
              break;
            }
          }
        }
        
        // If we didn't find a clear end, use the last line with SQL keywords or everything
        if (sqlEndIndex === lines.length && foundSemicolon) {
          sqlEndIndex = lastSQLKeywordLine + 1;
        }
        
        sqlQuery = lines.slice(sqlStartIndex, sqlEndIndex).join('\n').trim();
        
        // Check if we need to get more lines from the original response
        // Look for incomplete patterns in the extracted SQL
        const extractedLastLine = sqlQuery.split('\n').pop().trim();
        const incompleteMarkers = [
          /INTERVAL\s+'[^']*$/i,
          /'[^']*$/,
          /\b(LEF|RIGH|CURREN|INNE|OUTE)\s*$/i,
          /\b(>=|<=|<>|!=|=|<|>)\s*$/
        ];
        
        const needsMore = incompleteMarkers.some(marker => marker.test(extractedLastLine));
        
        if (needsMore || sqlEndIndex < lines.length) {
          // Get more lines from original response
          const originalContent = response.data.choices[0].message.content;
          const originalLines = originalContent.split('\n');
          
          // Find the matching position in original
          for (let origIdx = 0; origIdx < originalLines.length; origIdx++) {
            const origLine = originalLines[origIdx].trim();
            if (origLine === extractedLastLine || 
                origLine.includes(extractedLastLine) ||
                extractedLastLine.includes(origLine)) {
              // Get continuation lines
              const continuation = originalLines.slice(origIdx + 1, origIdx + 25)
                .filter(line => {
                  const trimmed = line.trim();
                  if (trimmed.length === 0) return false;
                  if (trimmed.match(/^(This|The|Here|Note|Explanation|Query|Result|Returns|Shows|Displays|Finds|Gets|The query|This query|Note:|Explanation:)/i)) {
                    return false;
                  }
                  return true;
                });
              
              // Add continuation until we find a complete statement
              let addedLines = [];
              let foundComplete = false;
              
              for (const contLine of continuation) {
                const trimmed = contLine.trim();
                addedLines.push(trimmed);
                
                // Check if this completes the SQL
                const testSQL = sqlQuery + '\n' + addedLines.join('\n');
                const testLastLine = testSQL.split('\n').pop().trim();
                
                // Complete if ends with semicolon or completes an incomplete pattern
                if (trimmed.endsWith(';') || 
                    trimmed.endsWith("'") ||
                    trimmed.match(/^\)/)) {
                  foundComplete = true;
                  break;
                }
                
                // Stop if we hit an explanation
                if (trimmed.match(/^(This|The|Here|Note|Explanation)/i) && addedLines.length > 3) {
                  addedLines.pop(); // Remove the explanation line
                  break;
                }
                
                // Limit to reasonable length
                if (addedLines.length >= 15) break;
              }
              
              if (addedLines.length > 0) {
                sqlQuery += '\n' + addedLines.join('\n');
                console.log('[SQL Generator] Added', addedLines.length, 'continuation lines');
              }
              break;
            }
          }
        }
        
        // Remove trailing semicolon if present (we'll add it back if needed)
        sqlQuery = sqlQuery.replace(/;+\s*$/, '').trim();
      }
      
      // Basic validation - ensure it has SELECT and FROM
      const upperQuery = sqlQuery.toUpperCase();
      if (upperQuery.startsWith('SELECT') || upperQuery.startsWith('WITH')) {
        // Check for basic SQL structure
        if (upperQuery.includes('FROM')) {
          // Check if SQL looks incomplete (ends with incomplete keywords, operators, or unclosed strings)
          const incompletePatterns = [
            /\b(CURREN|EXTRACT|DATE|COUNT|SUM|AVG|MAX|MIN|COALESCE|CASE|WHEN|THEN|ELSE|LEF|RIGH|INNE|OUTE|CROSS|NATURA)\s*$/i, // Incomplete keywords
            /\b(>=|<=|<>|!=|=|<|>)\s*$/, // Incomplete operators
            /\b(\(|,)\s*$/, // Unclosed parentheses or trailing comma
            /INTERVAL\s+'[^']*$/, // Unclosed INTERVAL string
            /'[^']*$/, // Unclosed single quote (but not at end of line if it's a complete string)
            /"[^"]*$/, // Unclosed double quote
            /\b(AND|OR|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL)\s*$/i, // Incomplete JOIN/WHERE clauses
          ];
          
          const lastLine = sqlQuery.split('\n').pop().trim();
          const isIncomplete = incompletePatterns.some(pattern => pattern.test(lastLine));
          
          // Also check for unclosed parentheses or quotes in the entire query
          const openParens = (sqlQuery.match(/\(/g) || []).length;
          const closeParens = (sqlQuery.match(/\)/g) || []).length;
          const singleQuotes = (sqlQuery.match(/'/g) || []).length;
          const doubleQuotes = (sqlQuery.match(/"/g) || []).length;
          const hasUnclosedParens = openParens !== closeParens;
          const hasUnclosedQuotes = (singleQuotes % 2 !== 0) || (doubleQuotes % 2 !== 0);
          
          if (isIncomplete || hasUnclosedParens || hasUnclosedQuotes) {
            console.log('[SQL Generator] SQL appears incomplete.');
            console.log('[SQL Generator] Last line:', lastLine);
            console.log('[SQL Generator] Unclosed parens:', hasUnclosedParens, `(${openParens} open, ${closeParens} close)`);
            console.log('[SQL Generator] Unclosed quotes:', hasUnclosedQuotes, `(${singleQuotes} single, ${doubleQuotes} double)`);
            console.log('[SQL Generator] Full SQL so far:', sqlQuery);
            
            // Try to get more from the original response
            const originalContent = response.data.choices[0].message.content;
            const originalLines = originalContent.split('\n');
            
            // Find where our extracted SQL ends in the original
            const extractedLines = sqlQuery.split('\n');
            const lastExtractedLine = extractedLines[extractedLines.length - 1].trim();
            
            // Find this line in the original and get what comes after
            for (let i = 0; i < originalLines.length; i++) {
              const originalLine = originalLines[i].trim();
              // Match if the line is similar (handles cases where whitespace differs)
              if (originalLine === lastExtractedLine || 
                  originalLine.includes(lastExtractedLine) || 
                  lastExtractedLine.includes(originalLine)) {
                // Get next few lines that might complete the SQL
                const continuation = originalLines.slice(i + 1, i + 20)
                  .filter(line => {
                    const trimmed = line.trim();
                    return trimmed.length > 0 && 
                           !trimmed.match(/^(This|The|Here|Note|Explanation|Query|Result|Returns|Shows|Displays|Finds|Gets|The query|This query)/i);
                  })
                  .slice(0, 10); // Take up to 10 more lines
                
                if (continuation.length > 0) {
                  const continuationText = continuation.join('\n').trim();
                  // Only append if it looks like SQL
                  if (continuationText.match(/[(),;'"]/) || 
                      continuationText.match(/^(GROUP|ORDER|HAVING|LIMIT|UNION|AND|OR|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CURRENT_DATE|CURRENT_TIMESTAMP|INTERVAL)/i)) {
                    sqlQuery += '\n' + continuationText;
                    console.log('[SQL Generator] Appended continuation to complete SQL');
                    
                    // Re-check if still incomplete after appending
                    const newLastLine = sqlQuery.split('\n').pop().trim();
                    const stillIncomplete = incompletePatterns.some(pattern => pattern.test(newLastLine));
                    const newOpenParens = (sqlQuery.match(/\(/g) || []).length;
                    const newCloseParens = (sqlQuery.match(/\)/g) || []).length;
                    const newSingleQuotes = (sqlQuery.match(/'/g) || []).length;
                    const newDoubleQuotes = (sqlQuery.match(/"/g) || []).length;
                    
                    if (stillIncomplete || (newOpenParens !== newCloseParens) || (newSingleQuotes % 2 !== 0) || (newDoubleQuotes % 2 !== 0)) {
                      console.log('[SQL Generator] SQL still appears incomplete after continuation');
                    } else {
                      console.log('[SQL Generator] SQL appears complete after continuation');
                    }
                    break;
                  }
                }
                break;
              }
            }
          }
          
          console.log('[SQL Generator] Cleaned SQL query (full):', sqlQuery);
          console.log('[SQL Generator] Cleaned SQL query (preview):', sqlQuery.substring(0, 300));
          return sqlQuery;
        } else {
          console.log('[SQL Generator] SQL missing FROM clause:', sqlQuery.substring(0, 200));
        }
      } else {
        console.log('[SQL Generator] Response does not look like SQL. First 200 chars:', sqlQuery.substring(0, 200));
      }
    }
    
    // Fallback: Generate simple SQL for common patterns if LLM fails
    const questionLower = question.toLowerCase();
    if (questionLower.includes('grouped by month') || questionLower.includes('group by month') || questionLower.includes('orders grouped by month')) {
      console.log('[SQL Generator] Using fallback SQL for grouped by month');
      // Try delivery_orders (with underscore) first, then deliveryorders, with created_at
      return `SELECT EXTRACT(YEAR FROM created_at) as year, EXTRACT(MONTH FROM created_at) as month, COUNT(*) as ordercount FROM delivery_orders GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at) ORDER BY year, month`;
    }
    
    return null;
  } catch (error) {
    console.error('Error generating SQL from LLM:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Safely execute SQL query with validation
 */
export async function executeSQLQuery(sqlQuery) {
  if (!sqlQuery) return null;

  try {
    // Basic safety checks - only allow SELECT queries
    const trimmedQuery = sqlQuery.trim();
    const upperQuery = trimmedQuery.toUpperCase();
    
    // Remove comments and strings to check for dangerous operations more accurately
    // This prevents false positives from comments or string literals
    const withoutComments = trimmedQuery
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/'[^']*'/g, '') // Remove single-quoted strings
      .replace(/"[^"]*"/g, ''); // Remove double-quoted strings
    
    const cleanUpper = withoutComments.trim().toUpperCase();
    
    // Check for dangerous operations at statement level (not in comments/strings)
    // Use word boundaries to avoid false matches in column names like "customer_id"
    const dangerousPatterns = [
      /\bDROP\b/i,
      /\bDELETE\b/i,
      /\bUPDATE\b/i,
      /\bINSERT\b/i,
      /\bALTER\b/i,
      /\bCREATE\b/i,
      /\bTRUNCATE\b/i,
      /\bEXEC\b/i,
      /\bEXECUTE\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(cleanUpper)) {
        console.error('Dangerous SQL query rejected:', sqlQuery.substring(0, 200));
        return { error: 'Only SELECT queries are allowed for safety' };
      }
    }

    // Ensure it starts with SELECT (after removing leading whitespace/comments)
    if (!cleanUpper.startsWith('SELECT')) {
      console.error('Invalid SQL query - must start with SELECT:', sqlQuery.substring(0, 200));
      return { error: 'Query must be a SELECT statement' };
    }

    // Final validation before execution - check for common incomplete patterns
    const finalCheck = sqlQuery.trim();
    const hasUnclosedString = /'[^']*$/.test(finalCheck.split('\n').pop()) || /"[^"]*$/.test(finalCheck.split('\n').pop());
    const hasUnclosedInterval = /INTERVAL\s+'[^']*$/.test(finalCheck);
    const hasIncompleteKeyword = /\b(LEF|RIGH|CURREN|INNE|OUTE)\s*$/i.test(finalCheck.split('\n').pop());
    
    if (hasUnclosedString || hasUnclosedInterval || hasIncompleteKeyword) {
      console.error('[SQL Generator] SQL validation failed - incomplete query detected');
      console.error('[SQL Generator] Last line:', finalCheck.split('\n').pop());
      return {
        error: 'Generated SQL query appears incomplete. Please try rephrasing your question.',
        sqlQuery: sqlQuery
      };
    }
    
    // Execute the query with retry
    console.log('[SQL Generator] Executing query with retry logic...');
    const result = await queryWithRetry(sqlQuery);
    
    console.log('[SQL Generator] Query executed successfully, rows returned:', result.rows.length);
    
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rows.length
    };
  } catch (error) {
    const isConnectionError = error.code === 'ETIMEDOUT' || 
                             error.code === 'EHOSTUNREACH' || 
                             error.code === 'ECONNREFUSED' ||
                             error.message?.includes('Connection terminated');
    
    if (!isConnectionError) {
      console.error('[SQL Generator] Error executing SQL query:', error.message);
      console.error('[SQL Generator] SQL that failed:', sqlQuery.substring(0, 500));
      
      // Extract more helpful error message from PostgreSQL errors
      let errorMessage = error.message;
      if (error.code === '42601' || error.message?.includes('syntax error')) {
        errorMessage = `SQL syntax error: ${error.message}. Please try rephrasing your question.`;
      } else if (error.code === '42P01' || error.message?.includes('does not exist')) {
        errorMessage = `Table or column not found: ${error.message}. The database schema may have changed.`;
      } else if (error.code === '42883' || error.message?.includes('operator does not exist')) {
        errorMessage = `Data type mismatch: ${error.message}. Please try a different query.`;
      }
      
      return {
        error: errorMessage,
        sqlQuery: sqlQuery,
        errorCode: error.code
      };
    }
    
    return {
      error: 'Database connection error. Please try again.',
      sqlQuery: sqlQuery
    };
  }
}

/**
 * Format query results for LLM context
 * Makes results very clear and easy for LLM to use
 */
export function formatQueryResults(queryResult) {
  if (!queryResult || queryResult.error) {
    return null;
  }

  if (queryResult.rows.length === 0) {
    return 'QUERY RESULTS: No data found.';
  }

  let formatted = '=== QUERY RESULTS (USE THIS DATA TO ANSWER THE QUESTION) ===\n\n';
  
  // Get column names from first row
  const columns = Object.keys(queryResult.rows[0]);
  formatted += `Columns: ${columns.join(', ')}\n`;
  formatted += `Total rows: ${queryResult.rows.length}\n\n`;
  
  // Format rows in a clear, readable way
  const maxRows = Math.min(queryResult.rows.length, 30); // Show up to 30 rows
  
  queryResult.rows.slice(0, maxRows).forEach((row, idx) => {
    formatted += `[Row ${idx + 1}]\n`;
    columns.forEach(col => {
      const value = row[col];
      if (value !== null && value !== undefined) {
        // Format dates nicely
        if (value instanceof Date) {
          formatted += `  ${col}: ${value.toISOString()} (${value.toLocaleString()})\n`;
        } else {
          formatted += `  ${col}: ${value}\n`;
        }
      }
    });
    formatted += '\n';
  });

  if (queryResult.rows.length > maxRows) {
    formatted += `... and ${queryResult.rows.length - maxRows} more rows (showing first ${maxRows})\n\n`;
  }
  
  formatted += '=== END QUERY RESULTS ===\n';
  formatted += 'IMPORTANT: Use the data above to answer the user\'s question directly. The query results contain the exact answer.\n';

  return formatted;
}

/**
 * Detect if question requires SQL query execution
 * Made more aggressive to catch more analytical questions
 */
export function requiresSQLQuery(question) {
  const lowerQuestion = question.toLowerCase();
  
  // Questions that definitely need SQL
  const sqlKeywords = [
    'which', 'what', 'how many', 'how much', 'how',
    'average', 'avg', 'mean', 'total', 'sum', 'count',
    'most', 'least', 'highest', 'lowest', 'top', 'bottom', 'best', 'worst',
    'maximum', 'minimum', 'max', 'min',
    'per day', 'per month', 'per year', 'by day', 'by month', 'by year', 'by',
    'group', 'compare', 'ranking', 'rank', 'breakdown', 'distribution',
    'when', 'where', 'who', 'show me', 'tell me', 'give me', 'list',
    'each', 'every', 'all', 'type', 'category', 'kind',
    'sell', 'sales', 'revenue', 'order', 'customer', 'product',
    'day', 'date', 'time', 'hour', 'month', 'year',
    'information', 'details', 'data', 'statistics', 'stats'
  ];
  
  // Questions that don't need SQL (simple yes/no or general)
  const excludeKeywords = [
    'yes', 'no', 'ok', 'thanks', 'thank you', 'hello', 'hi', 'help'
  ];
  
  // If it's a simple greeting/exclusion, don't use SQL
  if (excludeKeywords.some(kw => lowerQuestion.trim() === kw || lowerQuestion.trim().startsWith(kw + ' '))) {
    return false;
  }
  
  // If question contains analytical keywords, use SQL
  if (sqlKeywords.some(kw => lowerQuestion.includes(kw))) {
    return true;
  }
  
  // If question asks about specific data (mentions table names or data fields)
  const dataKeywords = ['table', 'column', 'field', 'record', 'row'];
  if (dataKeywords.some(kw => lowerQuestion.includes(kw))) {
    return true;
  }
  
  // Default: try SQL for most questions (more aggressive approach)
  // Only skip if it's clearly a conversational question
  const conversationalPatterns = [
    /^(yes|no|ok|sure|alright|fine|thanks|thank you|hello|hi)$/i,
    /^(can you|will you|would you|please) (help|assist|explain|tell)/i
  ];
  
  if (conversationalPatterns.some(pattern => pattern.test(question))) {
    return false;
  }
  
  // For follow-up questions like "yes do it", "tell me more", etc., check context
  const followUpPatterns = [
    /^(yes|yeah|yep|sure|ok|alright|do it|go ahead|please|tell me more|show me|give me)/i,
    /^(what|which|how|when|where|who) (was|is|are|were)/i
  ];
  
  if (followUpPatterns.some(pattern => pattern.test(question))) {
    return true; // Follow-ups likely need SQL based on previous context
  }
  
  // Default: try SQL for most questions
  return true;
}

