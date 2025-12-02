import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import './VectorHealth.css';

import { getApiBaseUrl } from '../utils/apiConfig';

// Get API URL at runtime to ensure it uses current hostname
const getApiUrl = () => getApiBaseUrl();

const VectorHealth = () => {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchHealthData();
    
    // Auto-refresh every 30 seconds if enabled
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchHealthData();
      }, 30000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      const apiUrl = getApiUrl();
      const endpoint = `${apiUrl}/api/vector-health`;
      console.log('[Frontend API] GET', endpoint);
      const response = await axios.get(endpoint);
      console.log('[Frontend API] Response:', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers
      });
      console.log('[Frontend API] Full Response Object:', response);
      setHealthData(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching vector health:', err);
      setError('Failed to load vector health data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="vector-health-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading vector database health...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vector-health-container">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={fetchHealthData}>Retry</button>
        </div>
      </div>
    );
  }

  const { 
    health, 
    statistics, 
    indexes, 
    indexSizes,
    vectorColumns, 
    vectorColumnStats,
    storage,
    recentActivity,
    tableStats,
    similarityStats,
    coverage 
  } = healthData || {};

  // Prepare chart data
  const coverageData = [];
  if (coverage?.messages) {
    coverageData.push({
      name: 'Messages',
      withEmbeddings: parseInt(coverage.messages.withEmbeddings) || 0,
      withoutEmbeddings: parseInt(coverage.messages.withoutEmbeddings) || 0,
      coverage: parseFloat(coverage.messages.coveragePercent) || 0
    });
  }
  if (coverage?.knowledgeBase) {
    coverageData.push({
      name: 'Knowledge Base',
      withEmbeddings: parseInt(coverage.knowledgeBase.withEmbeddings) || 0,
      withoutEmbeddings: parseInt(coverage.knowledgeBase.withoutEmbeddings) || 0,
      coverage: parseFloat(coverage.knowledgeBase.coveragePercent) || 0
    });
  }

  const pieData = [];
  if (coverage?.messages) {
    pieData.push({
      name: 'With Embeddings',
      value: parseInt(coverage.messages.withEmbeddings) || 0,
      color: '#00f0ff'
    });
    pieData.push({
      name: 'Without Embeddings',
      value: parseInt(coverage.messages.withoutEmbeddings) || 0,
      color: '#ef4444'
    });
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return '#10b981';
      case 'extension_missing':
        return '#ef4444';
      default:
        return '#f59e0b';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return '✓';
      case 'extension_missing':
        return '✗';
      default:
        return '⚠';
    }
  };

  return (
    <div className="vector-health-container">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="vector-health-header"
      >
        <div>
          <h1>Vector Database Health & Monitoring</h1>
          <p>Real-time monitoring of pgvector extension and embedding coverage</p>
        </div>
        <div className="header-actions">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh (30s)</span>
          </label>
          <button onClick={fetchHealthData} className="refresh-btn">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 4V10H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M23 20V14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
        </div>
      </motion.div>

      {/* Health Status Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="health-status-card"
        style={{ '--status-color': getStatusColor(health?.status) }}
      >
        <div className="status-indicator">
          <div className="status-icon">{getStatusIcon(health?.status)}</div>
          <div>
            <h2>System Status</h2>
            <p className="status-text">{health?.status === 'healthy' ? 'Healthy' : 'Extension Missing'}</p>
          </div>
        </div>
        <div className="status-details">
          <div className="status-item">
            <span className="status-label">pgvector Extension:</span>
            <span className="status-value">
              {health?.extensionInstalled ? '✓ Installed' : '✗ Not Installed'}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Embedding Dimensions:</span>
            <span className="status-value">{statistics?.embeddingDimensions || 'N/A'}</span>
          </div>
          <div className="status-item">
            <span className="status-label">Last Updated:</span>
            <span className="status-value">
              {health?.timestamp ? new Date(health.timestamp).toLocaleString() : 'N/A'}
            </span>
          </div>
        </div>
        {health?.message && (
          <div className="status-message">
            <p>{health.message}</p>
          </div>
        )}
      </motion.div>

      {/* Coverage Stats */}
      {coverage && (
        <div className="stats-grid">
          {coverage.messages && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="coverage-card"
            >
              <h3>Messages Coverage</h3>
              <div className="coverage-stats">
                <div className="coverage-stat">
                  <span className="stat-label">Total Messages:</span>
                  <span className="stat-value">{coverage.messages.total}</span>
                </div>
                <div className="coverage-stat">
                  <span className="stat-label">With Embeddings:</span>
                  <span className="stat-value success">{coverage.messages.withEmbeddings}</span>
                </div>
                <div className="coverage-stat">
                  <span className="stat-label">Without Embeddings:</span>
                  <span className="stat-value warning">{coverage.messages.withoutEmbeddings}</span>
                </div>
                <div className="coverage-percent">
                  <span className="percent-label">Coverage:</span>
                  <span className="percent-value" style={{ color: parseFloat(coverage.messages.coveragePercent) >= 80 ? '#10b981' : '#f59e0b' }}>
                    {coverage.messages.coveragePercent}%
                  </span>
                </div>
              </div>
              <div className="coverage-bar">
                <div 
                  className="coverage-fill"
                  style={{ 
                    width: `${coverage.messages.coveragePercent}%`,
                    background: parseFloat(coverage.messages.coveragePercent) >= 80 ? '#10b981' : '#f59e0b'
                  }}
                ></div>
              </div>
            </motion.div>
          )}

          {coverage.knowledgeBase && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="coverage-card"
            >
              <h3>Knowledge Base Coverage</h3>
              <div className="coverage-stats">
                <div className="coverage-stat">
                  <span className="stat-label">Total Entries:</span>
                  <span className="stat-value">{coverage.knowledgeBase.total}</span>
                </div>
                <div className="coverage-stat">
                  <span className="stat-label">With Embeddings:</span>
                  <span className="stat-value success">{coverage.knowledgeBase.withEmbeddings}</span>
                </div>
                <div className="coverage-stat">
                  <span className="stat-label">Without Embeddings:</span>
                  <span className="stat-value warning">{coverage.knowledgeBase.withoutEmbeddings}</span>
                </div>
                <div className="coverage-percent">
                  <span className="percent-label">Coverage:</span>
                  <span className="percent-value" style={{ color: parseFloat(coverage.knowledgeBase.coveragePercent) >= 80 ? '#10b981' : '#f59e0b' }}>
                    {coverage.knowledgeBase.coveragePercent}%
                  </span>
                </div>
              </div>
              <div className="coverage-bar">
                <div 
                  className="coverage-fill"
                  style={{ 
                    width: `${coverage.knowledgeBase.coveragePercent}%`,
                    background: parseFloat(coverage.knowledgeBase.coveragePercent) >= 80 ? '#10b981' : '#f59e0b'
                  }}
                ></div>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Charts */}
      {coverageData.length > 0 && (
        <div className="charts-grid">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="chart-card"
          >
            <h3>Embedding Coverage</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={coverageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 240, 255, 0.1)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" />
                <YAxis stroke="var(--text-secondary)" />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Bar dataKey="withEmbeddings" fill="#00f0ff" name="With Embeddings" />
                <Bar dataKey="withoutEmbeddings" fill="#ef4444" name="Without Embeddings" />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>

          {pieData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="chart-card"
            >
              <h3>Messages Embedding Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </div>
      )}

      {/* Vector Columns Info */}
      {vectorColumns && vectorColumns.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="info-card"
        >
          <h3>Vector Columns</h3>
          <div className="vector-columns-list">
            {vectorColumns.map((col, idx) => (
              <div key={idx} className="vector-column-item">
                <div className="column-name">{col.table_name}.{col.column_name}</div>
                <div className="column-type">{col.data_type}</div>
                <div className="column-nullable">{col.is_nullable === 'YES' ? 'Nullable' : 'Not Null'}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Storage Information */}
      {storage && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="info-card"
        >
          <h3>Storage Information</h3>
          <div className="storage-grid">
            <div className="storage-item">
              <span className="storage-label">Messages Table:</span>
              <span className="storage-value">{storage.messages_size || 'N/A'}</span>
            </div>
            <div className="storage-item">
              <span className="storage-label">Knowledge Base:</span>
              <span className="storage-value">{storage.knowledge_base_size || 'N/A'}</span>
            </div>
            <div className="storage-item">
              <span className="storage-label">Total Database:</span>
              <span className="storage-value">{storage.database_size || 'N/A'}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Recent Activity */}
      {recentActivity && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.65 }}
          className="info-card"
        >
          <h3>Recent Activity (Last 24 Hours)</h3>
          <div className="activity-grid">
            <div className="activity-item">
              <span className="activity-label">Total Messages:</span>
              <span className="activity-value">{recentActivity.total_messages_24h || 0}</span>
            </div>
            <div className="activity-item">
              <span className="activity-label">With Embeddings:</span>
              <span className="activity-value success">{recentActivity.embedded_messages_24h || 0}</span>
            </div>
            <div className="activity-item">
              <span className="activity-label">Last Message:</span>
              <span className="activity-value">
                {recentActivity.last_message_time 
                  ? new Date(recentActivity.last_message_time).toLocaleString() 
                  : 'N/A'}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Index Performance */}
      {indexSizes && indexSizes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="info-card"
        >
          <h3>Index Performance</h3>
          <div className="index-performance-list">
            {indexSizes.map((idx, index) => (
              <div key={index} className="index-performance-item">
                <div className="index-perf-header">
                  <div className="index-perf-name">{idx.indexname}</div>
                  <div className="index-perf-size">{idx.index_size || 'N/A'}</div>
                </div>
                <div className="index-perf-table">Table: {idx.tablename}</div>
                <div className="index-perf-stats">
                  <span>Scans: {idx.index_scans || 0}</span>
                  <span>Tuples Read: {idx.tuples_read || 0}</span>
                  <span>Tuples Fetched: {idx.tuples_fetched || 0}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Table Statistics */}
      {tableStats && tableStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.75 }}
          className="info-card"
        >
          <h3>Table Statistics</h3>
          <div className="table-stats-list">
            {tableStats.map((table, index) => (
              <div key={index} className="table-stat-item">
                <div className="table-stat-name">{table.tablename}</div>
                <div className="table-stat-grid">
                  <div className="table-stat-cell">
                    <span className="table-stat-label">Live Tuples:</span>
                    <span className="table-stat-value">{table.live_tuples || 0}</span>
                  </div>
                  <div className="table-stat-cell">
                    <span className="table-stat-label">Dead Tuples:</span>
                    <span className="table-stat-value">{table.dead_tuples || 0}</span>
                  </div>
                  <div className="table-stat-cell">
                    <span className="table-stat-label">Inserts:</span>
                    <span className="table-stat-value">{table.inserts || 0}</span>
                  </div>
                  <div className="table-stat-cell">
                    <span className="table-stat-label">Updates:</span>
                    <span className="table-stat-value">{table.updates || 0}</span>
                  </div>
                  {table.last_autovacuum && (
                    <div className="table-stat-cell">
                      <span className="table-stat-label">Last Vacuum:</span>
                      <span className="table-stat-value">
                        {new Date(table.last_autovacuum).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {table.last_autoanalyze && (
                    <div className="table-stat-cell">
                      <span className="table-stat-label">Last Analyze:</span>
                      <span className="table-stat-value">
                        {new Date(table.last_autoanalyze).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Vector Column Statistics */}
      {vectorColumnStats && vectorColumnStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="info-card"
        >
          <h3>Vector Column Statistics</h3>
          <div className="vector-column-stats-list">
            {vectorColumnStats.map((col, index) => (
              <div key={index} className="vector-col-stat-item">
                <div className="vector-col-stat-name">{col.table}.{col.column}</div>
                <div className="vector-col-stat-grid">
                  <div className="vector-col-stat-cell">
                    <span className="vector-col-stat-label">Total Rows:</span>
                    <span className="vector-col-stat-value">{col.total_rows || 0}</span>
                  </div>
                  <div className="vector-col-stat-cell">
                    <span className="vector-col-stat-label">Non-Null:</span>
                    <span className="vector-col-stat-value success">{col.non_null_rows || 0}</span>
                  </div>
                  <div className="vector-col-stat-cell">
                    <span className="vector-col-stat-label">Null:</span>
                    <span className="vector-col-stat-value warning">{col.null_rows || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Similarity Statistics */}
      {similarityStats && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.85 }}
          className="info-card"
        >
          <h3>Vector Similarity Statistics</h3>
          <div className="similarity-stats-grid">
            <div className="similarity-stat-item">
              <span className="similarity-stat-label">Average Similarity:</span>
              <span className="similarity-stat-value">
                {similarityStats.avg_similarity 
                  ? (parseFloat(similarityStats.avg_similarity) * 100).toFixed(2) + '%'
                  : 'N/A'}
              </span>
            </div>
            <div className="similarity-stat-item">
              <span className="similarity-stat-label">Min Similarity:</span>
              <span className="similarity-stat-value">
                {similarityStats.min_similarity 
                  ? (parseFloat(similarityStats.min_similarity) * 100).toFixed(2) + '%'
                  : 'N/A'}
              </span>
            </div>
            <div className="similarity-stat-item">
              <span className="similarity-stat-label">Max Similarity:</span>
              <span className="similarity-stat-value">
                {similarityStats.max_similarity 
                  ? (parseFloat(similarityStats.max_similarity) * 100).toFixed(2) + '%'
                  : 'N/A'}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Indexes Info */}
      {indexes && indexes.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.9 }}
          className="info-card"
        >
          <h3>Vector Indexes ({indexes.length})</h3>
          <div className="indexes-list">
            {indexes.map((idx, index) => (
              <div key={index} className="index-item">
                <div className="index-name">{idx.indexname}</div>
                <div className="index-table">{idx.tablename}</div>
                <div className="index-definition">{idx.indexdef}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default VectorHealth;

