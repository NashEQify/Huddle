/// <reference types="vite/client" />

/**
 * Compile-time constant injected by `vite.config.ts` from `package.json`.
 * Used for version display (WelcomeScreen, etc.) so a single `npm version`
 * bump propagates to the UI automatically.
 */
declare const __APP_VERSION__: string;
