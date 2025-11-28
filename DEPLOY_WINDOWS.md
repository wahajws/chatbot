# Windows Deployment Guide - Alibaba Cloud

## Quick Start

You have:
- **Server IP**: 47.250.116.135
- **User**: root
- **SSH Key**: `intern-ppk.pem` (PPK format)
- **Database**: Already running on server

## Option 1: Automated Deployment (Recommended)

### Prerequisites

1. **Install PuTTY** (for PPK key support):
   - Download: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html
   - Install and add to PATH (or use full path to plink/pscp)

2. **OR Install OpenSSH** (Windows 10+):
   - Usually pre-installed
   - Convert PPK to OpenSSH format using PuTTYgen

### Run Deployment Script

```powershell
# In PowerShell, navigate to project directory
cd C:\Users\wahaj\Documents\expriment\chatbot

# Run deployment script
.\deploy-windows.ps1
```

The script will:
- ✅ Connect to server
- ✅ Install Node.js, PM2, Nginx
- ✅ Upload your code
- ✅ Install dependencies
- ✅ Start the application

## Option 2: Manual Deployment

### Step 1: Convert PPK to OpenSSH (if using OpenSSH)

1. Open **PuTTYgen** (comes with PuTTY)
2. Click **Load** → Select `intern-ppk.pem`
3. Click **Conversions** → **Export OpenSSH key**
4. Save as `intern-openssh.pem` (same directory)

### Step 2: Connect to Server

**Using PuTTY:**
```powershell
plink -i "intern-ppk.pem" root@47.250.116.135
```

**Using OpenSSH:**
```powershell
ssh -i "intern-openssh.pem" root@47.250.116.135
```

### Step 3: Install Prerequisites on Server

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Install Nginx
apt-get update
apt-get install -y nginx
```

### Step 4: Upload Code

**Using PuTTY (pscp):**
```powershell
# Upload entire project
pscp -i "intern-ppk.pem" -r . root@47.250.116.135:/var/www/chatbot/
```

**Using OpenSSH (scp):**
```powershell
# Upload entire project
scp -i "intern-openssh.pem" -r . root@47.250.116.135:/var/www/chatbot/
```

**Exclude unnecessary files:**
```powershell
# Create archive excluding node_modules
tar --exclude='node_modules' --exclude='.git' --exclude='frontend/node_modules' -czf chatbot.tar.gz .
scp -i "intern-openssh.pem" chatbot.tar.gz root@47.250.116.135:/var/www/
# Then on server: tar -xzf chatbot.tar.gz -C /var/www/chatbot
```

### Step 5: Configure on Server

```bash
# SSH to server
ssh -i "intern-openssh.pem" root@47.250.116.135

# Navigate to app directory
cd /var/www/chatbot

# Create .env file
nano .env
```

Add your configuration (database is on same server, use `localhost`):

```env
# Database Configuration (DB is on same server)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=your_password_here

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

### Step 6: Install Dependencies and Build

```bash
# Install backend dependencies
npm install --production

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Create necessary directories
mkdir -p uploads
mkdir -p /var/log/chatbot
```

### Step 7: Start Application

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Or if ecosystem.config.js doesn't exist:
pm2 start server.js --name chatbot-api

# Save PM2 configuration
pm2 save

# Enable PM2 on system boot
pm2 startup
# Follow the instructions shown
```

### Step 8: Configure Nginx

```bash
# Copy nginx config
cp nginx.conf.example /etc/nginx/sites-available/chatbot

# Edit config (update domain name)
nano /etc/nginx/sites-available/chatbot

# Enable site
ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Reload Nginx
systemctl reload nginx
```

### Step 9: Set Up SSL (Optional but Recommended)

```bash
# Install Certbot
apt-get install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Verify Deployment

### Check Application Status

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs chatbot-api

# Check if app is running
curl http://localhost:3000/api/health
```

### Test from Your Local Machine

```powershell
# Test API endpoint
curl http://47.250.116.135:3000/api/health
```

## Troubleshooting

### Connection Issues

**Problem**: Can't connect with SSH key
```powershell
# Check key permissions (Linux/OpenSSH)
# On server, ensure key has correct permissions:
chmod 600 intern-openssh.pem
```

**Problem**: PuTTY asks for password
- Make sure you're using the correct key file
- Check if key is in correct format (PPK for PuTTY, PEM for OpenSSH)

### Application Won't Start

```bash
# Check logs
pm2 logs chatbot-api --lines 50

# Check if port is in use
netstat -tulpn | grep 3000

# Test database connection
cd /var/www/chatbot
node scripts/test-db-connection.js
```

### Database Connection Failed

Since database is on the same server:
- Use `DB_HOST=localhost` in .env
- Check PostgreSQL is running: `systemctl status postgresql`
- Verify credentials match your database setup
- Check PostgreSQL allows local connections: `/etc/postgresql/*/main/pg_hba.conf`

### Nginx 502 Bad Gateway

```bash
# Check if app is running
pm2 status

# Check Nginx error logs
tail -f /var/log/nginx/error.log

# Check Nginx configuration
nginx -t
```

## Quick Commands Reference

```bash
# View application logs
pm2 logs chatbot-api

# Restart application
pm2 restart chatbot-api

# Stop application
pm2 stop chatbot-api

# View Nginx logs
tail -f /var/log/nginx/chatbot_error.log

# Restart Nginx
systemctl restart nginx

# Check application status
pm2 monit
```

## Security Notes

1. **Firewall**: Configure Alibaba Cloud Security Group
   - Allow: 22 (SSH), 80 (HTTP), 443 (HTTPS)
   - Block: 3000 (API port - only accessible via Nginx)

2. **SSH Key**: Keep your PPK/PEM file secure, never commit to Git

3. **Environment Variables**: Keep .env file secure on server

4. **Database**: Since DB is on same server, use localhost for better security

## Next Steps

1. ✅ Application deployed
2. ⬜ Configure domain name (if you have one)
3. ⬜ Set up SSL certificate
4. ⬜ Configure monitoring
5. ⬜ Set up backups

For detailed instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)






