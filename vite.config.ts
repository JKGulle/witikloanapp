import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Matches the Supabase Auth "Site URL" so email confirmation links land back in the app.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
})
