import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Helper function to resolve paths
const r = (path) => resolve(__dirname, path);

export default defineConfig({
  plugins: [react()],
  
  build: {
    assetsDir: '', 
    rollupOptions: {
      input: {
        'side-panel': r('index.html'), 
        // Note the desired paths without the 'src/' prefix in the output names
        'background/service-worker': r('src/background/service-worker.js'),
        'content/content-script': r('src/content/content-script.js'),
      },
      output: {
        entryFileNames: ({ name }) => {
          // *** THE CRITICAL CORRECTION IS HERE ***

          // If the name contains the desired folder structure (e.g., 'content/content-script'),
          // just return the name followed by .js
          if (name.includes('content/')) {
            return `${name}.js`;
          }
          if (name.includes('background/')) {
            return `${name}.js`;
          }
          // Default for the Side Panel entry
          return '[name].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js', 
      },
    },
  },
});