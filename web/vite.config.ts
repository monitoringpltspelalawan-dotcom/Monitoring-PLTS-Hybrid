import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const staticDemo = mode === 'github-pages';
  return {
  base: staticDemo ? '/Monitoring-PLTS-Hybrid/' : '/',
  define: {
    'import.meta.env.VITE_STATIC_DEMO': JSON.stringify(staticDemo ? 'true' : 'false'),
  },
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: staticDemo ? path.resolve(__dirname, '../github-pages-app/site') : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          maps: ['d3-geo', 'topojson-client', 'world-atlas/countries-110m.json'],
        },
      },
    },
  },
  };
});
