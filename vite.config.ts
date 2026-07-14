import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron';
  const basePath = isElectron ? './' : '/WRO2026ELE_MeasureTool/';

  return {
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'inline',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}']
        },
        manifest: {
          name: 'WRO 2026 場地測量與模擬工具',
          short_name: 'WRO 2026 測量工具',
          description: 'WRO 2026 場地測量與機器人模擬工具 (可離線使用)',
          theme_color: '#1e293b',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          start_url: isElectron ? '.' : '/WRO2026ELE_MeasureTool/',
          scope: isElectron ? '.' : '/WRO2026ELE_MeasureTool/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'icon.png',
              sizes: '256x256',
              type: 'image/png'
            }
          ]
        }
      })
    ],
  };
});

