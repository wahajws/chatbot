/**
 * Clean and format LLM responses for better readability
 * @param {string} response - Raw LLM response
 * @returns {string} - Cleaned and formatted response
 */
export function formatResponse(response) {
  if (!response) return response;

  let formatted = response;

  // Remove common verbose endings
  formatted = formatted.replace(/\n*Let me know if you['']d like.*$/gim, '');
  formatted = formatted.replace(/\n*Feel free to ask.*$/gim, '');
  formatted = formatted.replace(/\n*If you need.*$/gim, '');
  formatted = formatted.replace(/\n*I can help.*$/gim, '');
  formatted = formatted.replace(/\n*Would you like.*$/gim, '');

  // Remove excessive markdown headers
  formatted = formatted.replace(/^#{1,6}\s+/gm, '');
  
  // Remove bold/italic markdown but keep the text
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '$1');
  formatted = formatted.replace(/\*([^*]+)\*/g, '$1');
  formatted = formatted.replace(/__([^_]+)__/g, '$1');
  formatted = formatted.replace(/_([^_]+)_/g, '$1');

  // Simplify bullet points - convert to simple lines
  formatted = formatted.replace(/^[\s]*[-*•]\s+/gm, '');
  formatted = formatted.replace(/^\d+\.\s+/gm, '');

  // Remove excessive section headers like "Key Insights", "Summary", etc.
  formatted = formatted.replace(/^\*\*?Key\s+(Insights|Observations|Findings|Points)\*\*?:?\s*\n/gi, '');
  formatted = formatted.replace(/^\*\*?Summary\*\*?:?\s*\n/gi, '');
  formatted = formatted.replace(/^\*\*?In\s+summary\*\*?:?\s*\n/gi, '');
  formatted = formatted.replace(/^\*\*?Overview\*\*?:?\s*\n/gi, '');

  // Remove redundant phrases
  formatted = formatted.replace(/The database (appears to be|is|contains|manages)/gi, 'This database');
  formatted = formatted.replace(/In summary,?\s*/gi, '');
  formatted = formatted.replace(/To summarize,?\s*/gi, '');
  formatted = formatted.replace(/In conclusion,?\s*/gi, '');

  // Clean up markdown table formatting
  formatted = formatted.replace(/\|[\s\S]*?\|/g, (match) => {
    const lines = match.split('\n').filter(line => line.trim());
    if (lines.length > 2 && lines[1].includes('---')) {
      // Convert table to simple list
      const rows = lines.slice(2).map(line => {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        return cells.join(': ');
      }).filter(r => r);
      return rows.join('\n');
    }
    return match;
  });

  // Remove excessive spacing and formatting
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  formatted = formatted.replace(/[ \t]+/g, ' ');
  formatted = formatted.replace(/\n[ \t]+/g, '\n');
  formatted = formatted.replace(/[ \t]+\n/g, '\n');

  // Clean up escape characters
  formatted = formatted.replace(/\\n/g, '\n');
  formatted = formatted.replace(/\\t/g, '\t');

  // Remove empty lines at start and end
  formatted = formatted.trim();

  // Remove redundant separators
  formatted = formatted.replace(/^---+\s*\n/gm, '');
  formatted = formatted.replace(/\n---+\s*$/gm, '');

  // Simplify common patterns but preserve "Name: Value" format for charts
  // Only remove bullets, keep the colon format
  formatted = formatted.replace(/^[\s]*[-*•]\s+([^:]+):\s*([^\n]+)/gm, '$1: $2');
  
  // Remove "Key components" or similar verbose introductions
  formatted = formatted.replace(/^Key components? of the database:?\s*\n/gi, '');
  formatted = formatted.replace(/^The database contains:?\s*\n/gi, '');
  formatted = formatted.replace(/^Here (are|is) (the|some) (overall|key|main) (statistics|information|details):?\s*\n/gi, '');

  // Clean up redundant table descriptions
  formatted = formatted.replace(/\n- ([^:]+): \d+ records?\s*\n\n([^\n]+)\n\n/gi, '\n$1: $2\n');

  // Final cleanup
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  formatted = formatted.trim();

  return formatted;
}

