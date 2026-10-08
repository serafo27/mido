// Embedded stand-in for @tauri-apps/api/app.
export async function getVersion(): Promise<string> {
  return import.meta.env.VITE_APP_VERSION;
}
