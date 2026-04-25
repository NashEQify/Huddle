// ── Welcome Screen Types ─────────────────────────────────

export interface WelcomeData {
  lastLoginAt: string | null;
  onlineCount: number;
  totalUsers: number;
  activeCalls: number;
  activeScreenshares: number;
  motdQuote: { text: string; attribution: string } | null;
  tip: string;
}
