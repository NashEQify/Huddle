import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Package version (single source of truth) ───────────────
//
// Surfaces in the app UI (WelcomeScreen, future About/footer) via the
// __APP_VERSION__ compile-time constant. A single `npm version` bump in
// `src/client/package.json` propagates to display automatically.
const pkg = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'),
    'utf-8',
  ),
) as { version: string };

// ── MediaPipe WASM Self-Hosting ─────────────────────────────
//
// @livekit/track-processors uses @mediapipe/tasks-vision, which by default
// fetches the WASM runtime from cdn.jsdelivr.net and the selfie-segmenter
// model from storage.googleapis.com. For a self-hosted app those external
// fetches fail silently (Brave Shields, strict networks, offline dev) —
// incident IT-1 (2026-04-10) was "blur does nothing".
//
// Fix: serve the WASM from our own /mediapipe/wasm/ path. The model
// (selfie_segmenter.tflite, 244 KB) is committed to the repo, but the WASM
// files (~19 MB) are copied from node_modules at dev/build time by this
// plugin — keeping the repo clean.
//
// Consumers pass assetPaths to BackgroundProcessor — see
// src/stores/call.tsx and src/components/settings/CameraPreview.tsx.
function copyMediapipeWasm(): PluginOption {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const src = resolve(__dirname, '../../node_modules/@mediapipe/tasks-vision/wasm');
  const dest = resolve(__dirname, 'public/mediapipe/wasm');

  function copyOnce() {
    if (!existsSync(src)) {
      throw new Error(
        `[vite:copy-mediapipe-wasm] Source missing: ${src}\n` +
        `Run \`npm install\` before building the client.`,
      );
    }
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }

  return {
    name: 'copy-mediapipe-wasm',
    buildStart() {
      copyOnce();
    },
    configureServer(server) {
      copyOnce();
      // Vite does not know the .tflite extension → it serves without a
      // Content-Type header, which can trip strict fetch loaders. Inject
      // a middleware that sets application/octet-stream for .tflite.
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.endsWith('.tflite')) {
          res.setHeader('Content-Type', 'application/octet-stream');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl(), copyMediapipeWasm()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: ['es2020', 'chrome87', 'firefox78', 'safari15', 'edge88'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
      // LiveKit signaling — proxied to avoid mixed-content blocking (HTTPS page → ws:// blocked)
      // Client connects to wss://host:5173/livekit, Vite proxies to ws://localhost:7880
      '/livekit': {
        target: 'ws://localhost:7880',
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
    },
  },
});
