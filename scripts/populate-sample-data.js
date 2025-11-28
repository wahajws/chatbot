import dotenv from 'dotenv';
import { addKnowledgeEntry } from '../services/databaseService.js';

dotenv.config();

/**
 * Script to populate the knowledge base with sample data
 * Run with: node scripts/populate-sample-data.js
 */

const sampleData = [
  {
    title: 'About This Database',
    content: 'This is a chatbot database that stores conversation history and knowledge base entries. It uses PostgreSQL with pgvector extension for vector similarity search capabilities. The database contains information about various topics that can be queried by the chatbot to provide accurate, context-aware responses.',
    category: 'Database'
  },
  {
    title: 'PostgreSQL with pgvector',
    content: 'PostgreSQL is a powerful open-source relational database management system. pgvector is an extension that adds vector similarity search capabilities to PostgreSQL, allowing you to store and query high-dimensional vectors efficiently. This is particularly useful for AI applications that need to find similar embeddings or perform semantic search.',
    category: 'Database'
  },
  {
    title: 'Alibaba Qwen LLM',
    content: 'Qwen is a large language model developed by Alibaba Cloud. The Qwen Plus model is used in this chatbot to generate intelligent responses based on user queries and database context. It supports natural language understanding and generation, making it suitable for conversational AI applications.',
    category: 'AI/ML'
  },
  {
    title: 'Chatbot Architecture',
    content: 'This chatbot uses a Node.js Express server with PostgreSQL database. When a user sends a message, the system searches the knowledge base for relevant information, then uses that context along with the Alibaba LLM to generate an accurate response. All conversations are stored in the database for history tracking.',
    category: 'Architecture'
  }
];

async function populateDatabase() {
  console.log('Starting to populate knowledge base...\n');

  try {
    for (const entry of sampleData) {
      const result = await addKnowledgeEntry(entry.title, entry.content, entry.category);
      console.log(`✓ Added: ${entry.title} (ID: ${result.id})`);
    }

    console.log(`\n✓ Successfully added ${sampleData.length} entries to the knowledge base!`);
    console.log('\nYou can now ask questions about the database and the chatbot will use this information.');
  } catch (error) {
    console.error('Error populating database:', error);
    process.exit(1);
  }
}

populateDatabase();










