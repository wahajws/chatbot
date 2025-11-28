# How to Change Ports for Frontend and Backend

## Backend Port (API Server)

The backend server port is configured in `server.js` and defaults to **3000**.

### Option 1: Using .env file (Recommended)

Create or edit `.env` file in the **root directory** (same level as `server.js`):

```env
PORT=3001
```

Then restart the server:
```bash
npm start
```

### Option 2: Using Environment Variable

**Windows (PowerShell):**
```powershell
$env:PORT=3001; npm start
```

**Windows (CMD):**
```cmd
set PORT=3001 && npm start
```

**Linux/Mac:**
```bash
PORT=3001 npm start
```

### Option 3: Using PM2 (Production)

Edit `ecosystem.config.js`:
```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3001  // Change this
}
```

Or set it when starting:
```bash
PORT=3001 pm2 start ecosystem.config.js
```

---

## Frontend Port (React App)

The frontend React app runs on port **3000** by default.

### Option 1: Using .env file (Recommended)

Create or edit `.env` file in the **frontend directory**:

```env
PORT=3001
REACT_APP_API_URL=http://localhost:3000
```

**Note:** `REACT_APP_API_URL` should match your backend port!

Then restart the frontend:
```bash
cd frontend
npm start
```

### Option 2: Using Environment Variable

**Windows (PowerShell):**
```powershell
cd frontend
$env:PORT=3001; npm start
```

**Windows (CMD):**
```cmd
cd frontend
set PORT=3001 && npm start
```

**Linux/Mac:**
```bash
cd frontend
PORT=3001 npm start
```

### Option 3: Update package.json Scripts

Edit `frontend/package.json`:
```json
"scripts": {
  "start": "PORT=3001 react-scripts start",
  "build": "react-scripts build",
  "test": "react-scripts test",
  "eject": "react-scripts eject"
}
```

**Windows:** Use `cross-env` package:
```bash
npm install --save-dev cross-env
```

Then update script:
```json
"start": "cross-env PORT=3001 react-scripts start"
```

---

## Important: Update Frontend API URL

When you change the **backend port**, you must also update the frontend to point to the correct backend URL.

### Update API URL in Frontend

Create or edit `.env` file in the **frontend directory**:

```env
REACT_APP_API_URL=http://localhost:3001
```

Replace `3001` with your actual backend port.

### Files That Use API URL

The following files use `REACT_APP_API_URL`:
- `frontend/src/pages/Analytics.js`
- `frontend/src/pages/Chatbot.js`
- `frontend/src/pages/VectorHealth.js`

They all use:
```javascript
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
```

So just set `REACT_APP_API_URL` in `.env` and it will work!

---

## Example: Change Both Ports

### Scenario: Backend on 3001, Frontend on 3002

**1. Backend `.env` (root directory):**
```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=your_password
# ... other config
```

**2. Frontend `.env` (frontend directory):**
```env
PORT=3002
REACT_APP_API_URL=http://localhost:3001
```

**3. Start both:**
```bash
# Terminal 1 - Backend
npm start
# Server runs on http://localhost:3001

# Terminal 2 - Frontend
cd frontend
npm start
# Frontend runs on http://localhost:3002
# Frontend connects to backend at http://localhost:3001
```

---

## Quick Reference

| Component | Default Port | Config File | Environment Variable |
|-----------|-------------|-------------|---------------------|
| Backend   | 3000        | `.env` (root) | `PORT` |
| Frontend  | 3000        | `.env` (frontend) | `PORT` |
| Frontend API URL | localhost:3000 | `.env` (frontend) | `REACT_APP_API_URL` |

---

## Troubleshooting

### Port Already in Use

If you get "port already in use" error:

**Windows:**
```powershell
# Find process using port
netstat -ano | findstr :3000

# Kill process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

**Linux/Mac:**
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Frontend Can't Connect to Backend

1. Make sure backend is running
2. Check `REACT_APP_API_URL` matches backend port
3. Verify backend CORS allows frontend origin
4. Check firewall settings

### React App Port Not Changing

- Make sure `.env` file is in `frontend/` directory
- Restart the React dev server completely
- Clear browser cache
- Check if another process is using the port

---

## Production Deployment

For production, set ports in:

1. **Backend:** `.env` file on server
2. **Frontend:** Build with `REACT_APP_API_URL` set, then serve with Nginx
3. **Nginx:** Configure reverse proxy to backend port

See `DEPLOYMENT.md` for production setup details.





