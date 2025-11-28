# PowerShell Deployment Script for Alibaba Cloud
# Usage: .\deploy-windows.ps1

param(
    [string]$ServerIP = "47.250.116.135",
    [string]$ServerUser = "root",
    [string]$KeyPath = "C:\Users\wahaj\Documents\expriment\chatbot\intern-ppk.pem"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting deployment to Alibaba Cloud Server..." -ForegroundColor Green
Write-Host "Server: $ServerUser@$ServerIP" -ForegroundColor Cyan

# Check if PuTTY tools are available
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
$pscpPath = Get-Command pscp -ErrorAction SilentlyContinue

if (-not $puttyPath -and -not $pscpPath) {
    Write-Host "⚠️  PuTTY tools (plink/pscp) not found in PATH." -ForegroundColor Yellow
    Write-Host "Please install PuTTY or add to PATH:" -ForegroundColor Yellow
    Write-Host "Download: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternatively, we can use OpenSSH if you convert the PPK key." -ForegroundColor Yellow
    Write-Host ""
    
    $useOpenSSH = Read-Host "Do you want to convert PPK to OpenSSH format and use OpenSSH? (Y/N)"
    if ($useOpenSSH -eq "Y" -or $useOpenSSH -eq "y") {
        $usePutty = $false
    } else {
        Write-Host "Please install PuTTY and try again." -ForegroundColor Red
        exit 1
    }
} else {
    $usePutty = $true
}

# Check if key file exists
if (-not (Test-Path $KeyPath)) {
    Write-Host "❌ Key file not found: $KeyPath" -ForegroundColor Red
    exit 1
}

# Convert PPK to OpenSSH if needed
$opensshKey = $KeyPath -replace '\.ppk$', '.pem'
if (-not $usePutty -and -not (Test-Path $opensshKey)) {
    Write-Host "📝 Converting PPK to OpenSSH format..." -ForegroundColor Yellow
    Write-Host "You can use PuTTYgen to convert:" -ForegroundColor Yellow
    Write-Host "1. Open PuTTYgen" -ForegroundColor Yellow
    Write-Host "2. Load your PPK file" -ForegroundColor Yellow
    Write-Host "3. Click 'Conversions' > 'Export OpenSSH key'" -ForegroundColor Yellow
    Write-Host "4. Save as: $opensshKey" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Press Enter after converting, or type 'skip' to use PuTTY tools"
    if ($continue -eq "skip") {
        $usePutty = $true
    }
}

# Function to execute remote command
function Invoke-RemoteCommand {
    param([string]$Command)
    
    if ($usePutty) {
        $plinkCmd = "plink -i `"$KeyPath`" -batch $ServerUser@$ServerIP `"$Command`""
        Write-Host "Executing: $Command" -ForegroundColor Gray
        $result = Invoke-Expression $plinkCmd 2>&1
        return $result
    } else {
        $sshCmd = "ssh -i `"$opensshKey`" -o StrictHostKeyChecking=no $ServerUser@$ServerIP `"$Command`""
        Write-Host "Executing: $Command" -ForegroundColor Gray
        $result = Invoke-Expression $sshCmd 2>&1
        return $result
    }
}

# Function to upload file
function Copy-ToServer {
    param(
        [string]$LocalPath,
        [string]$RemotePath
    )
    
    if ($usePutty) {
        $pscpCmd = "pscp -i `"$KeyPath`" -batch `"$LocalPath`" ${ServerUser}@${ServerIP}:`"$RemotePath`""
        Write-Host "Uploading: $LocalPath -> $RemotePath" -ForegroundColor Gray
        Invoke-Expression $pscpCmd
    } else {
        $scpCmd = "scp -i `"$opensshKey`" -o StrictHostKeyChecking=no `"$LocalPath`" ${ServerUser}@${ServerIP}:`"$RemotePath`""
        Write-Host "Uploading: $LocalPath -> $RemotePath" -ForegroundColor Gray
        Invoke-Expression $scpCmd
    }
}

# Function to upload directory
function Copy-DirectoryToServer {
    param(
        [string]$LocalPath,
        [string]$RemotePath
    )
    
    if ($usePutty) {
        $pscpCmd = "pscp -i `"$KeyPath`" -batch -r `"$LocalPath`" ${ServerUser}@${ServerIP}:`"$RemotePath`""
        Write-Host "Uploading directory: $LocalPath -> $RemotePath" -ForegroundColor Gray
        Invoke-Expression $pscpCmd
    } else {
        $scpCmd = "scp -i `"$opensshKey`" -o StrictHostKeyChecking=no -r `"$LocalPath`" ${ServerUser}@${ServerIP}:`"$RemotePath`""
        Write-Host "Uploading directory: $LocalPath -> $RemotePath" -ForegroundColor Gray
        Invoke-Expression $scpCmd
    }
}

Write-Host ""
Write-Host "📋 Step 1: Checking server connection..." -ForegroundColor Cyan
try {
    $result = Invoke-RemoteCommand "echo 'Connection successful'"
    Write-Host "✅ Server connection successful!" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to connect to server" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📋 Step 2: Checking and installing prerequisites..." -ForegroundColor Cyan

# Check Node.js
$nodeCheck = Invoke-RemoteCommand "node --version 2>/dev/null; if [ `$? -ne 0 ]; then echo 'NOT_INSTALLED'; fi"
if ($nodeCheck -match "NOT_INSTALLED" -or $nodeCheck -eq "" -or $nodeCheck -match "command not found") {
    Write-Host "Installing Node.js..." -ForegroundColor Yellow
    Invoke-RemoteCommand "curl -fsSL https://deb.nodesource.com/setup_18.x | bash -"
    Invoke-RemoteCommand "apt-get install -y nodejs"
} else {
    Write-Host "✅ Node.js installed: $nodeCheck" -ForegroundColor Green
}

# Check PM2
$pm2Check = Invoke-RemoteCommand "pm2 --version 2>/dev/null; if [ `$? -ne 0 ]; then echo 'NOT_INSTALLED'; fi"
if ($pm2Check -match "NOT_INSTALLED" -or $pm2Check -eq "" -or $pm2Check -match "command not found") {
    Write-Host "Installing PM2..." -ForegroundColor Yellow
    Invoke-RemoteCommand "npm install -g pm2"
} else {
    Write-Host "✅ PM2 installed: $pm2Check" -ForegroundColor Green
}

# Check Nginx
$nginxCheck = Invoke-RemoteCommand "nginx -v 2>&1; if [ `$? -ne 0 ]; then echo 'NOT_INSTALLED'; fi"
if ($nginxCheck -match "NOT_INSTALLED" -or $nginxCheck -eq "" -or $nginxCheck -match "command not found") {
    Write-Host "Installing Nginx..." -ForegroundColor Yellow
    Invoke-RemoteCommand "apt-get update"
    Invoke-RemoteCommand "apt-get install -y nginx"
} else {
    Write-Host "✅ Nginx installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Step 3: Creating application directory..." -ForegroundColor Cyan
Invoke-RemoteCommand "mkdir -p /var/www/chatbot"
Invoke-RemoteCommand "mkdir -p /var/log/chatbot"

Write-Host ""
Write-Host "📋 Step 4: Uploading application files..." -ForegroundColor Cyan

# Create a temporary directory for files to upload
$tempDir = "$env:TEMP\chatbot-deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Copy files (excluding node_modules, .git, etc.)
Write-Host "Preparing files for upload..." -ForegroundColor Yellow

$filesToCopy = @(
    "server.js",
    "package.json",
    "package-lock.json",
    "ecosystem.config.js",
    "config",
    "routes",
    "services",
    "utils",
    "scripts"
)

foreach ($item in $filesToCopy) {
    if (Test-Path $item) {
        Copy-Item -Path $item -Destination "$tempDir\$item" -Recurse -Force
        Write-Host "  ✓ $item" -ForegroundColor Gray
    }
}

# Copy frontend
if (Test-Path "frontend") {
    Write-Host "Building frontend..." -ForegroundColor Yellow
    Push-Location frontend
    npm install
    npm run build
    Pop-Location
    
    Copy-Item -Path "frontend\build" -Destination "$tempDir\frontend\build" -Recurse -Force
    Copy-Item -Path "frontend\package.json" -Destination "$tempDir\frontend\package.json" -Force
    Write-Host "  ✓ frontend (built)" -ForegroundColor Gray
}

# Upload files
Write-Host "Uploading to server..." -ForegroundColor Yellow
Copy-DirectoryToServer "$tempDir\*" "/var/www/chatbot/"

# Cleanup temp directory
Remove-Item -Path $tempDir -Recurse -Force

Write-Host ""
Write-Host "📋 Step 5: Setting up environment variables..." -ForegroundColor Cyan

# Check if .env exists on server
$envExists = Invoke-RemoteCommand "test -f /var/www/chatbot/.env && echo 'EXISTS' || echo 'NOT_EXISTS'"

if ($envExists -match "NOT_EXISTS") {
    Write-Host "Creating .env file from template..." -ForegroundColor Yellow
    
    # Read current .env or use example
    $envContent = ""
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" -Raw
    } elseif (Test-Path ".env.production.example") {
        $envContent = Get-Content ".env.production.example" -Raw
    }
    
    # Update database host to use localhost (since DB is on same server)
    $envContent = $envContent -replace "DB_HOST=.*", "DB_HOST=localhost"
    
    # Save to temp file and upload
    $tempEnv = "$env:TEMP\chatbot.env"
    $envContent | Out-File -FilePath $tempEnv -Encoding utf8
    Copy-ToServer $tempEnv "/var/www/chatbot/.env"
    Remove-Item $tempEnv
    
    Write-Host "⚠️  Please update .env file on server with correct database credentials!" -ForegroundColor Yellow
    Write-Host "   SSH to server and edit: nano /var/www/chatbot/.env" -ForegroundColor Yellow
} else {
    Write-Host "✅ .env file already exists on server" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Step 6: Installing dependencies and starting application..." -ForegroundColor Cyan

Invoke-RemoteCommand "cd /var/www/chatbot && npm install --production"

# Install frontend dependencies if needed
Invoke-RemoteCommand "cd /var/www/chatbot/frontend && npm install --production 2>/dev/null || echo 'Frontend already built'"

# Start with PM2
Write-Host "Starting application with PM2..." -ForegroundColor Yellow
Invoke-RemoteCommand "cd /var/www/chatbot && pm2 delete chatbot-api 2>/dev/null || true"
Invoke-RemoteCommand "cd /var/www/chatbot && pm2 start ecosystem.config.js || pm2 start server.js --name chatbot-api"
Invoke-RemoteCommand "pm2 save"
Invoke-RemoteCommand "pm2 startup | tail -1 | bash || true"

Write-Host ""
Write-Host "📋 Step 7: Checking application status..." -ForegroundColor Cyan
Start-Sleep -Seconds 3
$pm2Status = Invoke-RemoteCommand "pm2 list"
Write-Host $pm2Status

Write-Host ""
Write-Host "✅ Deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. SSH to server and update .env file:" -ForegroundColor White
Write-Host "   ssh -i `"$KeyPath`" $ServerUser@$ServerIP" -ForegroundColor Gray
Write-Host "   nano /var/www/chatbot/.env" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Configure Nginx (see nginx.conf.example)" -ForegroundColor White
Write-Host ""
Write-Host "3. Check application logs:" -ForegroundColor White
Write-Host "   pm2 logs chatbot-api" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Test API:" -ForegroundColor White
Write-Host "   curl http://localhost:3000/api/health" -ForegroundColor Gray
Write-Host ""

