import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/game': {
        target: 'http://localhost:8001',
        ws: true,
        rewrite: (path) => path.replace(/^\/api\/game/, ''),
      },
      '/api/community': {
        target: 'http://localhost:8003',
        rewrite: (path) => path.replace(/^\/api\/community/, ''),
      },
      '/api/dashboard': {
        target: 'http://localhost:8002',
        rewrite: (path) => path.replace(/^\/api\/dashboard/, ''),
      },
    },
  },
})
