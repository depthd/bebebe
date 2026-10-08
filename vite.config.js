import { defineConfig } from 'vite';

// base './' so the build works from any subfolder (GitHub Pages, artifact preview, file hosting)
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1000, // three.js is big, that's fine
    rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } }, // lab.html: the physics lab (src/lab.js)
  },
});
