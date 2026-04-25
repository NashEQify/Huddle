import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

// ── Types ────────────────────────────────────────────────

export type SettingsTab = 'profile' | 'audio-video' | 'appearance' | 'admin';

export type ActiveView =
  | { type: 'welcome' }
  | { type: 'room'; roomId: string }
  | { type: 'dm'; userId: string }
  | { type: 'settings'; tab?: SettingsTab };

interface NavigationContextType {
  activeView: ActiveView;
  navigateToWelcome: () => void;
  navigateToRoom: (roomId: string) => void;
  navigateToDm: (userId: string) => void;
  navigateToSettings: (tab?: SettingsTab) => void;
}

// ── URL <-> ActiveView mapping ──────────────────────────

function urlToView(pathname: string): ActiveView {
  if (pathname.startsWith('/room/')) {
    const roomId = pathname.slice(6);
    if (roomId) return { type: 'room', roomId };
  }
  if (pathname.startsWith('/dm/')) {
    const userId = pathname.slice(4);
    if (userId) return { type: 'dm', userId };
  }
  if (pathname === '/settings/audio-video') {
    return { type: 'settings', tab: 'audio-video' };
  }
  if (pathname === '/settings/admin' || pathname === '/admin') {
    return { type: 'settings', tab: 'admin' };
  }
  if (pathname.startsWith('/settings')) {
    return { type: 'settings', tab: 'profile' };
  }
  return { type: 'welcome' };
}

function viewToUrl(view: ActiveView): string {
  switch (view.type) {
    case 'room': return `/room/${view.roomId}`;
    case 'dm': return `/dm/${view.userId}`;
    case 'settings': return `/settings/${view.tab ?? 'profile'}`;
    case 'welcome': return '/';
  }
}

// ── Context ──────────────────────────────────────────────

const NavigationContext = createContext<NavigationContextType | null>(null);

// ── Provider ─────────────────────────────────────────────

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>(() =>
    urlToView(window.location.pathname)
  );

  // Sync URL on view change via pushState
  const navigateTo = useCallback((view: ActiveView) => {
    const url = viewToUrl(view);
    if (window.location.pathname !== url) {
      window.history.pushState(null, '', url);
    }
    setActiveView(view);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      setActiveView(urlToView(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToWelcome = useCallback(() => navigateTo({ type: 'welcome' }), [navigateTo]);
  const navigateToRoom = useCallback((roomId: string) => navigateTo({ type: 'room', roomId }), [navigateTo]);
  const navigateToDm = useCallback((userId: string) => navigateTo({ type: 'dm', userId }), [navigateTo]);
  const navigateToSettings = useCallback((tab?: SettingsTab) => navigateTo({ type: 'settings', tab: tab ?? 'profile' }), [navigateTo]);

  const value = useMemo(
    () => ({
      activeView,
      navigateToWelcome,
      navigateToRoom,
      navigateToDm,
      navigateToSettings,
    }),
    [activeView, navigateToWelcome, navigateToRoom, navigateToDm, navigateToSettings]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function useNavigation(): NavigationContextType {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return ctx;
}
