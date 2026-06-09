import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // '.' resolves to the Vite root (this dir); avoids needing @types/node for `process`.
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react(), tailwindcss()],

    server: {
      proxy: {
        '/api/game': {
          target: env.VITE_GAME_SERVICE_URL || 'http://localhost:8001',
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/api\/game/, ''),
        },

        '/api/community': {
          target: env.VITE_COMMUNITY_SERVICE_URL || 'http://localhost:8003',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/community/, ''),
        },

        '/api/dashboard': {
          target: env.VITE_DASHBOARD_SERVICE_URL || 'http://localhost:8002',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dashboard/, ''),
        },
      },
    },
  }
})
