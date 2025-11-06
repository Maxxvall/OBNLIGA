import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5183,
    host: '0.0.0.0',
  },
  preview: {
    port: 4183,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/index-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: ({ name }) => {
          if (name?.endsWith('.css')) {
            return `assets/index-[hash].css`;
          }
          return `assets/[name]-[hash].[ext]`;
        }
      }
    },
    cssCodeSplit: false,
    manifest: true,
  }
})