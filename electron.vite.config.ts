import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const rootDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(rootDirectory, 'apps/desktop/src/main.ts'),
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(rootDirectory, 'apps/desktop/src/preload.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  renderer: {
    root: resolve(rootDirectory, 'apps/web'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(rootDirectory, 'apps/web/index.html')
      }
    }
  }
})
