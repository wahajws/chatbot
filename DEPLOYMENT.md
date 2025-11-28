# Deployment Guide for Alibaba Cloud

This guide will help you deploy your Chatbot API application on Alibaba Cloud ECS (Elastic Compute Service).

## Prerequisites

1. **Alibaba Cloud Account** with ECS access
2. **Alibaba Cloud RDS PostgreSQL** (or self-hosted PostgreSQL)
3. **Domain name** (optional, for production)
4. **SSH access** to your ECS instance

## Step 1: Create Alibaba Cloud ECS Instance

1. Log in to [Alibaba Cloud Console](https://ecs.console.aliyun.com/)
2. Create a new ECS instance:
   - **Instance Type**: ecs.t6-c1m2.large or higher (2 vCPU, 4GB RAM minimum)
   - **OS**: Ubuntu 22.04 LTS or CentOS 7/8
   - **Network**: VPC with public IP
   - **Security Group**: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (API - optional)
   - **Storage**: 40GB+ SSD

## Step 2: Set Up PostgreSQL Database

### Option A: Use Alibaba Cloud RDS PostgreSQL (Recommended)

1. Create RDS PostgreSQL instance:
   - **Engine**: PostgreSQL 14+
   - **Instance Type**: rds.pg.s1.small or higher
   - **Storage**: 20GB+ SSD
   - **Network**: Same VPC as ECS

2. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. Note down connection details:
   - Host (Internal endpoint)
   - Port (usually 5432)
   - Database name
   - Username
   - Password

### Option B: Install PostgreSQL on ECS

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Install pgvector extension
sudo apt install postgresql-14-pgvector  # Adjust version as needed

# Create database and user
sudo -u postgres psql
CREATE DATABASE nv_ams;
CREATE USER dev_chatbot WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE nv_ams TO dev_chatbot;
\c nv_ams
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

## Step 3: Connect to ECS Instance

```bash
ssh root@your_ecs_public_ip
# or
ssh ubuntu@your_ecs_public_ip
```

## Step 4: Install Required Software

### Install Node.js (v18+)

```bash
# Using NodeSource repository (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

## Step 5: Deploy Application

### Clone or Upload Your Code

```bash
# Option 1: Clone from Git
cd /var/www
sudo git clone https://your-repo-url.git chatbot
cd chatbot

# Option 2: Upload via SCP from local machine
# On your local machine:
scp -r ./chatbot root@your_ecs_ip:/var/www/
```

### Install Dependencies

```bash
cd /var/www/chatbot
npm install

# Install frontend dependencies
cd frontend
npm install
npm run build
cd ..
```

## Step 6: Configure Environment Variables

```bash
cd /var/www/chatbot
nano .env
```

Add your configuration:

```env
# Database Configuration (Use RDS internal endpoint for better performance)
DB_HOST=your-rds-internal-endpoint.rds.aliyuncs.com
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=your_secure_password

# Alibaba LLM Configuration
ALIBABA_LLM_API_KEY=your_api_key
ALIBABA_LLM_API_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
ALIBABA_LLM_API_MODEL=qwen-plus

# Embedding Configuration
EMBEDDING_MODEL=text-embedding-v1
EMBEDDING_API_URL=https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding
EMBEDDING_ENABLED=true
EMBEDDING_SILENT_MODE=false

# Auto-migration Configuration
AUTO_MIGRATE_EMBEDDINGS=true
EMBEDDING_BATCH_SIZE=10
EMBEDDING_BATCH_DELAY=2000

# Application Configuration
UPLOAD_DIR=/var/www/chatbot/uploads
PORT=3000
NODE_ENV=production
```

**Important**: 
- Use RDS **internal endpoint** (not public) for better performance and security
- Keep `.env` file secure and never commit it to Git

## Step 7: Set Up PM2 Process Manager

Create PM2 ecosystem file:

```bash
cd /var/www/chatbot
nano ecosystem.config.js
```

Add the following:

```javascript
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
    watch: false
  }]
};
```

Create log directory:

```bash
sudo mkdir -p /var/log/chatbot
sudo chown -R $USER:$USER /var/log/chatbot
```

Start the application:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# Follow the instructions to enable PM2 on system boot
```

## Step 8: Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/chatbot
```

Add the following configuration:

```nginx
# Upstream for load balancing
upstream chatbot_backend {
    least_conn;
    server localhost:3000;
    # Add more instances if needed:
    # server localhost:3001;
}

# HTTP server (redirect to HTTPS)
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Redirect all HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL certificates (use Let's Encrypt - see Step 9)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/chatbot_access.log;
    error_log /var/log/nginx/chatbot_error.log;

    # API endpoints
    location /api {
        proxy_pass http://chatbot_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Frontend static files
    location / {
        root /var/www/chatbot/frontend/build;
        try_files $uri $uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Health check endpoint
    location /api/health {
        proxy_pass http://chatbot_backend;
        access_log off;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Step 9: Set Up SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal (already set up by certbot)
sudo certbot renew --dry-run
```

## Step 10: Configure Firewall

```bash
# Ubuntu (UFW)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## Step 11: Set Up Monitoring and Logs

### View PM2 Logs

```bash
pm2 logs chatbot-api
pm2 monit
```

### View Nginx Logs

```bash
sudo tail -f /var/log/nginx/chatbot_access.log
sudo tail -f /var/log/nginx/chatbot_error.log
```

### Set Up Log Rotation

```bash
sudo nano /etc/logrotate.d/chatbot
```

Add:

```
/var/log/chatbot/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $USER $USER
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

## Step 12: Update Frontend API URL

Update the frontend to use your production API:

```bash
cd /var/www/chatbot/frontend
nano .env.production
```

Add:

```
REACT_APP_API_URL=https://your-domain.com
```

Rebuild frontend:

```bash
npm run build
```

## Step 13: Test Deployment

1. **Test API endpoint:**
   ```bash
   curl https://your-domain.com/api/health
   ```

2. **Test frontend:**
   Open `https://your-domain.com` in browser

3. **Test chat:**
   ```bash
   curl -X POST https://your-domain.com/api/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello"}'
   ```

## Troubleshooting

### Application won't start

```bash
# Check PM2 status
pm2 status
pm2 logs chatbot-api --lines 50

# Check if port is in use
sudo netstat -tulpn | grep 3000

# Restart application
pm2 restart chatbot-api
```

### Database connection issues

```bash
# Test database connection
cd /var/www/chatbot
node scripts/test-db-connection.js

# Check RDS security group allows ECS IP
# Check database credentials in .env
```

### Nginx errors

```bash
# Check Nginx configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log

# Restart Nginx
sudo systemctl restart nginx
```

### High memory usage

```bash
# Monitor memory
pm2 monit

# Restart if needed
pm2 restart chatbot-api

# Adjust PM2 max_memory_restart in ecosystem.config.js
```

## Performance Optimization

1. **Enable Nginx caching** for static assets
2. **Use CDN** (Alibaba Cloud CDN) for frontend assets
3. **Enable database connection pooling** (already configured)
4. **Use Redis** for session storage (optional)
5. **Monitor with Alibaba Cloud CloudMonitor**

## Security Checklist

- [ ] Use strong database passwords
- [ ] Enable SSL/TLS (HTTPS)
- [ ] Configure firewall rules
- [ ] Keep Node.js and dependencies updated
- [ ] Use environment variables for secrets
- [ ] Enable RDS backup
- [ ] Set up log monitoring
- [ ] Configure rate limiting (optional)
- [ ] Use Alibaba Cloud Security Center

## Backup Strategy

1. **Database Backups:**
   - Enable automatic RDS backups
   - Set backup retention period (7-30 days)

2. **Application Backups:**
   ```bash
   # Backup application code
   tar -czf chatbot-backup-$(date +%Y%m%d).tar.gz /var/www/chatbot
   ```

3. **Automated Backup Script:**
   ```bash
   # Create backup script
   sudo nano /usr/local/bin/backup-chatbot.sh
   ```

## Maintenance

### Update Application

```bash
cd /var/www/chatbot
git pull origin main  # or upload new files
npm install
cd frontend
npm install
npm run build
cd ..
pm2 restart chatbot-api
```

### Update Dependencies

```bash
npm audit
npm update
pm2 restart chatbot-api
```

## Support

For issues:
1. Check logs: `pm2 logs` and `/var/log/nginx/`
2. Check Alibaba Cloud console for resource usage
3. Review application health: `curl https://your-domain.com/api/health`

## Additional Resources

- [Alibaba Cloud ECS Documentation](https://www.alibabacloud.com/help/en/ecs)
- [Alibaba Cloud RDS Documentation](https://www.alibabacloud.com/help/en/rds)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)






