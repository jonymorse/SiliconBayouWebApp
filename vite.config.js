// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/SiliconBayouWebApp/',          // keep repo name for GH Pages
  build: {
    outDir: 'docs',
    rollupOptions: {
      input: {
        index:   resolve(__dirname, 'index.html'), // info/landing page
        app:     resolve(__dirname, 'app.html'),   // main AR app page
        gallery: resolve(__dirname, 'supa.html')   // (optional) extra page
      }
    }
  }
});
