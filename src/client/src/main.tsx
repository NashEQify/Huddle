import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';
import { initChatFontSize } from './stores/chatFontSize';
import { fetchLivekitUrl } from './lib/livekit-url';

initChatFontSize();

// Populate LiveKit URL cache from server config (fire-and-forget).
// This resolves before the user can initiate a call (requires login first).
fetchLivekitUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
