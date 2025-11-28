/**
 * Auto-detect API URL based on current host
 * This ensures the frontend uses the correct backend URL whether running locally or on a public IP
 * This function is called at runtime to always get the current hostname
 */
const getApiUrl = () => {
  // Use environment variable if set (highest priority)
  if (process.env.REACT_APP_API_URL) {
    console.log('[API Config] Using REACT_APP_API_URL:', process.env.REACT_APP_API_URL);
    return process.env.REACT_APP_API_URL;
  }
  
  // Auto-detect: if frontend is on a public IP, use same IP for backend
  if (typeof window !== 'undefined' && window.location) {
    const currentHost = window.location.hostname;
    const currentPort = window.location.port;
    const protocol = window.location.protocol;
    
    console.log('[API Config] Detected:', { currentHost, currentPort, protocol });
    
    // If not localhost, use the same hostname for backend
    if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
      // Backend is always on port 4000, regardless of frontend port
      // Frontend might be on port 80 (nginx) or 4001 (dev server)
      const apiUrl = `${protocol}//${currentHost}:4000`;
      console.log('[API Config] Using auto-detected public IP:', apiUrl);
      return apiUrl;
    }
  }
  
  // Default to localhost for local development
  console.log('[API Config] Using localhost fallback');
  return 'http://localhost:4000';
};

// Export a function that gets the URL at runtime, not at module load
// This ensures it always uses the current window.location
export const getApiBaseUrl = () => {
  const url = getApiUrl();
  console.log('[API Config] Final API URL:', url);
  return url;
};

// For backward compatibility, export a constant (but it will be recalculated)
// Better to use getApiBaseUrl() function in components
export const API_BASE_URL = getApiUrl();

