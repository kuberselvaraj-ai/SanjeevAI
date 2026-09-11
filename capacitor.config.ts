import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SanjeevAI native shell (iOS/Android via Codemagic).
 *
 * Thin-shell mode: the app loads the live hosted site, so every deploy is
 * instantly in the apps and there is zero CORS/cookie work on the API.
 * `webDir` is still bundled as the on-device fallback shell.
 *
 * To go fully bundled later (better App Store odds): remove `server.url`,
 * point the frontend's API base at the live URL via VITE_API_URL, and add
 * CORS + SameSite=None cookie handling to the server.
 */
const config: CapacitorConfig = {
  appId: "com.sanjeevai.app",
  appName: "Sanjeev AI",
  webDir: "dist",
  server: {
    // The live Cloud Run deployment. Swap to https://sanjeevai.com once the
    // domain is mapped (and re-sync: npx cap sync).
    url: "https://sanjeevai-796272357891.us-central1.run.app",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
