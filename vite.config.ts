import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/epchilders1.github.io/', // For user/organization GitHub Pages sites
  css: {
    postcss: './postcss.config.js',
  },
});
