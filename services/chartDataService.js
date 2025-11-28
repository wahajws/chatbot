import { 
  generateSQLFromQuestion, 
  executeSQLQuery
} from './sqlGenerator.js';
import { getDatabaseSchema } from './databaseService.js';

/**
 * Use LLM to generate SQL query for chart data based on user's question
 * Then execute the query and format results for chart display
 */
export async function getChartDataForQuery(message) {
  try {
    // Get database schema for context
    const schema = await getDatabaseSchema();
    
    // Enhance the message to indicate we need chart data
    const chartQuery = `${message}. Format the results as name-value pairs suitable for a bar chart. Return data with labels and numeric values.`;
    
    // Use LLM to generate SQL query for chart data
    const sqlQuery = await generateSQLFromQuestion(chartQuery, schema);
    
    if (!sqlQuery) {
      console.log('No SQL query generated for chart');
      return null;
    }
    
    console.log('Generated chart SQL:', sqlQuery);
    
    // Execute the SQL query
    const queryResult = await executeSQLQuery(sqlQuery);
    
    if (!queryResult || !queryResult.success || !queryResult.rows || queryResult.rows.length === 0) {
      console.log('Chart query returned no results or failed');
      return null;
    }
    
    // Convert query results to chart data format
    const chartData = convertQueryResultsToChartData(queryResult.rows, message);
    
    if (!chartData || chartData.length === 0) {
      return null;
    }
    
    // Extract title from message
    const title = extractChartTitle(message);
    
    return {
      type: 'bar',
      data: chartData,
      title: title
    };
  } catch (error) {
    console.error('Error getting chart data for query:', error);
    return null;
  }
}

/**
 * Convert SQL query results to chart data format (name-value pairs)
 */
function convertQueryResultsToChartData(rows, message) {
  if (!rows || rows.length === 0) return [];
  
  const lowerMessage = message.toLowerCase();
  const chartData = [];
  
  // Get all column names
  const columns = Object.keys(rows[0]);
  
  // Try to identify name and value columns intelligently
  let nameColumn = null;
  let valueColumn = null;
  
  // Look for common name-like columns
  const namePatterns = ['name', 'label', 'title', 'category', 'product', 'customer', 'city', 'status', 'day', 'month', 'date'];
  for (const col of columns) {
    if (namePatterns.some(pattern => col.toLowerCase().includes(pattern))) {
      nameColumn = col;
      break;
    }
  }
  
  // Look for common value-like columns
  const valuePatterns = ['count', 'total', 'sum', 'amount', 'revenue', 'sales', 'quantity', 'value', 'price', 'orders'];
  for (const col of columns) {
    if (valuePatterns.some(pattern => col.toLowerCase().includes(pattern))) {
      valueColumn = col;
      break;
    }
  }
  
  // If we have both name and value columns, use them
  if (nameColumn && valueColumn) {
    rows.forEach(row => {
      const name = String(row[nameColumn] || '').trim();
      const value = parseFloat(row[valueColumn]) || parseInt(row[valueColumn]) || 0;
      
      if (name && !isNaN(value) && value > 0) {
        // Truncate long names
        const displayName = name.length > 25 ? name.substring(0, 22) + '...' : name;
        chartData.push({
          name: displayName,
          value: value
        });
      }
    });
  } else {
    // Fallback: use first column as name, second as value
    // Or if only one column, use it as value with row number as name
    if (columns.length >= 2) {
      rows.forEach((row, idx) => {
        const name = String(row[columns[0]] || `Item ${idx + 1}`).trim();
        const value = parseFloat(row[columns[1]]) || parseInt(row[columns[1]]) || 0;
        
        if (!isNaN(value) && value > 0) {
          const displayName = name.length > 25 ? name.substring(0, 22) + '...' : name;
          chartData.push({
            name: displayName,
            value: value
          });
        }
      });
    } else if (columns.length === 1) {
      // Single column - use it as value
      rows.forEach((row, idx) => {
        const value = parseFloat(row[columns[0]]) || parseInt(row[columns[0]]) || 0;
        if (!isNaN(value) && value > 0) {
          chartData.push({
            name: `Item ${idx + 1}`,
            value: value
          });
        }
      });
    }
  }
  
  // Limit to top 15 items for chart readability
  return chartData.slice(0, 15);
}

/**
 * Extract a meaningful title from the user's message
 */
function extractChartTitle(message) {
  // Remove common chart request phrases
  let title = message
    .replace(/^(show|display|graph|chart|can you generate|create|give me|i want)\s+(me\s+)?(a\s+)?/i, '')
    .replace(/\s+(chart|graph|visualization|visualize|diagram|plot)$/i, '')
    .trim();
  
  // Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  
  // If title is too short or empty, use a default
  if (title.length < 3) {
    title = 'Chart Data';
  }
  
  return title;
}

