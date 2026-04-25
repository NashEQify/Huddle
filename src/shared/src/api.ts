export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: { code: string; message: string };
}

export type ScopeType = 'room' | 'direct';
