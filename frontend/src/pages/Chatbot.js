import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ChatVisualization from '../components/ChatVisualization';
import { detectVisualization, generateChartData } from '../utils/visualizationDetector';
import './Chatbot.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const Chatbot = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Load chat history
    loadChatHistory();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadChatHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/chat/history?limit=10`);
      if (response.data.success && response.data.messages.length > 0) {
        const formattedMessages = response.data.messages
          .reverse()
          .flatMap(msg => [
            { type: 'user', content: msg.message, timestamp: msg.created_at },
            { type: 'assistant', content: msg.response, timestamp: msg.created_at }
          ]);
        setMessages(formattedMessages);
      }
    } catch (err) {
      console.error('Error loading chat history:', err);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setError(null);

    // Add user message
    const newUserMessage = {
      type: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, newUserMessage]);
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/chat`, {
        message: userMessage
      });

      if (response.data.success) {
        const responseText = response.data.response;
        
        // Only show chart if backend explicitly provides chart data
        // (which only happens when user explicitly requests a chart)
        let visualization = null;
        if (response.data.chartData && 
            response.data.chartData.data && 
            response.data.chartData.data.length > 0) {
          visualization = response.data.chartData;
        }
        
        const assistantMessage = {
          type: 'assistant',
          content: responseText,
          timestamp: response.data.createdAt,
          visualization: visualization
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error('Failed to get response');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to send message. Please try again.');
      const errorMessage = {
        type: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const suggestedQuestions = [
    "Show me revenue trends",
    "Display product sales comparison",
    "What's our total revenue?",
    "Show product category distribution",
    "Compare order statistics"
  ];

  return (
    <div className="chatbot-container">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="chatbot-header"
      >
        <div>
          <h1>Smart Chat Assistant</h1>
          <p>Ask questions about your database</p>
        </div>
        <div className="chat-status">
          <div className="status-indicator"></div>
          <span>Online</span>
        </div>
      </motion.div>

      <div className="chat-wrapper">
        <div className="messages-container">
          <AnimatePresence>
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="welcome-message"
              >
                <div className="welcome-icon">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2>Welcome to AMAST Smart Chat</h2>
                <p>I can help you explore your database. Try asking:</p>
                <div className="suggested-questions">
                  {suggestedQuestions.map((question, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="suggested-question"
                      onClick={() => setInput(question)}
                    >
                      {question}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}

            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="message-bubble assistant loading"
              >
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <form onSubmit={handleSend} className="input-container">
          <div className="input-wrapper">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask a question about your database..."
              disabled={loading}
              className="chat-input"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="send-button"
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const MessageBubble = ({ message }) => {
  const isUser = message.type === 'user';
  const isError = message.isError;
  const hasVisualization = message.visualization && message.visualization.data;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`message-bubble ${isUser ? 'user' : 'assistant'} ${isError ? 'error' : ''}`}
    >
      <div className="message-avatar">
        {isUser ? (
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div className="message-content">
        <div className="message-text">{message.content}</div>
        
        {hasVisualization && (
          <ChatVisualization
            type={message.visualization.type}
            data={message.visualization.data}
            title={message.visualization.title}
          />
        )}
        
        {message.timestamp && (
          <div className="message-time">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Chatbot;

