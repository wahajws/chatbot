import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
import './Analytics.css';

import { getApiBaseUrl } from '../utils/apiConfig';

// Get API URL at runtime to ensure it uses current hostname
const getApiUrl = () => getApiBaseUrl();

const COLORS = ['#00f0ff', '#7c3aed', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

const Analytics = () => {
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // New LLM-powered features
  const [queryLoading, setQueryLoading] = useState(false);
  const [customCharts, setCustomCharts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedChart, setSelectedChart] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState([]);

  useEffect(() => {
    fetchAnalytics();
    fetchSuggestions();
    loadQueryHistory();
  }, []);

  const loadQueryHistory = () => {
    const saved = localStorage.getItem('analytics_query_history');
    if (saved) {
      try {
        setQueryHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading query history:', e);
      }
    }
  };

  const saveQueryToHistory = (queryText, chart) => {
    const newHistory = [
      { query: queryText, chart: chart, timestamp: new Date().toISOString() },
      ...queryHistory.slice(0, 9) // Keep last 10
    ];
    setQueryHistory(newHistory);
    localStorage.setItem('analytics_query_history', JSON.stringify(newHistory));
  };

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      const statsRes = await axios.get(`${apiUrl}/api/analytics/stats`);
      const chartsRes = await axios.get(`${apiUrl}/api/analytics/charts`);

      setStats(statsRes.data?.stats || null);
      setCharts(chartsRes.data?.charts || []);
    } catch (err) {
      console.error('Error fetching analytics:', err);
      setError(err.response?.data?.message || 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const apiUrl = getApiUrl();
      const res = await axios.get(`${apiUrl}/api/analytics/suggestions`);
      if (res.data.success) {
        setSuggestions(res.data.suggestions || []);
      }
    } catch (err) {
      console.error('Error fetching suggestions:', err);
      // Use fallback suggestions if API fails
      setSuggestions([
        'Show me sales trends over the last 6 months',
        'What are the top 10 products by quantity?',
        'Compare revenue between this year and last year',
        'Show me order distribution by status',
        'Which day of the week has the most orders?'
      ]);
    }
  };

  const handleQuery = async (queryText) => {
    if (!queryText || !queryText.trim()) return;

    try {
      setQueryLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      const res = await axios.post(`${apiUrl}/api/analytics/query`, {
        query: queryText.trim()
      });

      if (res.data.success && res.data.chart) {
        const newChart = {
          ...res.data.chart,
          id: Date.now(),
          isCustom: true
        };
        setCustomCharts(prev => [newChart, ...prev]);
        setSelectedChart(newChart);
        saveQueryToHistory(queryText.trim(), newChart);
      } else {
        setError(res.data.message || 'Could not generate chart from query');
      }
    } catch (err) {
      console.error('Error processing query:', err);
      const errorMessage = err.response?.data?.error || 
                          err.response?.data?.details || 
                          err.message || 
                          'Failed to process query';
      setError(errorMessage);
      
      // Log more details for debugging
      if (err.response?.data?.sql) {
        console.log('Generated SQL:', err.response.data.sql);
      }
    } finally {
      setQueryLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    if (queryLoading) return; // Prevent multiple clicks
    handleQuery(suggestion);
  };

  const generateInsights = async (chart) => {
    if (!chart) return;

    try {
      setInsightsLoading(true);
      const apiUrl = getApiUrl();
      const res = await axios.post(`${apiUrl}/api/analytics/insights`, {
        chart: chart,
        query: chart.title
      });

      if (res.data.success) {
        setInsights({
          chartId: chart.id,
          text: res.data.insights
        });
      }
    } catch (err) {
      console.error('Error generating insights:', err);
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleChartClick = (chart) => {
    setSelectedChart(chart);
    if (chart.id && (!insights || insights.chartId !== chart.id)) {
      generateInsights(chart);
    }
  };

  const deleteCustomChart = (chartId) => {
    setCustomCharts(prev => prev.filter(c => c.id !== chartId));
    if (selectedChart?.id === chartId) {
      setSelectedChart(null);
      setInsights(null);
    }
  };

  const renderChart = (chart, index, isCustom = false) => {
    if (!chart.data || chart.data.length === 0) return null;

    const chartProps = {
      data: chart.data,
      margin: { top: 20, right: 30, left: 20, bottom: 60 }
    };

    // Check if chart has multiple value columns (for grouped charts)
    const hasMultipleValues = chart.data.length > 0 && 
      Object.keys(chart.data[0]).filter(k => k !== 'name').length > 1;

    switch (chart.type) {
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={300} key={index}>
            <PieChart>
              <Pie
                data={chart.data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chart.data.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={300} key={index}>
            <LineChart {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 240, 255, 0.1)" />
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)"
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="var(--text-secondary)" />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
              <Legend />
              {hasMultipleValues ? (
                Object.keys(chart.data[0])
                  .filter(k => k !== 'name')
                  .map((key, idx) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={COLORS[idx % COLORS.length]}
                      strokeWidth={3}
                      dot={{ fill: COLORS[idx % COLORS.length], r: 5 }}
                      name={key}
                    />
                  ))
              ) : (
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={3}
                  dot={{ fill: COLORS[index % COLORS.length], r: 5 }}
                  name="Value"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'yearonyear':
        return (
          <ResponsiveContainer width="100%" height={300} key={index}>
            <BarChart {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 240, 255, 0.1)" />
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)"
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="var(--text-secondary)" />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff'
                }}
                formatter={(value) => typeof value === 'number' ? value.toLocaleString() : value}
              />
              <Legend />
              {Object.keys(chart.data[0])
                .filter(k => k !== 'name')
                .map((key, idx) => (
                  <Bar 
                    key={key}
                    dataKey={key} 
                    fill={COLORS[idx % COLORS.length]}
                    name={key}
                  />
                ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={300} key={index}>
            <BarChart {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 240, 255, 0.1)" />
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)"
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis stroke="var(--text-secondary)" />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
              <Legend />
              {hasMultipleValues ? (
                Object.keys(chart.data[0])
                  .filter(k => k !== 'name')
                  .map((key, idx) => (
                    <Bar 
                      key={key}
                      dataKey={key} 
                      fill={COLORS[idx % COLORS.length]}
                      name={key}
                    />
                  ))
              ) : (
                <Bar 
                  dataKey="value" 
                  fill={COLORS[index % COLORS.length]}
                  name="Value"
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  if (loading) {
    return (
      <div className="analytics-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading analytics dashboard...</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="analytics-container">
        <div className="error-message">
          <p>{error}</p>
          <button onClick={fetchAnalytics}>Retry</button>
        </div>
      </div>
    );
  }

  const allCharts = [...customCharts, ...charts];

  return (
    <div className="analytics-container">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="analytics-header"
      >
        <div className="header-content">
          <div>
            <h1>Database Analytics Dashboard</h1>
            <p>AI-powered insights and natural language queries</p>
          </div>
          <button onClick={fetchAnalytics} className="refresh-btn">
            🔄 Refresh
          </button>
        </div>
      </motion.div>

      {/* Smart Suggestions Cards */}
      {suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="suggestions-section-main"
        >
          <div className="suggestions-header-main">
            <h2>💡 Smart Query Suggestions</h2>
            <p>Click any suggestion to generate a chart</p>
          </div>
          <div className="suggestions-grid">
            {suggestions.map((suggestion, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.1 + (idx * 0.05) }}
                className={`suggestion-card ${queryLoading ? 'loading' : ''}`}
                onClick={() => handleSuggestionClick(suggestion)}
              >
                <div className="suggestion-card-icon">📊</div>
                <div className="suggestion-card-content">
                  <p className="suggestion-card-text">{suggestion}</p>
                </div>
                <div className="suggestion-card-arrow">
                  {queryLoading ? '⏳' : '→'}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Queries Cards */}
      {queryHistory.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="suggestions-section-main"
        >
          <div className="suggestions-header-main">
            <h2>📜 Recent Queries</h2>
            <p>Your recently executed queries</p>
          </div>
          <div className="suggestions-grid">
            {queryHistory.slice(0, 6).map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.2 + (idx * 0.05) }}
                className={`suggestion-card history-card ${queryLoading ? 'loading' : ''}`}
                onClick={() => handleSuggestionClick(item.query)}
              >
                <div className="suggestion-card-icon">🕒</div>
                <div className="suggestion-card-content">
                  <p className="suggestion-card-text">{item.query}</p>
                </div>
                <div className="suggestion-card-arrow">
                  {queryLoading ? '⏳' : '→'}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="stats-grid">
          <StatCard
            title="Total Tables"
            value={stats.totalTables?.toLocaleString() || 'N/A'}
            icon="📊"
            color="var(--primary)"
            delay={0.1}
          />
          <StatCard
            title="Total Rows"
            value={stats.totalRows?.toLocaleString() || 'N/A'}
            icon="📈"
            color="var(--secondary)"
            delay={0.2}
          />
          <StatCard
            title="Largest Table"
            value={stats.largestTable?.name || 'N/A'}
            subValue={stats.largestTable?.rowCount ? `${stats.largestTable.rowCount.toLocaleString()} rows` : ''}
            icon="🗄️"
            color="var(--accent)"
            delay={0.3}
          />
          <StatCard
            title="Database Size"
            value={stats.databaseSize || 'Unknown'}
            icon="💾"
            color="var(--success)"
            delay={0.4}
          />
        </div>
      )}

      {/* Error Message */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="error-banner"
        >
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </motion.div>
      )}

      {/* Custom Charts Section */}
      {customCharts.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="section-header"
        >
          <h2>Your Custom Queries</h2>
        </motion.div>
      )}

      {/* Charts Grid */}
      {allCharts.length > 0 ? (
        <div className="charts-grid">
          {allCharts.map((chart, index) => (
            <motion.div
              key={chart.id || index}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 + (index * 0.1) }}
              className={`chart-card ${selectedChart?.id === chart.id ? 'selected' : ''} ${chart.isCustom ? 'custom-chart' : ''}`}
              onClick={() => handleChartClick(chart)}
            >
              <div className="chart-header">
                <div>
                  <h3>{chart.title}</h3>
                  {chart.description && (
                    <p className="chart-description">{chart.description}</p>
                  )}
                </div>
                {chart.isCustom && (
                  <button
                    className="delete-chart-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCustomChart(chart.id);
                    }}
                    title="Delete chart"
                  >
                    ✕
                  </button>
                )}
              </div>
              {renderChart(chart, index, chart.isCustom)}
              <div className="chart-footer">
                <span className="chart-badge">{chart.type.toUpperCase()}</span>
                <span className="chart-count">{chart.data.length} data points</span>
                {chart.isCustom && (
                  <span className="custom-badge">CUSTOM</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="no-charts-message"
        >
          <p>No charts available. Try asking a question above or wait for the system to generate visualizations.</p>
          <button onClick={fetchAnalytics}>Refresh</button>
        </motion.div>
      )}

      {/* AI Insights Panel */}
      <AnimatePresence>
        {selectedChart && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="insights-panel"
          >
            <div className="insights-header">
              <h3>🤖 AI Insights</h3>
              <button onClick={() => {
                setSelectedChart(null);
                setInsights(null);
              }}>✕</button>
            </div>
            <div className="insights-content">
              {insightsLoading ? (
                <div className="insights-loading">
                  <div className="spinner-small"></div>
                  <span>Analyzing data...</span>
                </div>
              ) : insights && insights.chartId === selectedChart.id ? (
                <div className="insights-text">
                  {insights.text.split('\n').map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              ) : (
                <div className="insights-placeholder">
                  <p>Click "Generate Insights" to get AI-powered analysis</p>
                  <button onClick={() => generateInsights(selectedChart)} className="generate-insights-btn">
                    Generate Insights
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StatCard = ({ title, value, subValue, icon, color, delay }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="stat-card"
      style={{ '--card-color': color }}
    >
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <h3>{title}</h3>
        <p className="stat-value">{value}</p>
        {subValue && <p className="stat-subvalue">{subValue}</p>}
      </div>
      <div className="stat-glow" style={{ background: color }}></div>
    </motion.div>
  );
};

export default Analytics;
