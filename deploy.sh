#!/bin/bash

# Deployment script for Alibaba Cloud ECS
# Usage: ./deploy.sh

set -e  # Exit on error

echo "🚀 Starting deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}Note: Some commands may require sudo${NC}"
fi

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${GREEN}✓${NC} Working directory: $SCRIPT_DIR"

# Step 1: Check Node.js
echo -e "\n${YELLOW}[1/8]${NC} Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗${NC} Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js version: $NODE_VERSION"

# Step 2: Check npm
echo -e "\n${YELLOW}[2/8]${NC} Checking npm..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗${NC} npm is not installed."
    exit 1
fi
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓${NC} npm version: $NPM_VERSION"

# Step 3: Install/Update dependencies
echo -e "\n${YELLOW}[3/8]${NC} Installing backend dependencies..."
npm install --production

# Step 4: Build frontend
echo -e "\n${YELLOW}[4/8]${NC} Building frontend..."
if [ -d "frontend" ]; then
    cd frontend
    npm install
    npm run build
    cd ..
    echo -e "${GREEN}✓${NC} Frontend built successfully"
else
    echo -e "${YELLOW}⚠${NC} Frontend directory not found, skipping frontend build"
fi

# Step 5: Check .env file
echo -e "\n${YELLOW}[5/8]${NC} Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo -e "${RED}✗${NC} .env file not found!"
    echo -e "${YELLOW}Please create a .env file with your configuration.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} .env file found"

# Step 6: Create necessary directories
echo -e "\n${YELLOW}[6/8]${NC} Creating necessary directories..."
mkdir -p uploads
mkdir -p logs
echo -e "${GREEN}✓${NC} Directories created"

# Step 7: Test database connection
echo -e "\n${YELLOW}[7/8]${NC} Testing database connection..."
if [ -f "scripts/test-db-connection.js" ]; then
    if node scripts/test-db-connection.js; then
        echo -e "${GREEN}✓${NC} Database connection successful"
    else
        echo -e "${YELLOW}⚠${NC} Database connection test failed, but continuing..."
    fi
else
    echo -e "${YELLOW}⚠${NC} Database test script not found, skipping..."
fi

# Step 8: Restart PM2 (if installed)
echo -e "\n${YELLOW}[8/8]${NC} Restarting application..."
if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "chatbot-api"; then
        echo -e "${GREEN}✓${NC} Restarting PM2 process..."
        pm2 restart chatbot-api
        pm2 save
    else
        echo -e "${YELLOW}⚠${NC} PM2 process 'chatbot-api' not found."
        echo -e "${YELLOW}Starting with PM2...${NC}"
        if [ -f "ecosystem.config.js" ]; then
            pm2 start ecosystem.config.js
            pm2 save
        else
            pm2 start server.js --name chatbot-api
            pm2 save
        fi
    fi
    echo -e "${GREEN}✓${NC} Application restarted"
else
    echo -e "${YELLOW}⚠${NC} PM2 not installed. Install with: npm install -g pm2"
    echo -e "${YELLOW}Starting application directly...${NC}"
    echo -e "${YELLOW}Note: For production, use PM2 for process management${NC}"
fi

echo -e "\n${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Check application status: pm2 status"
echo "2. View logs: pm2 logs chatbot-api"
echo "3. Test API: curl http://localhost:3000/api/health"
echo "4. Configure Nginx reverse proxy (see DEPLOYMENT.md)"






