import { queryWithRetry } from '../utils/dbRetry.js';
import { getSchema } from './schemaCache.js';

/**
 * Profile a single column to understand its data characteristics
 */
async function profileColumn(tableName, columnName, columnType) {
  try {
    const profile = {
      table: tableName,
      column: columnName,
      type: columnType,
      distinctCount: null,
      nullCount: null,
      nullPercentage: null,
      minValue: null,
      maxValue: null,
      sampleValues: []
    };

    // Get basic statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT "${columnName}") as distinct_count,
        COUNT(*) - COUNT("${columnName}") as null_count
      FROM "${tableName}"
    `;
    
    const statsResult = await queryWithRetry(statsQuery, [], 1);
    if (statsResult.rows.length > 0) {
      const totalRows = parseInt(statsResult.rows[0].total_rows);
      profile.distinctCount = parseInt(statsResult.rows[0].distinct_count);
      profile.nullCount = parseInt(statsResult.rows[0].null_count);
      profile.nullPercentage = totalRows > 0 ? (profile.nullCount / totalRows * 100).toFixed(2) : 0;
    }

    // Get min/max for numeric and date types
    if (columnType.includes('int') || columnType.includes('numeric') || columnType.includes('decimal') || 
        columnType.includes('float') || columnType.includes('double') || columnType.includes('real')) {
      try {
        const minMaxResult = await queryWithRetry(
          `SELECT MIN("${columnName}") as min_val, MAX("${columnName}") as max_val FROM "${tableName}" WHERE "${columnName}" IS NOT NULL`,
          [],
          1
        );
        if (minMaxResult.rows.length > 0) {
          profile.minValue = minMaxResult.rows[0].min_val;
          profile.maxValue = minMaxResult.rows[0].max_val;
        }
      } catch (e) {
        // Skip if min/max fails
      }
    } else if (columnType.includes('date') || columnType.includes('timestamp')) {
      try {
        const minMaxResult = await queryWithRetry(
          `SELECT MIN("${columnName}") as min_val, MAX("${columnName}") as max_val FROM "${tableName}" WHERE "${columnName}" IS NOT NULL`,
          [],
          1
        );
        if (minMaxResult.rows.length > 0) {
          profile.minValue = minMaxResult.rows[0].min_val;
          profile.maxValue = minMaxResult.rows[0].max_val;
        }
      } catch (e) {
        // Skip if min/max fails
      }
    }

    // Get sample values (for text and categorical columns)
    if (columnType.includes('text') || columnType.includes('varchar') || columnType.includes('char')) {
      try {
        const sampleResult = await queryWithRetry(
          `SELECT DISTINCT "${columnName}" FROM "${tableName}" WHERE "${columnName}" IS NOT NULL LIMIT 10`,
          [],
          1
        );
        profile.sampleValues = sampleResult.rows.map(r => r[columnName]).filter(v => v !== null && v !== undefined);
      } catch (e) {
        // Skip if sample fails
      }
    }

    return profile;
  } catch (error) {
    console.log(`[Data Profiling] Error profiling column ${tableName}.${columnName}:`, error.message);
    return null;
  }
}

/**
 * Profile key columns from important tables
 * Focuses on columns that are likely to be used in business queries
 */
export async function profileKeyColumns(schema, maxTables = 20) {
  if (!schema || !schema.tables) {
    return {};
  }

  const profiles = {};
  const tablesToProfile = schema.tables.slice(0, maxTables);

  console.log(`[Data Profiling] Profiling ${tablesToProfile.length} tables...`);

  for (const table of tablesToProfile) {
    if (table.rowCount === 0) {
      continue; // Skip empty tables
    }

    profiles[table.name] = {
      tableName: table.name,
      rowCount: table.rowCount,
      columns: []
    };

    // Profile important columns: primary keys, foreign keys, and common business columns
    const importantColumns = table.columns.filter(col => {
      return col.isPrimaryKey || 
             col.isForeignKey || 
             col.name.toLowerCase().includes('date') ||
             col.name.toLowerCase().includes('amount') ||
             col.name.toLowerCase().includes('price') ||
             col.name.toLowerCase().includes('quantity') ||
             col.name.toLowerCase().includes('status') ||
             col.name.toLowerCase().includes('type') ||
             col.name.toLowerCase().includes('category') ||
             col.name.toLowerCase().includes('name');
    });

    // If no "important" columns found, profile first 5 columns
    const columnsToProfile = importantColumns.length > 0 
      ? importantColumns.slice(0, 10)
      : table.columns.slice(0, 5);

    console.log(`[Data Profiling] Profiling ${columnsToProfile.length} columns from ${table.name}...`);

    for (const col of columnsToProfile) {
      const profile = await profileColumn(table.name, col.name, col.type);
      if (profile) {
        profiles[table.name].columns.push(profile);
      }
    }
  }

  return profiles;
}

/**
 * Generate data profiling summary for LLM context
 */
export function formatProfilingSummary(profiles) {
  if (!profiles || Object.keys(profiles).length === 0) {
    return '';
  }

  let summary = 'DATA PROFILING SUMMARY:\n';
  summary += 'This section provides insights into the actual data patterns in the database.\n\n';

  Object.values(profiles).forEach(tableProfile => {
    if (tableProfile.columns.length === 0) {
      return;
    }

    summary += `Table: ${tableProfile.tableName} (${tableProfile.rowCount} total rows)\n`;
    
    tableProfile.columns.forEach(colProfile => {
      summary += `  Column: ${colProfile.column} (${colProfile.type})\n`;
      
      if (colProfile.distinctCount !== null) {
        summary += `    - Distinct values: ${colProfile.distinctCount}\n`;
      }
      
      if (colProfile.nullPercentage !== null) {
        summary += `    - Null percentage: ${colProfile.nullPercentage}%\n`;
      }
      
      if (colProfile.minValue !== null && colProfile.maxValue !== null) {
        summary += `    - Range: ${colProfile.minValue} to ${colProfile.maxValue}\n`;
      }
      
      if (colProfile.sampleValues.length > 0) {
        summary += `    - Sample values: ${colProfile.sampleValues.slice(0, 5).join(', ')}${colProfile.sampleValues.length > 5 ? '...' : ''}\n`;
      }
      
      summary += '\n';
    });
  });

  return summary;
}

/**
 * Get comprehensive data profiling for the database
 */
export async function getDataProfiling(useCache = true) {
  try {
    const schema = await getSchema(useCache);
    if (!schema) {
      return null;
    }

    const profiles = await profileKeyColumns(schema, 20);
    return profiles;
  } catch (error) {
    console.error('[Data Profiling] Error getting data profiling:', error.message);
    return null;
  }
}






