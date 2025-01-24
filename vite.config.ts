import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/csv-converter', // For user/organization GitHub Pages sites
  css: {
    postcss: './postcss.config.js',
  },
});
