import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: rootDirectory,
  plugins: [react()],
  server: {
    host: 'localhost',
    port: Number(process.env.MOJING_WEB_PORT ?? 5173),
    strictPort: true
  }
})
