import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Helper function to resolve paths
const r = (path) => resolve(__dirname, path);

export default defineConfig({
  plugins: [react()],
  
  // Define custom build configurations for the extension
  build: {
    // Keep assets in the root of the 'dist' folder for Chrome extension
    assetsDir: '', 
    
    rollupOptions: {
      input: {
        // 1. Main UI for the Side Panel (React entry point)
        'side-panel': r('index.html'), 
        
        // 2. Background Service Worker
        'background/service-worker': r('src/background/service-worker.js'),
        
        // 3. Content Script
        'content/content-script': r('src/content/content-script.js'),
      },
      output: {
        entryFileNames: ({ name }) => {
          // Custom naming logic to place scripts in the correct folders
          if (name.includes('content/')) {
            return `[name].js`;
          }
          if (name.includes('background/')) {
            return `[name].js`;
          }
          // Default for the Side Panel entry
          return '[name].js';
        },
        // We need to ensure that the chunks (libraries like React/MUI) are separate
        // and can be imported by all entries, especially the service worker.
        chunkFileNames: 'assets/[name]-[hash].js', 
      },
    },
  },
});