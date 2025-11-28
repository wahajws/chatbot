import { getSchema } from './schemaCache.js';

/**
 * Find tables that might match a concept (e.g., "customers" might be "accounts", "users", etc.)
 */
export function findRelatedTables(schema, concept) {
  if (!schema || !schema.tables) {
    return [];
  }

  const conceptLower = concept.toLowerCase();
  const related = [];

  // Common mappings
  const conceptMappings = {
    customer: ['customer', 'client', 'account', 'user', 'member', 'buyer'],
    product: ['product', 'item', 'sku', 'goods', 'merchandise'],
    order: ['order', 'transaction', 'purchase', 'sale'],
    category: ['category', 'type', 'class', 'group', 'classification'],
    revenue: ['revenue', 'amount', 'total', 'price', 'value', 'sales'],
    quantity: ['quantity', 'qty', 'count', 'amount', 'volume']
  };

  // Find matching concept
  let searchTerms = [conceptLower];
  for (const [key, terms] of Object.entries(conceptMappings)) {
    if (terms.some(t => conceptLower.includes(t) || t.includes(conceptLower))) {
      searchTerms = [...searchTerms, ...terms];
      break;
    }
  }

  // Search tables
  schema.tables.forEach(table => {
    const tableName = table.name.toLowerCase();
    if (searchTerms.some(term => tableName.includes(term))) {
      related.push({
        table: table.name,
        reason: `Table name contains "${concept}" concept`,
        rowCount: table.rowCount
      });
    }
  });

  // Search columns for the concept
  schema.tables.forEach(table => {
    const matchingColumns = table.columns.filter(col => {
      const colName = col.name.toLowerCase();
      return searchTerms.some(term => colName.includes(term));
    });

    if (matchingColumns.length > 0 && !related.find(r => r.table === table.name)) {
      related.push({
        table: table.name,
        reason: `Has columns related to "${concept}": ${matchingColumns.map(c => c.name).join(', ')}`,
        rowCount: table.rowCount,
        relevantColumns: matchingColumns.map(c => c.name)
      });
    }
  });

  return related;
}

/**
 * Generate helpful suggestions when a table/column is not found
 */
export function generateTableSuggestions(schema, question) {
  const questionLower = question.toLowerCase();
  const suggestions = [];

  // Check for customer-related questions
  if (questionLower.includes('customer') || questionLower.includes('client')) {
    const related = findRelatedTables(schema, 'customer');
    if (related.length > 0) {
      suggestions.push({
        concept: 'customer',
        found: related,
        suggestion: `I found these customer-related tables: ${related.map(r => r.table).join(', ')}. Try querying these tables instead.`
      });
    }
  }

  // Check for product-related questions
  if (questionLower.includes('product') || questionLower.includes('item')) {
    const related = findRelatedTables(schema, 'product');
    if (related.length > 0) {
      suggestions.push({
        concept: 'product',
        found: related,
        suggestion: `I found these product-related tables: ${related.map(r => r.table).join(', ')}. Product IDs might be in deliveryorderdetails table.`
      });
    }
  }

  // Check for category-related questions
  if (questionLower.includes('category') || questionLower.includes('type')) {
    const related = findRelatedTables(schema, 'category');
    if (related.length > 0) {
      suggestions.push({
        concept: 'category',
        found: related,
        suggestion: `I found these category-related tables/columns: ${related.map(r => `${r.table} (${r.relevantColumns?.join(', ') || 'check columns'})`).join(', ')}.`
      });
    }
  }

  return suggestions;
}

/**
 * Get all table names for quick reference
 */
export function getAllTableNames(schema) {
  if (!schema || !schema.tables) {
    return [];
  }
  return schema.tables.map(t => t.name);
}

/**
 * Find tables that might contain revenue/amount data
 */
export function findRevenueTables(schema) {
  const revenueTables = [];
  
  schema.tables.forEach(table => {
    const hasAmountColumn = table.columns.some(col => {
      const colName = col.name.toLowerCase();
      return colName.includes('amount') || 
             colName.includes('revenue') || 
             colName.includes('total') || 
             colName.includes('price') || 
             colName.includes('value') ||
             (col.type.includes('numeric') || col.type.includes('decimal') || col.type.includes('money'));
    });

    if (hasAmountColumn) {
      const amountColumns = table.columns.filter(col => {
        const colName = col.name.toLowerCase();
        return colName.includes('amount') || 
               colName.includes('revenue') || 
               colName.includes('total') || 
               colName.includes('price') || 
               colName.includes('value');
      });

      revenueTables.push({
        table: table.name,
        amountColumns: amountColumns.map(c => c.name),
        rowCount: table.rowCount
      });
    }
  });

  return revenueTables;
}






