# Simple Deployment Script - Step by Step
# This script guides you through manual deployment steps

param(
    [string]$ServerIP = "47.250.116.135",
    [string]$ServerUser = "root",
    [string]$KeyPath = "intern-ppk.pem"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chatbot Deployment Guide" -ForegroundColor Cyan
Write-Host "  Server: $ServerUser@$ServerIP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Since the database is already on the server, we'll use 'localhost' for DB_HOST" -ForegroundColor Yellow
Write-Host ""

# Step 1: Check if PuTTY is available
Write-Host "[Step 1] Checking for PuTTY tools..." -ForegroundColor Green
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "⚠️  PuTTY not found. Please install PuTTY or use manual steps." -ForegroundColor Yellow
    Write-Host "Download: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or follow manual steps in DEPLOY_WINDOWS.md" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ PuTTY found" -ForegroundColor Green
Write-Host ""

# Step 2: Test connection
Write-Host "[Step 2] Testing server connection..." -ForegroundColor Green
$testCmd = "plink -i `"$KeyPath`" -batch $ServerUser@$ServerIP `"echo 'Connected'`""
try {
    $result = Invoke-Expression $testCmd 2>&1
    Write-Host "✅ Connection successful!" -ForegroundColor Green
} catch {
    Write-Host "❌ Connection failed. Check your key file and server IP." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Install prerequisites
Write-Host "[Step 3] Installing prerequisites on server..." -ForegroundColor Green
Write-Host "This will install Node.js, PM2, and Nginx" -ForegroundColor Yellow
$continue = Read-Host "Continue? (Y/N)"
if ($continue -ne "Y" -and $continue -ne "y") {
    Write-Host "Skipped. You can install manually later." -ForegroundColor Yellow
} else {
    Write-Host "Installing Node.js..." -ForegroundColor Cyan
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "curl -fsSL https://deb.nodesource.com/setup_18.x | bash -"
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "apt-get install -y nodejs"
    
    Write-Host "Installing PM2..." -ForegroundColor Cyan
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "npm install -g pm2"
    
    Write-Host "Installing Nginx..." -ForegroundColor Cyan
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "apt-get update"
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "apt-get install -y nginx"
    Write-Host "✅ Prerequisites installed" -ForegroundColor Green
}
Write-Host ""

# Step 4: Create directories
Write-Host "[Step 4] Creating directories on server..." -ForegroundColor Green
plink -i "$KeyPath" -batch $ServerUser@$ServerIP "mkdir -p /var/www/chatbot"
plink -i "$KeyPath" -batch $ServerUser@$ServerIP "mkdir -p /var/log/chatbot"
plink -i "$KeyPath" -batch $ServerUser@$ServerIP "mkdir -p /var/www/chatbot/uploads"
Write-Host "✅ Directories created" -ForegroundColor Green
Write-Host ""

# Step 5: Upload files
Write-Host "[Step 5] Uploading files to server..." -ForegroundColor Green
Write-Host "This may take a few minutes..." -ForegroundColor Yellow

# Exclude node_modules and other unnecessary files
$excludePatterns = @("node_modules", ".git", "frontend/node_modules", "frontend/build", ".env", "*.log")

# Create temp directory
$tempDir = "$env:TEMP\chatbot-upload-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Copy files
$items = @("server.js", "package.json", "package-lock.json", "ecosystem.config.js", "config", "routes", "services", "utils", "scripts")
foreach ($item in $items) {
    if (Test-Path $item) {
        Copy-Item -Path $item -Destination "$tempDir\$item" -Recurse -Force
        Write-Host "  ✓ $item" -ForegroundColor Gray
    }
}

# Build and copy frontend
if (Test-Path "frontend") {
    Write-Host "Building frontend..." -ForegroundColor Cyan
    Push-Location frontend
    npm install
    npm run build
    Pop-Location
    
    New-Item -ItemType Directory -Path "$tempDir\frontend" -Force | Out-Null
    Copy-Item -Path "frontend\build" -Destination "$tempDir\frontend\build" -Recurse -Force
    Copy-Item -Path "frontend\package.json" -Destination "$tempDir\frontend\package.json" -Force
    Write-Host "  ✓ frontend (built)" -ForegroundColor Gray
}

# Upload
Write-Host "Uploading to server..." -ForegroundColor Cyan
pscp -i "$KeyPath" -batch -r "$tempDir\*" "$ServerUser@${ServerIP}:/var/www/chatbot/"

# Cleanup
Remove-Item -Path $tempDir -Recurse -Force
Write-Host "✅ Files uploaded" -ForegroundColor Green
Write-Host ""

# Step 6: Create .env file
Write-Host "[Step 6] Setting up environment file..." -ForegroundColor Green
Write-Host "Since database is on the server, we'll use localhost" -ForegroundColor Yellow

$envTemplate = @"
# Database Configuration (DB is on same server - use localhost)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=YOUR_PASSWORD_HERE

# Alibaba LLM Configuration
ALIBABA_LLM_API_KEY=YOUR_API_KEY_HERE
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
"@

$tempEnv = "$env:TEMP\chatbot.env"
$envTemplate | Out-File -FilePath $tempEnv -Encoding utf8

Write-Host "⚠️  IMPORTANT: Update .env file with your actual credentials!" -ForegroundColor Yellow
Write-Host "Uploading template .env file..." -ForegroundColor Cyan
pscp -i "$KeyPath" -batch "$tempEnv" "$ServerUser@${ServerIP}:/var/www/chatbot/.env"
Remove-Item $tempEnv

Write-Host ""
Write-Host "Please edit .env file on server with correct values:" -ForegroundColor Yellow
Write-Host "  plink -i `"$KeyPath`" $ServerUser@$ServerIP" -ForegroundColor Gray
Write-Host "  nano /var/www/chatbot/.env" -ForegroundColor Gray
Write-Host ""

# Step 7: Install dependencies and start
Write-Host "[Step 7] Installing dependencies and starting application..." -ForegroundColor Green
$continue = Read-Host "Continue? (Make sure .env is configured) (Y/N)"
if ($continue -eq "Y" -or $continue -eq "y") {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "cd /var/www/chatbot && npm install --production"
    
    Write-Host "Starting with PM2..." -ForegroundColor Cyan
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "cd /var/www/chatbot && pm2 delete chatbot-api 2>/dev/null || true"
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "cd /var/www/chatbot && pm2 start ecosystem.config.js || pm2 start server.js --name chatbot-api"
    plink -i "$KeyPath" -batch $ServerUser@$ServerIP "pm2 save"
    
    Write-Host "✅ Application started" -ForegroundColor Green
} else {
    Write-Host "Skipped. You can start manually later:" -ForegroundColor Yellow
    Write-Host "  cd /var/www/chatbot" -ForegroundColor Gray
    Write-Host "  npm install --production" -ForegroundColor Gray
    Write-Host "  pm2 start ecosystem.config.js" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Edit .env file with correct credentials" -ForegroundColor White
Write-Host "2. Test API: curl http://localhost:3000/api/health" -ForegroundColor White
Write-Host "3. Configure Nginx (see nginx.conf.example)" -ForegroundColor White
Write-Host "4. View logs: pm2 logs chatbot-api" -ForegroundColor White
Write-Host ""
Write-Host "Connect to server:" -ForegroundColor Yellow
Write-Host "  plink -i `"$KeyPath`" $ServerUser@$ServerIP" -ForegroundColor Gray
Write-Host ""






