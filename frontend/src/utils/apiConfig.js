/**
 * Auto-detect API URL based on current host
 * This ensures the frontend uses the correct backend URL whether running locally or on a public IP
 * This function is called at runtime to always get the current hostname
 */
const getApiUrl = () => {
  // Auto-detect current hostname first
  let currentHost = 'localhost';
  let protocol = 'http:';
  
  if (typeof window !== 'undefined' && window.location) {
    currentHost = window.location.hostname;
    protocol = window.location.protocol;
  }
  
  // If frontend is on a public IP, ALWAYS use that IP for backend (ignore localhost env var)
  if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    const apiUrl = `${protocol}//${currentHost}:4000`;
    console.log('[API Config] Frontend on public IP, using:', apiUrl);
    return apiUrl;
  }
  
  // Use environment variable if set (only for localhost scenarios)
  if (process.env.REACT_APP_API_URL) {
    const envUrl = process.env.REACT_APP_API_URL;
    // If env var is localhost but we're on a public IP, ignore it
    if (envUrl.includes('localhost') && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
      console.log('[API Config] Ignoring localhost env var, using public IP instead');
      return `${protocol}//${currentHost}:4000`;
    }
    console.log('[API Config] Using REACT_APP_API_URL:', envUrl);
    return envUrl;
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

