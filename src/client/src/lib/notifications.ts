/**
 * Browser Notification utilities
 *
 * Requests permission lazily (on first message, not on page load)
 * and shows notifications only when the tab is not focused.
 */

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function showNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // Don't notify if tab is focused

  const notification = new Notification(title, {
    body,
    icon: '/favicon.ico',
    tag: 'huddle-message', // Collapse multiple notifications
  });

  if (onClick) {
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  }

  // Auto-dismiss after 5 seconds
  setTimeout(() => notification.close(), 5000);
}
