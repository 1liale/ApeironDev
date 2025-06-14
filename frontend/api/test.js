// api/test.js

/**
 * A simple Vercel Serverless Function to test API routing.
 * Access it at: http://localhost:8080/api/test
 */
export default function handler(request, response) {
    // Log to your vercel dev terminal to confirm it's being hit
    console.log('✅ /api/test function was called!');
  
    // Check the request method (GET, POST, etc.)
    console.log('Request Method:', request.method);
  
    // Send a JSON response
    response.status(200).json({
      message: 'Hello from your Vercel Function! It\'s working!',
      timestamp: new Date().toISOString(),
      method: request.method,
      query: request.query, // Any query parameters will appear here (e.g., /api/test?name=John)
      body: request.body,   // Any request body will appear here (for POST, PUT, etc.)
    });
  }