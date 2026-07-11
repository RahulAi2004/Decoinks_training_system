import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 4000}`,
      '/real-chat-artwork': `http://localhost:${process.env.API_PORT || 4000}`,
    },
  },
  build: {
    outDir: path.join(__dirname, '..', 'dist'),
    emptyOutDir: true,
  },
});
