import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGoogleAuth } from '../useGoogleAuth';

describe('useGoogleAuth hook functionality', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('initializes with default null values or localStorage state', () => {
    localStorage.setItem('lecturescribe_google_user', JSON.stringify({ name: 'Ada', email: 'ada@example.com' }));
    localStorage.setItem('lecturescribe_gdrive_token', 'valid-token-123');
    localStorage.setItem('lecturescribe_gdrive_token_expires', String(Date.now() + 3600000));

    const { result } = renderHook(() => useGoogleAuth(null));
    expect(result.current.googleUser).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(result.current.gdriveAccessToken).toBe('valid-token-123');
  });

  it('clears expired tokens from localStorage on initialization', () => {
    localStorage.setItem('lecturescribe_gdrive_token', 'expired-token');
    localStorage.setItem('lecturescribe_gdrive_token_expires', String(Date.now() - 5000));

    const { result } = renderHook(() => useGoogleAuth(null));
    expect(result.current.gdriveAccessToken).toBe('');
    expect(localStorage.getItem('lecturescribe_gdrive_token')).toBeNull();
  });

  it('handleGoogleSignOut resets state and removes credentials from localStorage', () => {
    localStorage.setItem('lecturescribe_google_user', JSON.stringify({ email: 'user@test.com' }));
    localStorage.setItem('lecturescribe_gdrive_token', 'token-abc');

    const { result } = renderHook(() => useGoogleAuth(null));
    act(() => {
      result.current.handleGoogleSignOut();
    });

    expect(result.current.googleUser).toBeNull();
    expect(result.current.gdriveAccessToken).toBe('');
    expect(localStorage.getItem('lecturescribe_google_user')).toBeNull();
    expect(localStorage.getItem('lecturescribe_gdrive_token')).toBeNull();
  });

  it('manages download modal state and fetches Google Drive status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, client_id: 'client-123' })
    });

    const { result } = renderHook(() => useGoogleAuth({ videoId: 'v1' }));
    expect(result.current.isDownloadModalOpen).toBe(false);

    await act(async () => {
      await result.current.openDownloadModal({ videoId: 'v1' });
    });

    expect(result.current.isDownloadModalOpen).toBe(true);
    expect(result.current.gdriveStatus).toEqual({ configured: true, client_id: 'client-123' });

    act(() => {
      result.current.closeDownloadModal();
    });
    expect(result.current.isDownloadModalOpen).toBe(false);
  });
});
