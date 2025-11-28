# Quick Deployment - Step by Step

**Your Server Info:**
- IP: 47.250.116.135
- User: root
- Key: `intern-ppk.pem`
- Database: Already running on server (use `localhost`)

## Step 1: Install PuTTY (if not installed)

Download and install PuTTY: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html

Add to PATH or use full path to `plink.exe` and `pscp.exe`

## Step 2: Test Connection

Open PowerShell in your project directory:

```powershell
cd C:\Users\wahaj\Documents\expriment\chatbot

# Test connection
plink -i "intern-ppk.pem" root@47.250.116.135 "echo 'Connected'"
```

## Step 3: Install Prerequisites on Server

```powershell
# Install Node.js
plink -i "intern-ppk.pem" root@47.250.116.135 "curl -fsSL https://deb.nodesource.com/setup_18.x | bash -"
plink -i "intern-ppk.pem" root@47.250.116.135 "apt-get install -y nodejs"

# Install PM2
plink -i "intern-ppk.pem" root@47.250.116.135 "npm install -g pm2"

# Install Nginx
plink -i "intern-ppk.pem" root@47.250.116.135 "apt-get update"
plink -i "intern-ppk.pem" root@47.250.116.135 "apt-get install -y nginx"
```

## Step 4: Create Directories on Server

```powershell
plink -i "intern-ppk.pem" root@47.250.116.135 "mkdir -p /var/www/chatbot"
plink -i "intern-ppk.pem" root@47.250.116.135 "mkdir -p /var/log/chatbot"
plink -i "intern-ppk.pem" root@47.250.116.135 "mkdir -p /var/www/chatbot/uploads"
```

## Step 5: Build Frontend Locally

```powershell
cd frontend
npm install
npm run build
cd ..
```

## Step 6: Upload Files to Server

**Option A: Upload everything (excluding node_modules)**

```powershell
# Create archive (excludes node_modules)
tar --exclude='node_modules' --exclude='.git' --exclude='frontend/node_modules' --exclude='.env' -czf chatbot.tar.gz .

# Upload archive
pscp -i "intern-ppk.pem" chatbot.tar.gz root@47.250.116.135:/var/www/

# Extract on server
plink -i "intern-ppk.pem" root@47.250.116.135 "cd /var/www && tar -xzf chatbot.tar.gz -C chatbot && rm chatbot.tar.gz"
```

**Option B: Upload files one by one (if tar not available)**

```powershell
# Upload main files
pscp -i "intern-ppk.pem" server.js root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" package.json root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" package-lock.json root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" ecosystem.config.js root@47.250.116.135:/var/www/chatbot/

# Upload directories
pscp -i "intern-ppk.pem" -r config root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" -r routes root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" -r services root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" -r utils root@47.250.116.135:/var/www/chatbot/
pscp -i "intern-ppk.pem" -r scripts root@47.250.116.135:/var/www/chatbot/

# Upload frontend build
pscp -i "intern-ppk.pem" -r frontend/build root@47.250.116.135:/var/www/chatbot/frontend/
pscp -i "intern-ppk.pem" frontend/package.json root@47.250.116.135:/var/www/chatbot/frontend/
```

## Step 7: Create .env File on Server

Connect to server and create .env:

```powershell
# Connect to server
plink -i "intern-ppk.pem" root@47.250.116.135
```

Then on the server, run:

```bash
cd /var/www/chatbot
nano .env
```

Paste this (update with your actual values):

```env
# Database Configuration (DB is on same server - use localhost)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=your_actual_password_here

# Alibaba LLM Configuration
ALIBABA_LLM_API_KEY=your_actual_api_key_here
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

Save: `Ctrl+X`, then `Y`, then `Enter`

## Step 8: Install Dependencies and Start App

On the server (still connected via plink):

```bash
cd /var/www/chatbot

# Install dependencies
npm install --production

# Start with PM2
pm2 start ecosystem.config.js

# Or if ecosystem.config.js doesn't work:
pm2 start server.js --name chatbot-api

# Save PM2 configuration
pm2 save

# Enable PM2 on boot
pm2 startup
# Copy and run the command it shows
```

## Step 9: Test Application

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs chatbot-api

# Test API
curl http://localhost:3000/api/health
```

## Step 10: Configure Nginx (Optional but Recommended)

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

## Quick Commands Reference

**Connect to server:**
```powershell
plink -i "intern-ppk.pem" root@47.250.116.135
```

**View logs:**
```bash
pm2 logs chatbot-api
```

**Restart app:**
```bash
pm2 restart chatbot-api
```

**Check status:**
```bash
pm2 status
```

## Troubleshooting

**Can't connect?**
- Check key file path is correct
- Make sure PuTTY is installed
- Try: `plink -i "intern-ppk.pem" root@47.250.116.135`

**App won't start?**
- Check logs: `pm2 logs chatbot-api`
- Test database: `node scripts/test-db-connection.js`
- Check .env file has correct values

**Database connection failed?**
- Since DB is on same server, use `DB_HOST=localhost`
- Check PostgreSQL is running: `systemctl status postgresql`
- Verify credentials in .env match your database

## Done! ✅

Your app should now be running at `http://47.250.116.135:3000` (or via Nginx if configured)






