import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/main')
      }
    },
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        external: ['undici']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/preload')
      }
    },
    build: {
      outDir: 'dist-electron/preload'
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [vue()],
    build: {
      outDir: 'dist-electron/renderer'
    },
    optimizeDeps: {
      exclude: ['better-sqlite3']
    }
  }
})
