// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/SiliconBayouWebApp/', // repo name
  build: { outDir: 'docs' }      // build into /docs for Pages
});
