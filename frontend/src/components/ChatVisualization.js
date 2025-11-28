import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import './ChatVisualization.css';

const ChatVisualization = ({ type = 'bar', data, title }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  // Filter out invalid data points
  const validData = data.filter(item => 
    item && 
    item.name && 
    typeof item.value === 'number' && 
    !isNaN(item.value) && 
    item.value > 0
  );

  if (validData.length === 0) {
    return null;
  }

  const renderChart = () => {
    // Always render bar chart as requested
    return (
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={validData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 240, 255, 0.1)" />
              <XAxis 
                dataKey="name" 
                stroke="var(--text-secondary)"
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              />
              <YAxis 
                stroke="var(--text-secondary)"
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)'
                }}
              />
              <Bar dataKey="value" fill="var(--primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
    );
  };

  return (
    <div className="chat-visualization">
      {title && <div className="visualization-title">{title}</div>}
      <div className="visualization-chart">
        {renderChart()}
      </div>
      <div className="visualization-info">
        Showing {validData.length} data point{validData.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default ChatVisualization;

