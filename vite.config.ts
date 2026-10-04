import { defineConfig } from 'vite'
// es2022 so main.ts can use top-level await while assets load
export default defineConfig({ build: { target: 'es2022', chunkSizeWarningLimit: 900 } })
