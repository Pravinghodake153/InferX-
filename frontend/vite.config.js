import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/evaluate': 'http://localhost:8000',
      '/extract-debug': 'http://localhost:8000',
    }
  }
})
