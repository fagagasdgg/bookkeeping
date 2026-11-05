import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bookkeeping.app',
  appName: '本地记账',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
