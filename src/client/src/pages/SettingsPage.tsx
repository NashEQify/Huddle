import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useAuth } from '../stores/auth';
import { useNavigation, type SettingsTab } from '../stores/navigation';
import { api } from '../lib/api';
import { resizeImage } from '../lib/imageResize';
import { ImageCropModal } from '../components/chat/ImageCropModal';
import { AudioVideoSettings } from '../components/settings/AudioVideoSettings';
import { useTheme, THEMES } from '../stores/theme';
import { AdminPage } from './AdminPage';
import type {
  AuthProfile,
  AuthUser,
  BuiltInAvatarEntry,
} from '@huddle/shared';

// ── Style Constants ──────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-base)',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: 'var(--text-secondary)',
  fontSize: 'var(--text-sm)',
  marginBottom: 'var(--space-1)',
  fontFamily: 'var(--font-mono)',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 0,
  padding: 'var(--space-2) var(--space-4)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  transition: 'background 150ms, color 150ms',
};

// ── Helpers ──────────────────────────────────────────────

function HexLabel({ hex, label }: { hex: string; label: string }) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>[ </span>
      <span style={{ color: 'var(--text-secondary)' }}>{hex} </span>
      <span style={{ color: 'var(--accent)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)' }}> ]</span>
    </div>
  );
}

function StatusMessage({ type, text }: { type: 'success' | 'error'; text: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        color: type === 'success' ? 'var(--success)' : 'var(--error)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
        marginTop: 'var(--space-2)',
      }}
    >
      {text}
    </div>
  );
}

function handleFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'var(--accent)';
  e.currentTarget.style.boxShadow = 'var(--glow-ring)';
}

function handleBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'var(--border-default)';
  e.currentTarget.style.boxShadow = 'none';
}

function handleBtnEnter(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--accent)';
  e.currentTarget.style.color = 'var(--bg-base)';
}

function handleBtnLeave(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--accent)';
}

// ── Main Component ───────────────────────────────────────

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const { user, profile, updateProfile, updateUser } = useAuth();
  const { activeView, navigateToSettings } = useNavigation();
  const initialTab: SettingsTab = activeView.type === 'settings' && activeView.tab ? activeView.tab : 'profile';
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const switchTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    navigateToSettings(tab);
  };

  const tabStyle = (tab: SettingsTab): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: activeTab === tab
      ? '2px solid var(--accent)'
      : '2px solid transparent',
    color: activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: 'var(--space-2) var(--space-4)',
    cursor: 'pointer',
    borderRadius: 0,
    transition: 'color 150ms',
  });

  return (
    <div
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* Tab Navigation */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-default)',
          padding: '0 var(--space-4)',
          maxWidth: '900px',
          margin: '0 auto',
        }}
      >
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'profile'}
          id="tab-profile"
          aria-controls="tabpanel-profile"
          onClick={() => switchTab('profile')}
          style={tabStyle('profile')}
          onMouseEnter={(e) => {
            if (activeTab !== 'profile') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'profile') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          PROFILE
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'audio-video'}
          id="tab-audio-video"
          aria-controls="tabpanel-audio-video"
          onClick={() => switchTab('audio-video')}
          style={tabStyle('audio-video')}
          onMouseEnter={(e) => {
            if (activeTab !== 'audio-video') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'audio-video') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          AUDIO / VIDEO
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'appearance'}
          id="tab-appearance"
          aria-controls="tabpanel-appearance"
          onClick={() => switchTab('appearance')}
          style={tabStyle('appearance')}
          onMouseEnter={(e) => {
            if (activeTab !== 'appearance') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'appearance') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          COLOR THEME
        </button>
        {user?.isAdmin && (
          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'admin'}
            id="tab-admin"
            aria-controls="tabpanel-admin"
            onClick={() => switchTab('admin')}
            style={{
              ...tabStyle('admin'),
              color: activeTab === 'admin' ? 'var(--warning)' : 'var(--text-secondary)',
              borderBottomColor: activeTab === 'admin' ? 'var(--warning)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'admin') {
                e.currentTarget.style.color = 'var(--warning)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'admin') {
                e.currentTarget.style.color = 'var(--text-secondary)';
              }
            }}
          >
            ADMIN
          </button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div
          role="tabpanel"
          id="tabpanel-profile"
          aria-labelledby="tab-profile"
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: 'var(--space-4) var(--space-4)',
          }}
        >
          {user && profile && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-4)',
                }}
              >
                {/* Left column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <AvatarSection
                    profile={profile}
                    onProfileUpdate={updateProfile}
                  />
                </div>

                {/* Right column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <EmailSection
                    currentEmail={user.email}
                    onUserUpdate={updateUser}
                  />
                  <PasswordSection />
                </div>
              </div>

            </>
          )}
        </div>
      )}

      {activeTab === 'audio-video' && (
        <div
          role="tabpanel"
          id="tabpanel-audio-video"
          aria-labelledby="tab-audio-video"
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: 'var(--space-4) var(--space-4)',
          }}
        >
          <AudioVideoSettings />
        </div>
      )}

      {activeTab === 'appearance' && (
        <div
          role="tabpanel"
          id="tabpanel-appearance"
          aria-labelledby="tab-appearance"
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: 'var(--space-4) var(--space-4)',
          }}
        >
          <AppearanceSection />
        </div>
      )}

      {activeTab === 'admin' && user?.isAdmin && (
        <div
          role="tabpanel"
          id="tabpanel-admin"
          aria-labelledby="tab-admin"
        >
          <AdminPage />
        </div>
      )}
    </div>
  );
}

// ── Avatar Section ───────────────────────────────────────

function AvatarSection({
  profile,
  onProfileUpdate,
}: {
  profile: AuthProfile;
  onProfileUpdate: (p: AuthProfile) => void;
}) {
  const [avatars, setAvatars] = useState<BuiltInAvatarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string }>({ type: 'success', text: '' });
  const [uploading, setUploading] = useState(false);
  const [cropTarget, setCropTarget] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const result = await api.get<{ avatars: BuiltInAvatarEntry[] }>('/api/settings/avatars');
      if (result.ok) {
        setAvatars(result.data.avatars);
      }
      setLoading(false);
    })();
  }, []);

  async function selectAvatar(avatarId: string) {
    setStatus({ type: 'success', text: '' });
    const result = await api.patch<{ profile: AuthProfile }>('/api/settings/profile', {
      builtInAvatarId: avatarId,
    });
    if (result.ok) {
      onProfileUpdate(result.data.profile);
      setStatus({ type: 'success', text: 'avatar updated' });
    } else {
      setStatus({ type: 'error', text: result.error.message });
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setStatus({ type: 'error', text: 'Only PNG, JPEG, and WebP are allowed' });
      return;
    }

    // Open crop modal (no size limit — resize handles it)
    setCropTarget(file);

    // Reset file input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const uploadPortrait = useCallback(async (file: File) => {
    setUploading(true);
    setStatus({ type: 'success', text: '' });

    try {
      // Resize if >1 MB
      const resized = await resizeImage(file);

      const result = await api.upload<{ profile: AuthProfile }>(
        '/api/settings/portrait',
        resized
      );

      if (result.ok) {
        onProfileUpdate(result.data.profile);
        setStatus({ type: 'success', text: 'portrait uploaded' });
      } else {
        setStatus({ type: 'error', text: result.error.message });
      }
    } catch {
      setStatus({ type: 'error', text: 'Image processing failed' });
    }

    setUploading(false);
  }, [onProfileUpdate]);

  const handleCropApply = useCallback((croppedFile: File) => {
    setCropTarget(null);
    uploadPortrait(croppedFile);
  }, [uploadPortrait]);

  const handleCropSkip = useCallback(() => {
    if (cropTarget) {
      const file = cropTarget;
      setCropTarget(null);
      uploadPortrait(file);
    }
  }, [cropTarget, uploadPortrait]);

  const handleCropCancel = useCallback(() => {
    setCropTarget(null);
  }, []);

  return (
    <div>
      <HexLabel hex="0xA0" label="AVATAR" />

      {loading ? (
        <div
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
          }}
        >
          loading avatars...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 80px)',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {avatars.map((avatar) => {
            const isSelected =
              profile.avatarKind === 'built_in' &&
              profile.builtInAvatarId === avatar.id;
            return (
              <button
                key={avatar.id}
                type="button"
                title={avatar.label}
                onClick={() => selectAvatar(avatar.id)}
                style={{
                  width: '80px',
                  height: '80px',
                  padding: 0,
                  background: 'var(--bg-input)',
                  border: isSelected
                    ? '2px solid var(--accent)'
                    : '1px solid var(--border-default)',
                  borderRadius: 0,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  transition: 'border-color 150ms',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--accent-dim)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                  }
                }}
              >
                <img
                  src={avatar.imageUrl}
                  alt={avatar.label}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Portrait Upload */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            ...btnStyle,
            color: uploading ? 'var(--text-muted)' : 'var(--accent)',
            borderColor: uploading ? 'var(--border-default)' : 'var(--accent)',
            cursor: uploading ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!uploading) handleBtnEnter(e);
          }}
          onMouseLeave={(e) => {
            if (!uploading) handleBtnLeave(e);
          }}
        >
          {uploading ? 'uploading...' : 'UPLOAD PORTRAIT'}
        </button>

        {profile.avatarKind === 'uploaded' && profile.portraitUrl && (
          <div
            style={{
              width: '56px',
              height: '56px',
              border: '2px solid var(--accent)',
              borderRadius: 0,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <img
              src={profile.portraitUrl}
              alt="Current portrait"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>
        )}
      </div>

      <StatusMessage type={status.type} text={status.text} />

      {/* Crop Modal for portrait upload */}
      {cropTarget && (
        <ImageCropModal
          file={cropTarget}
          onApply={handleCropApply}
          onSkip={handleCropSkip}
          onCancel={handleCropCancel}
          fixedAspect={1}
        />
      )}
    </div>
  );
}

// ── Title Section ────────────────────────────────────────

function TitleSection({
  currentTitle,
  onProfileUpdate,
}: {
  currentTitle: string;
  onProfileUpdate: (p: AuthProfile) => void;
}) {
  const [title, setTitle] = useState(currentTitle);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string }>({ type: 'success', text: '' });
  const [saving, setSaving] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || title.trim().length > 40) {
      setStatus({ type: 'error', text: 'Title must be 1-40 characters' });
      return;
    }

    setSaving(true);
    setStatus({ type: 'success', text: '' });

    const result = await api.patch<{ profile: AuthProfile }>('/api/settings/profile', {
      title: title.trim(),
    });

    if (result.ok) {
      onProfileUpdate(result.data.profile);
      setStatus({ type: 'success', text: 'title updated' });
    } else {
      setStatus({ type: 'error', text: result.error.message });
    }

    setSaving(false);
  }

  async function handleRandom() {
    setStatus({ type: 'success', text: '' });
    const result = await api.get<{ title: string }>('/api/settings/random-title');
    if (result.ok && result.data.title) {
      setTitle(result.data.title);
    }
  }

  return (
    <div>
      <HexLabel hex="0xA1" label="TITLE" />

      <form onSubmit={handleSave}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Your title..."
            style={{ ...inputStyle, flex: 1 }}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          <button
            type="button"
            onClick={handleRandom}
            title="Get random title from pool"
            style={{
              ...btnStyle,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={handleBtnEnter}
            onMouseLeave={handleBtnLeave}
          >
            RANDOM
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              ...btnStyle,
              color: saving ? 'var(--text-muted)' : 'var(--accent)',
              borderColor: saving ? 'var(--border-default)' : 'var(--accent)',
              cursor: saving ? 'default' : 'pointer',
            }}
            onMouseEnter={(e) => { if (!saving) handleBtnEnter(e); }}
            onMouseLeave={(e) => { if (!saving) handleBtnLeave(e); }}
          >
            {saving ? 'saving...' : 'SAVE'}
          </button>
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {title.length}/40
          </span>
        </div>
      </form>

      <StatusMessage type={status.type} text={status.text} />
    </div>
  );
}

// ── Appearance Section ───────────────────────────────────

function AppearanceSection() {
  const { themeId, setTheme } = useTheme();

  return (
    <div>
      <HexLabel hex="0xC0" label="COLOR SCHEME" />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 'var(--space-3)',
        }}
      >
        {THEMES.map((theme) => {
          const isActive = themeId === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setTheme(theme.id)}
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'var(--bg-input)',
                border: isActive
                  ? `2px solid ${theme.preview}`
                  : '1px solid var(--border-default)',
                borderRadius: 0,
                padding: 'var(--space-3)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 150ms, background 150ms',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = theme.preview;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = 'var(--border-default)';
                }
              }}
            >
              {/* Color preview swatch */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  background: theme.preview,
                  flexShrink: 0,
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              />
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-base)',
                    color: isActive ? theme.preview : 'var(--text-primary)',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {theme.label}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    marginTop: '2px',
                  }}
                >
                  {theme.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Email Section ────────────────────────────────────────

function EmailSection({
  currentEmail,
  onUserUpdate,
}: {
  currentEmail: string;
  onUserUpdate: (u: Partial<AuthUser>) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string }>({ type: 'success', text: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setStatus({ type: 'error', text: 'Email is required' });
      return;
    }
    if (!password) {
      setStatus({ type: 'error', text: 'Current password is required' });
      return;
    }

    setSaving(true);
    setStatus({ type: 'success', text: '' });

    const result = await api.patch<{ user: AuthUser }>('/api/settings/email', {
      email: email.trim(),
      currentPassword: password,
    });

    if (result.ok) {
      onUserUpdate({ email: result.data.user.email });
      setEmail('');
      setPassword('');
      setStatus({ type: 'success', text: 'email updated' });
    } else {
      setStatus({ type: 'error', text: result.error.message });
    }

    setSaving(false);
  }

  return (
    <div>
      <HexLabel hex="0xA2" label="EMAIL" />

      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 'var(--space-3)',
        }}
      >
        current: <span style={{ color: 'var(--text-primary)' }}>{currentEmail}</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="settings-email" style={labelStyle}>new email</label>
          <input
            id="settings-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="new@email.com"
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="settings-email-pw" style={labelStyle}>current password</label>
          <input
            id="settings-email-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            ...btnStyle,
            color: saving ? 'var(--text-muted)' : 'var(--accent)',
            borderColor: saving ? 'var(--border-default)' : 'var(--accent)',
            cursor: saving ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => { if (!saving) handleBtnEnter(e); }}
          onMouseLeave={(e) => { if (!saving) handleBtnLeave(e); }}
        >
          {saving ? 'saving...' : 'SAVE'}
        </button>
      </form>

      <StatusMessage type={status.type} text={status.text} />
    </div>
  );
}

// ── Password Section ─────────────────────────────────────

function PasswordSection() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [repeatPw, setRepeatPw] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string }>({ type: 'success', text: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!currentPw) {
      setStatus({ type: 'error', text: 'Current password is required' });
      return;
    }
    if (newPw.length < 8 || newPw.length > 64) {
      setStatus({ type: 'error', text: 'New password must be 8-64 characters' });
      return;
    }
    if (newPw !== repeatPw) {
      setStatus({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    setSaving(true);
    setStatus({ type: 'success', text: '' });

    const result = await api.patch<{ ok: true }>('/api/settings/password', {
      currentPassword: currentPw,
      newPassword: newPw,
      newPasswordRepeat: repeatPw,
    });

    if (result.ok) {
      setCurrentPw('');
      setNewPw('');
      setRepeatPw('');
      setStatus({ type: 'success', text: 'password changed' });
    } else {
      setStatus({ type: 'error', text: result.error.message });
    }

    setSaving(false);
  }

  return (
    <div>
      <HexLabel hex="0xA3" label="PASSWORD" />

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="settings-pw-current" style={labelStyle}>current password</label>
          <input
            id="settings-pw-current"
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="settings-pw-new" style={labelStyle}>new password</label>
          <input
            id="settings-pw-new"
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="settings-pw-repeat" style={labelStyle}>repeat new password</label>
          <input
            id="settings-pw-repeat"
            type="password"
            autoComplete="new-password"
            value={repeatPw}
            onChange={(e) => setRepeatPw(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            ...btnStyle,
            color: saving ? 'var(--text-muted)' : 'var(--accent)',
            borderColor: saving ? 'var(--border-default)' : 'var(--accent)',
            cursor: saving ? 'default' : 'pointer',
          }}
          onMouseEnter={(e) => { if (!saving) handleBtnEnter(e); }}
          onMouseLeave={(e) => { if (!saving) handleBtnLeave(e); }}
        >
          {saving ? 'saving...' : 'SAVE'}
        </button>
      </form>

      <StatusMessage type={status.type} text={status.text} />
    </div>
  );
}

