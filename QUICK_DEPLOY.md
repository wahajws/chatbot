# Quick Deployment Guide - Alibaba Cloud

## TL;DR - Fast Deployment Steps

### 1. Prepare Your Server (5 minutes)

```bash
# Connect to your Alibaba Cloud ECS instance
ssh root@your-ecs-ip

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2 and Nginx
npm install -g pm2
apt-get install -y nginx
```

### 2. Upload Your Code (2 minutes)

```bash
# On your local machine, upload code to server
scp -r ./chatbot root@your-ecs-ip:/var/www/

# Or clone from Git
cd /var/www
git clone your-repo-url chatbot
```

### 3. Configure Environment (3 minutes)

```bash
cd /var/www/chatbot
nano .env
# Copy from .env.production.example and update with your values
```

### 4. Install & Build (5 minutes)

```bash
cd /var/www/chatbot
npm install
cd frontend && npm install && npm run build && cd ..

# Make deploy script executable
chmod +x deploy.sh
./deploy.sh
```

### 5. Configure Nginx (5 minutes)

```bash
# Copy nginx config
sudo cp nginx.conf.example /etc/nginx/sites-available/chatbot
sudo nano /etc/nginx/sites-available/chatbot
# Update 'your-domain.com' with your actual domain

# Enable site
sudo ln -s /etc/nginx/sites-available/chatbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Set Up SSL (5 minutes)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

### 7. Done! ✅

Your app should now be live at `https://your-domain.com`

## Common Commands

```bash
# Check app status
pm2 status
pm2 logs chatbot-api

# Restart app
pm2 restart chatbot-api

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# View logs
pm2 logs chatbot-api --lines 50
sudo tail -f /var/log/nginx/chatbot_error.log
```

## Troubleshooting

**App won't start?**
```bash
pm2 logs chatbot-api
node scripts/test-db-connection.js
```

**Database connection failed?**
- Check RDS security group allows ECS IP
- Verify credentials in `.env`
- Use RDS internal endpoint (not public)

**Nginx 502 error?**
- Check if app is running: `pm2 status`
- Check Nginx config: `sudo nginx -t`
- Check logs: `sudo tail -f /var/log/nginx/error.log`

## Important Notes

1. **Use RDS Internal Endpoint** - Better performance and security
2. **Keep .env Secure** - Never commit to Git
3. **Enable RDS Backups** - In Alibaba Cloud Console
4. **Monitor Resources** - Use Alibaba Cloud Monitor

For detailed instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)






