// Augment the Cloudflare namespace to add custom env vars
declare namespace Cloudflare {
  interface Env {
    ANDROID_EMULATOR?: string;
    EXPO_ACCESS_TOKEN?: string;
  }
}
