import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The Python backend runs on port 8000 (BUDGET_API can point a test copy elsewhere)
    proxy: { '/api': process.env.BUDGET_API ?? 'http://127.0.0.1:8000' },
  },
})
