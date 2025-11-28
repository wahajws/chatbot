/**
 * Detects if a message or response suggests a visualization
 * and extracts chart type and data requirements
 */

export const detectVisualization = (message, response) => {
  const lowerMessage = message.toLowerCase();

  // Only show charts when user EXPLICITLY asks for them
  // Require explicit chart/graph/visualization keywords
  const explicitChartKeywords = [
    'chart', 'graph', 'visualiz', 'visualization', 'visualize',
    'display.*chart', 'show.*chart', 'generate.*chart', 'create.*chart',
    'bar chart', 'bar graph', 'plot', 'diagram'
  ];

  // Check if user explicitly requested a chart
  const explicitlyRequestedChart = explicitChartKeywords.some(kw => {
    const regex = new RegExp(kw, 'i');
    return regex.test(lowerMessage);
  });

  if (!explicitlyRequestedChart) return null;

  // Always use bar chart as requested
  const chartType = 'bar';

  // Extract title from message
  let title = '';
  if (lowerMessage.includes('show') || lowerMessage.includes('display') || 
      lowerMessage.includes('graph') || lowerMessage.includes('chart')) {
    title = message.replace(/^(show|display|graph|chart|can you generate)\s+(me\s+)?(a\s+)?/i, '').trim();
  } else {
    title = message.substring(0, 50);
  }

  return {
    type: chartType,
    title: title || 'Chart Data',
    suggested: true
  };
};

/**
 * Parse chart data from LLM response text
 * Extracts name-value pairs for bar charts
 */
export const parseChartDataFromResponse = (response) => {
  const data = [];
  const lines = response.split('\n').filter(line => line.trim());
  
  // Pattern 1: "Name: Value" or "Name - Value"
  const pattern1 = /^([^:-\d]+?)[:\-]\s*(\d+(?:\.\d+)?)/i;
  // Pattern 2: "Name (Value)"
  const pattern2 = /^([^(]+?)\s*\((\d+(?:\.\d+)?)\)/i;
  // Pattern 3: "Value Name"
  const pattern3 = /^(\d+(?:\.\d+)?)\s+(.+)$/i;
  // Pattern 4: "Name Value"
  const pattern4 = /^(.+?)\s+(\d+(?:\.\d+)?)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = trimmed.match(pattern1);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      if (name && !isNaN(value) && value > 0) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern2);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      if (name && !isNaN(value) && value > 0) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern3);
    if (match) {
      const value = parseFloat(match[1]);
      const name = match[2].trim();
      if (name && !isNaN(value) && value > 0) {
        data.push({ name: name.substring(0, 30), value });
        continue;
      }
    }

    match = trimmed.match(pattern4);
    if (match) {
      const name = match[1].trim();
      const value = parseFloat(match[2]);
      // Only add if it looks like a valid pair
      if (name && /[a-zA-Z]/.test(name) && !isNaN(value) && value > 0 && value < 1000000) {
        data.push({ name: name.substring(0, 30), value });
      }
    }
  }

  return data.length > 0 ? data.slice(0, 10) : null;
};

/**
 * Generates chart data by parsing the LLM response
 * Falls back to empty array if parsing fails
 */
export const generateChartData = (type, response) => {
  if (type === 'bar') {
    const parsed = parseChartDataFromResponse(response);
    return parsed || [];
  }
  
  return [];
};

