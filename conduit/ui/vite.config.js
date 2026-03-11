import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index-solid.html'),
        drop: path.resolve(__dirname, 'drop.html'),
      },
    },
  },
});
