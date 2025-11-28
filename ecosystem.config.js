module.exports = {
  apps: [{
    name: 'chatbot-api',
    script: 'server.js',
    instances: 2, // Use 2 instances for load balancing
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/chatbot/error.log',
    out_file: '/var/log/chatbot/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '500M',
    watch: false,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    // Restart on crash
    max_restarts: 10,
    min_uptime: '10s'
  }]
};






