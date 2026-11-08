import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/lv': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
      '/uploads': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
      '/exports': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
      '/docs': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
      '/openapi.json': process.env.VITE_API_PROXY || 'http://127.0.0.1:8100',
    },
  },
})
