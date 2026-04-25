import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    outDir: 'build'
  },
  server: {
    port: 3002,
    open: false
  }
});
