# AMAST Smart Chat - Frontend

A futuristic admin dashboard for database analytics and AI-powered chatbot interface.

## Features

- **Analytics Dashboard**: Real-time database statistics, charts, and visualizations
- **Smart Chatbot**: AI-powered chat interface to query your database
- **Futuristic UI**: Modern design with glassmorphism, neon accents, and smooth animations
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

- React 19
- React Router DOM
- Framer Motion (animations)
- Recharts (data visualization)
- Axios (API calls)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the frontend directory:
```
REACT_APP_API_URL=http://localhost:3000
```

3. Start the development server:
```bash
npm start
```

The app will open at `http://localhost:3001` (or next available port).

## Pages

### Analytics Page (`/analytics`)
- Database statistics overview
- Revenue and order trends
- Product category distribution
- Top products analysis
- Real-time database information

### Chatbot Page (`/chatbot`)
- Interactive AI chatbot
- Query your database in natural language
- Chat history
- Suggested questions
- Real-time responses

## Design Features

- **Dark Theme**: Deep space-inspired color palette
- **Glassmorphism**: Frosted glass effects on cards
- **Neon Accents**: Cyan and purple gradient highlights
- **Smooth Animations**: Framer Motion powered transitions
- **Gradient Backgrounds**: Animated gradient effects
- **Custom Scrollbars**: Styled scrollbars matching the theme

## API Integration

The frontend connects to the backend API at `http://localhost:3000` by default. Make sure your backend server is running.

## Build for Production

```bash
npm run build
```

This creates an optimized production build in the `build` folder.
