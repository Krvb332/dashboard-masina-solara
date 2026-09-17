import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  // Build-ul e servit de backendul de telemetrie, care monteaza fisierele
  // statice sub /static/ si livreaza index.html la /. Fara `base`, Vite cere
  // asset-urile de la radacina (/assets/...), unde nu exista nimic: pagina se
  // incarca alba, cu 404 pe tot. Vezi backend/app/static/README.md.
  base: '/static/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
