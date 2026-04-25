/**
 * Chat Font Size — client-side only, localStorage persisted.
 *
 * Applies --chat-font-size CSS variable on <html>.
 * Provides increase/decrease with clamped range.
 */

const STORAGE_KEY = 'huddle-chat-font-size';
const MIN_PX = 12;
const MAX_PX = 24;
const DEFAULT_PX = 14;
const STEP_PX = 2;

function read(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_PX;
  const n = parseInt(stored, 10);
  if (isNaN(n) || n < MIN_PX || n > MAX_PX) return DEFAULT_PX;
  return n;
}

function apply(px: number) {
  document.documentElement.style.setProperty('--chat-font-size', `${px}px`);
}

/** Call once on app boot to sync stored value to CSS */
export function initChatFontSize() {
  apply(read());
}

export function getChatFontSize(): number {
  return read();
}

export function increaseChatFontSize(): number {
  const next = Math.min(read() + STEP_PX, MAX_PX);
  localStorage.setItem(STORAGE_KEY, String(next));
  apply(next);
  return next;
}

export function decreaseChatFontSize(): number {
  const next = Math.max(read() - STEP_PX, MIN_PX);
  localStorage.setItem(STORAGE_KEY, String(next));
  apply(next);
  return next;
}
