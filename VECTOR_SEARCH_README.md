# Vector Similarity Search with pgvector

This system now supports semantic vector similarity search using PostgreSQL's pgvector extension. This enables intelligent, meaning-based search instead of just keyword matching.

## Features

- **Semantic Search**: Find similar content based on meaning, not just keywords
- **Automatic Embedding Generation**: Messages and knowledge base entries automatically get embeddings stored
- **Efficient Indexing**: Uses HNSW or IVFFlat indexes for fast similarity search
- **Hybrid Search**: Combines vector search with traditional SQL queries for best results

## Setup

### 1. Ensure pgvector Extension is Installed

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. Database Schema

The system automatically adds vector columns when you start the server:
- `messages.message_embedding` - Vector(1536) for user messages
- `messages.response_embedding` - Vector(1536) for AI responses
- `knowledge_base.content_embedding` - Vector(1536) for knowledge base content

### 3. Migrate Existing Data

To add embeddings to existing messages and knowledge base entries:

```bash
npm run migrate-vectors
```

This will:
- Add vector columns if they don't exist
- Generate embeddings for all existing messages
- Generate embeddings for all existing knowledge base entries

**Note**: This may take time depending on the amount of data and API rate limits.

## How It Works

### Automatic Embedding Storage

When a new message is sent:
1. The message and response are saved to the database
2. Embeddings are generated asynchronously (in background)
3. Embeddings are stored in the vector columns

### Vector Search in Chat

When you ask a question:
1. **Vector Search** (semantic) - Finds similar past conversations and knowledge base entries
2. **SQL Query** (if needed) - Generates and executes SQL for analytical questions
3. **Text Search** (fallback) - Traditional keyword search if vector search has no results

The system intelligently combines all three approaches for the best answer.

## API Endpoints

### Vector Search Endpoint

```http
GET /api/knowledge/vector-search?q=your+question&limit=5&threshold=0.65
```

Parameters:
- `q` (required): Search query
- `limit` (optional, default: 5): Maximum results
- `threshold` (optional, default: 0.65): Minimum similarity score (0-1)

Example:
```bash
curl "http://localhost:3000/api/knowledge/vector-search?q=how+to+use+the+system&limit=3"
```

## Embedding API Configuration

The system uses Alibaba DashScope embedding API. Make sure:
1. Your `ALIBABA_LLM_API_KEY` is set in `.env`
2. The embedding API is enabled in your Alibaba account
3. The API key has permissions for embedding generation

The system tries multiple API formats automatically:
- DashScope native API
- OpenAI-compatible format
- Alternative formats

## Vector Index Types

The system automatically creates indexes for efficient search:

1. **HNSW Index** (preferred) - Fast approximate nearest neighbor search
   - Better for large datasets
   - Faster query performance
   - Requires more memory

2. **IVFFlat Index** (fallback) - If HNSW is not available
   - Good for medium datasets
   - Lower memory usage

If both fail, the system falls back to sequential scan (slower but works).

## Similarity Metrics

The system uses **cosine similarity** for vector comparison:
- Range: 0 to 1 (1 = identical, 0 = completely different)
- Default threshold: 0.65 (65% similarity)
- Higher threshold = more strict matching
- Lower threshold = more results but less relevant

## Performance Tips

1. **Index Creation**: Vector indexes are created automatically, but may take time for large datasets
2. **Batch Processing**: The migration script processes embeddings with delays to avoid rate limiting
3. **Background Storage**: New message embeddings are stored asynchronously to not block responses
4. **Hybrid Approach**: The system uses vector search + SQL + text search for best results

## Troubleshooting

### Embeddings Not Generating

1. Check API key: `ALIBABA_LLM_API_KEY` in `.env`
2. Check API permissions: Ensure embedding API is enabled
3. Check logs: Look for embedding API error messages
4. Fallback: System will use text search if embeddings fail

### Vector Search Returns No Results

1. Run migration: `npm run migrate-vectors` to populate embeddings
2. Lower threshold: Try `threshold=0.5` for more results
3. Check data: Ensure you have messages/knowledge base entries
4. Check indexes: Verify vector indexes were created

### Slow Performance

1. Check indexes: Ensure vector indexes exist
2. Reduce limit: Use smaller `limit` parameter
3. Increase threshold: Higher threshold = fewer results = faster

## Example Queries

The system automatically uses vector search for semantic queries like:
- "What did we discuss about sales?"
- "Show me similar questions"
- "Find information about customers"
- "What was the previous conversation about?"

Vector search understands meaning, so these will find relevant content even if exact keywords don't match.










