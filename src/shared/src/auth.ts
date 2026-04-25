export interface AuthUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthProfile {
  title: string;
  avatarKind: 'built_in' | 'uploaded';
  builtInAvatarId: string | null;
  portraitUrl: string | null;
}

export interface AuthSessionData {
  user: AuthUser;
  profile: AuthProfile | null;
  mustChangePassword: boolean;
}

export interface SignupRequest {
  username: string;
  email: string;
  password: string;
  passwordRepeat: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ChangePasswordRequest {
  newPassword: string;
  newPasswordRepeat: string;
}
