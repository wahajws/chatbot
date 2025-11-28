# Chatbot API

A Node.js chat API that integrates PostgreSQL with pgvector extension and Alibaba LLM (Qwen) model for intelligent conversations.

## Features

- Simple REST API for chat interactions
- PostgreSQL database with pgvector support for storing chat history
- **Knowledge base system** - Store and query information from the database
- **Database-powered responses** - Chatbot uses database context to answer questions accurately
- Alibaba LLM (Qwen Plus) integration for AI responses
- Conversation history tracking
- RESTful API endpoints

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database with pgvector extension installed
- Alibaba LLM API key

## Installation

1. Clone or navigate to the project directory:
```bash
cd chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
   - Database credentials
   - Alibaba LLM API key
   - Other settings as needed

## Configuration

The `.env` file should contain:

```env
# Database Configuration
DB_HOST=47.250.116.135
DB_PORT=5432
DB_NAME=nv_ams
DB_USER=dev_chatbot
DB_PASSWORD=your_password

# Alibaba LLM Configuration
ALIBABA_LLM_API_KEY=your_api_key
ALIBABA_LLM_API_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
ALIBABA_LLM_API_MODEL=qwen-plus

# Embedding API Configuration (Optional - for vector search)
EMBEDDING_MODEL=text-embedding-v1  # Override embedding model (defaults to ALIBABA_LLM_API_MODEL or text-embedding-v1)
EMBEDDING_API_URL=https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding  # Override embedding API URL
EMBEDDING_ENABLED=true  # Set to 'false' to disable embedding generation (default: true)
EMBEDDING_SILENT_MODE=false  # Set to 'true' to reduce console noise from embedding errors (default: false)

# Auto-migration Configuration
AUTO_MIGRATE_EMBEDDINGS=true  # Automatically generate embeddings on startup (default: true)
EMBEDDING_BATCH_SIZE=10  # Number of records to process per batch (default: 10)
EMBEDDING_BATCH_DELAY=2000  # Delay in milliseconds between batches (default: 2000ms)

# Application Configuration
UPLOAD_DIR=./uploads
PORT=3000
```

## Database Setup

Make sure your PostgreSQL database has the pgvector extension installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The application will automatically create the following tables on first run:
- `messages` - Stores chat conversation history
- `knowledge_base` - Stores information that can be queried by the chatbot

## Usage

### Start the server:

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

### Populate Knowledge Base

Before using the chatbot, you should add information to the knowledge base. You can either:

1. **Use the API** to add entries (see Knowledge Base endpoints below)
2. **Run the sample data script**:
```bash
npm run populate
```

This will add sample entries about the database, PostgreSQL, and the chatbot architecture.

## API Endpoints

### POST /api/chat

Send a message and get an AI response. **The chatbot automatically searches the knowledge base for relevant information** and uses it to provide accurate answers.

**Request:**
```json
{
  "message": "What is this database about?",
  "conversationId": 123  // Optional: for conversation context
}
```

**Response:**
```json
{
  "success": true,
  "id": 1,
  "message": "What is this database about?",
  "response": "This is a chatbot database that stores conversation history and knowledge base entries. It uses PostgreSQL with pgvector extension...",
  "createdAt": "2024-01-01T12:00:00.000Z"
}
```

**How it works:**
1. When you send a message, the system searches the `knowledge_base` table for relevant entries
2. Found information is included as context in the LLM prompt
3. The LLM generates a response based on both the database context and its general knowledge

### GET /api/chat/history

Get chat history.

**Query Parameters:**
- `limit` (optional): Number of messages to return (default: 20)
- `offset` (optional): Number of messages to skip (default: 0)

**Example:**
```
GET /api/chat/history?limit=10&offset=0
```

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "message": "Hello",
      "response": "Hi there!",
      "created_at": "2024-01-01T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

### GET /api/chat/:id

Get a specific message by ID.

**Example:**
```
GET /api/chat/1
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": 1,
    "message": "Hello",
    "response": "Hi there!",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

## Knowledge Base Endpoints

### POST /api/knowledge

Add a new entry to the knowledge base. This information will be used by the chatbot to answer questions.

**Request:**
```json
{
  "title": "About This Database",
  "content": "This is a chatbot database that stores conversation history...",
  "category": "Database"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "entry": {
    "id": 1,
    "title": "About This Database",
    "content": "This is a chatbot database...",
    "category": "Database",
    "created_at": "2024-01-01T12:00:00.000Z"
  }
}
```

### GET /api/knowledge

Get all knowledge base entries with pagination.

**Query Parameters:**
- `limit` (optional): Number of entries to return (default: 50)
- `offset` (optional): Number of entries to skip (default: 0)

**Example:**
```
GET /api/knowledge?limit=10&offset=0
```

### GET /api/knowledge/search

Search the knowledge base for relevant information.

**Query Parameters:**
- `q` (required): Search query
- `limit` (optional): Maximum number of results (default: 5)

**Example:**
```
GET /api/knowledge/search?q=database&limit=5
```

## Example Usage

### Using cURL:

```bash
# Send a chat message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is artificial intelligence?"}'

# Get chat history
curl http://localhost:3000/api/chat/history?limit=5
```

### Using JavaScript (fetch):

```javascript
// Send a message
const response = await fetch('http://localhost:3000/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'What is artificial intelligence?'
  })
});

const data = await response.json();
console.log(data.response);
```

## Project Structure

```
chatbot/
├── config/
│   └── database.js          # Database connection and initialization
├── services/
│   ├── llmService.js        # Alibaba LLM integration
│   └── databaseService.js   # Knowledge base search and management
├── routes/
│   ├── chat.js              # Chat API routes
│   └── knowledge.js         # Knowledge base API routes
├── scripts/
│   └── populate-sample-data.js  # Script to populate sample data
├── server.js                # Main server file
├── package.json             # Dependencies
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad Request (missing or invalid message)
- `404`: Not Found (message ID not found)
- `500`: Internal Server Error

## License

ISC


