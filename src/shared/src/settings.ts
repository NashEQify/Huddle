// ── Settings Types ───────────────────────────────────────

export interface BuiltInAvatarEntry {
  id: string;
  label: string;
  imageUrl: string;
}

export interface UpdateProfileRequest {
  title?: string;
  builtInAvatarId?: string;
}

export interface UpdateEmailRequest {
  email: string;
  currentPassword: string;
}

export interface UpdatePasswordRequest {
  currentPassword: string;
  newPassword: string;
  newPasswordRepeat: string;
}

