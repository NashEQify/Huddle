import { useState } from 'react';
import { AuthProvider, useAuth } from './stores/auth';
import { WsProvider } from './stores/ws';
import { PresenceProvider } from './stores/presence';
import { NavigationProvider } from './stores/navigation';
import { CallProvider } from './stores/call';
import { ScreenshareProvider } from './stores/screenshare';
import { UnreadProvider } from './stores/unread';
import { ThemeProvider } from './stores/theme';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForcePasswordChangePage } from './pages/ForcePasswordChangePage';
import { AppShell } from './pages/AppShell';

type AuthView = 'login' | 'signup';

function AppContent() {
  const { user, mustChangePassword, isLoading } = useAuth();
  const [view, setView] = useState<AuthView>('login');

  // Loading state — auto-login check in progress
  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-base)' }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-base)',
            color: 'var(--text-muted)',
          }}
        >
          loading...
        </div>
      </div>
    );
  }

  // Authenticated but must change password
  if (user && mustChangePassword) {
    return <ForcePasswordChangePage />;
  }

  // Authenticated — wrap in WsProvider + PresenceProvider
  if (user) {
    return (
      <WsProvider>
        <PresenceProvider>
          <NavigationProvider>
            <UnreadProvider>
              <CallProvider>
                <ScreenshareProvider>
                  <AppShell />
                </ScreenshareProvider>
              </CallProvider>
            </UnreadProvider>
          </NavigationProvider>
        </PresenceProvider>
      </WsProvider>
    );
  }

  // Unauthenticated
  if (view === 'signup') {
    return <SignupPage onSwitchToLogin={() => setView('login')} />;
  }

  return <LoginPage onSwitchToSignup={() => setView('signup')} />;
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
