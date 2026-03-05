import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': {
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        Tiingo_API_Key1: env.Tiingo_API_Key1,
        Tiingo_API_Key2: env.Tiingo_API_Key2,
        Tiingo_API_Key3: env.Tiingo_API_Key3,
        Tiingo_API_Key4: env.Tiingo_API_Key4,
        Tiingo_API_Key5: env.Tiingo_API_Key5,
        Finnhub_API_Key1: env.Finnhub_API_Key1,
        Finnhub_API_Key2: env.Finnhub_API_Key2,
        Finnhub_API_Key3: env.Finnhub_API_Key3,
        Finnhub_API_Key4: env.Finnhub_API_Key4,
        Finnhub_API_Key5: env.Finnhub_API_Key5,
        'Logo.Dev_API_Key': env['Logo.Dev_API_Key'],
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
