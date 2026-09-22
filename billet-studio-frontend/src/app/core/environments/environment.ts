// LOCAL (ng serve): public/env.js sets an empty window.__env, so the defaults below apply.
// DEPLOYED: env.js is generated with real values, which win over these defaults.
import type { EnvironmentValues } from './environment-values';

const defaults = {
  apiUrl: 'http://localhost:8080/v1/',
  frontendUrl: 'http://localhost:4200',
  siteName: 'billet-studio',
} satisfies EnvironmentValues;

export const baseUrl = window.__env?.apiUrl ?? defaults.apiUrl;
export const frontendUrl = window.__env?.frontendUrl ?? defaults.frontendUrl;
export const siteName = window.__env?.siteName ?? defaults.siteName;
