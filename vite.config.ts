import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: la app funciona en cualquier subcarpeta,
  // como https://usuario.github.io/calculab/ en GitHub Pages
  base: './',
  build: {
    // math.js pesa ~600 KB; se sube el límite del aviso de tamaño
    chunkSizeWarningLimit: 1000,
  },
});
