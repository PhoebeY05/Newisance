import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/game': 'http://localhost:8001',
      '/api/community': 'http://localhost:8003',
      '/api/dashboard': 'http://localhost:8002',
    },
  },
})
