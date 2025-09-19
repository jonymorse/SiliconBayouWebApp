// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/SiliconBayouWebApp/', // repo name
  build: { 
    outDir: 'docs',              // build into /docs for Pages
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        unified: resolve(__dirname, 'index_unified.html'),
        gallery: resolve(__dirname, 'supa.html'),
        ipad: resolve(__dirname, 'index_unified_ipad.html'), // ← This line

      }
    }
  }
});
