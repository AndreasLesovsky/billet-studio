// Shape of the per-build environment. All fields are required, so a build-specific environment file
// missing one fails at compile time instead of at runtime.
export interface EnvironmentValues {
  apiUrl: string;
  frontendUrl: string;
  siteName: string;
}

// env.js on the server may override any subset at runtime (window.__env wins over the baked-in
// defaults). Declared once here for all environment files.
declare global {
  interface Window {
    __env?: Partial<EnvironmentValues>;
  }
}
