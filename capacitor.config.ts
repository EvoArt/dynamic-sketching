import type { CapacitorConfig } from '@capacitor/cli'

// The Android app: the built site (dist/) packaged inside an APK, so it works offline from
// the first launch. Build with `npm run android:build`.
const config: CapacitorConfig = {
  appId: 'io.github.evoart.dynamicsketching',
  appName: 'Dynamic Sketching',
  webDir: 'dist',
  backgroundColor: '#f3efe6',
  plugins: {
    // Edge to edge: the page already pads for env(safe-area-inset-*), with viewport-fit=cover.
    SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover' },
  },
}

export default config
