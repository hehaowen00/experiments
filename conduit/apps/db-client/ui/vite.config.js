import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiSharedPath = path.resolve(__dirname, '../../../packages/ui-shared');

export default defineConfig({
  plugins: [
    solidPlugin({
      include: [/\.jsx?$/, new RegExp(uiSharedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*\\.jsx?$')],
    }),
  ],
  base: './',
  resolve: {
    alias: {
      '@conduit/ui-shared': uiSharedPath,
    },
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@codemirror') || id.includes('@lezer')) {
            return 'codemirror';
          }
        },
      },
    },
  },
});
