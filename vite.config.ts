/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Playwright specs live in e2e/ and run with `npm run e2e`.
  test: { exclude: ['e2e/**', 'node_modules/**'] },
})
