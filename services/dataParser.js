/**
 * Parse structured data from LLM response text
 * Extracts name-value pairs for chart generation
 */

/**
 * Parse bar chart data from LLM response
 * Looks for patterns like:
 * - "Product A: 45"
 * - "Product A - 45"
 * - "Product A (45)"
 * - "45 Product A"
 * - Table rows with data
 */
export function parseBarChartData(response) {
  const data = [];
  const lines = response.split('\n').filter(line => line.trim());
  
  // Pattern 1: "Name: Value" or "Name - Value"
  const pattern1 = /^([^:-\d]+?)[:\-]\s*(\d+(?:\.\d+)?)/i;
  // Pattern 2: "Name (Value)" or "Value Name"
  const pattern2 = /^([^(]+?)\s*\((\d+(?:\.\d+)?)\)/i;
  const pattern3 = /^(\d+(?:\.\d+)?)\s+(.+)$/i;
  // Pattern 4: "Name Value" (name followed by number)
  const pattern4 = /^(.+?)\s+(\d+(?:\.\d+)?)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = trimmed.match(pattern1);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      if (name && !isNaN(value)) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern2);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      if (name && !isNaN(value)) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern3);
    if (match) {
      const value = parseFloat(match[1]);
      const name = match[2].trim();
      if (name && !isNaN(value)) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern4);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      // Only add if it looks like a valid pair (name has letters, value is reasonable)
      if (name && /[a-zA-Z]/.test(name) && !isNaN(value) && value > 0 && value < 1000000) {
        data.push({ name: name.substring(0, 30), value });
      }
    }
  }

  // If we found data, return it
  if (data.length > 0) {
    return data.slice(0, 10); // Limit to 10 items
  }

  // Try to extract from table-like format
  const tablePattern = /\|([^|]+)\|([^|]+)\|/g;
  const tableMatches = response.matchAll(tablePattern);
  for (const match of tableMatches) {
    const name = match[1].trim();
    const valueStr = match[2].trim();
    const value = parseFloat(valueStr.replace(/[^\d.]/g, ''));
    if (name && !isNaN(value) && value > 0) {
      data.push({ name: name.substring(0, 30), value });
    }
  }

  // Try to extract from product table data if mentioned
  if (data.length === 0 && response.toLowerCase().includes('product')) {
    // Look for patterns like "15 products" or "product table has 15 rows"
    const productCountMatch = response.match(/(\d+)\s+product/i);
    if (productCountMatch) {
      const count = parseInt(productCountMatch[1]);
      // Try to get actual product names from database context
      const productMatches = response.match(/([A-Za-z][^:,\n]+?):\s*(\d+)/g);
      if (productMatches) {
        productMatches.forEach(match => {
          const parts = match.split(/[:\-]/);
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parseFloat(parts[1].trim());
            if (name && !isNaN(value) && value > 0) {
              data.push({ name: name.substring(0, 30), value });
            }
          }
        });
      }
    }
  }

  return data.length > 0 ? data.slice(0, 10) : null;
}

/**
 * Extract data from database context or response
 * Looks for patterns in the response that indicate data
 */
export function extractDataFromResponse(response, databaseContext = '') {
  // First try parsing the response directly
  let parsed = parseBarChartData(response);
  if (parsed && parsed.length > 0) {
    return parsed;
  }

  // Try parsing from database context if available
  if (databaseContext) {
    parsed = parseBarChartData(databaseContext);
    if (parsed && parsed.length > 0) {
      return parsed;
    }
  }

  return null;
}

