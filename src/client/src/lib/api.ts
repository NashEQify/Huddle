import type { ApiResponse, ApiError } from '@huddle/shared';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError['error'] };

async function request<T>(
  method: string,
  url: string,
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const opts: RequestInit = {
      method,
      credentials: 'include',
      headers: {},
    };

    if (body !== undefined) {
      (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        ok: false,
        error: { code: 'PARSE_ERROR', message: `Server returned non-JSON response (${res.status})` },
      };
    }

    if (!res.ok) {
      const err = json as ApiError;
      return {
        ok: false,
        error: err.error || { code: 'UNKNOWN', message: 'An unknown error occurred' },
      };
    }

    const success = json as ApiResponse<T>;
    return { ok: true, data: success.data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: (err instanceof Error ? err.message : undefined) || 'Network request failed' },
    };
  }
}

async function uploadFile<T>(
  url: string,
  file: File
): Promise<ApiResult<T>> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await res.json();

  if (!res.ok) {
    const err = json as ApiError;
    return {
      ok: false,
      error: err.error || { code: 'UNKNOWN', message: 'An unknown error occurred' },
    };
  }

  const success = json as ApiResponse<T>;
  return { ok: true, data: success.data };
}

/**
 * Send a message with optional file attachments via multipart/form-data.
 * Uses XMLHttpRequest for upload progress tracking.
 */
async function sendMessageWithFiles<T>(
  url: string,
  fields: Record<string, string>,
  files: File[],
  onProgress?: (loaded: number, total: number) => void
): Promise<ApiResult<T>> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  for (const file of files) {
    formData.append('files', file);
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded, e.total);
        }
      });
    }

    xhr.addEventListener('load', () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          const success = json as ApiResponse<T>;
          resolve({ ok: true, data: success.data });
        } else {
          const err = json as ApiError;
          resolve({
            ok: false,
            error: err.error || { code: 'UNKNOWN', message: 'Upload failed' },
          });
        }
      } catch {
        resolve({
          ok: false,
          error: { code: 'UNKNOWN', message: 'Invalid server response' },
        });
      }
    });

    xhr.addEventListener('error', () => {
      resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'Network error during upload' },
      });
    });

    xhr.send(formData);
  });
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File) => uploadFile<T>(url, file),
  sendMessageWithFiles: <T>(
    url: string,
    fields: Record<string, string>,
    files: File[],
    onProgress?: (loaded: number, total: number) => void
  ) => sendMessageWithFiles<T>(url, fields, files, onProgress),
};
