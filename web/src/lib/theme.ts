export type Theme = 'dark' | 'light';

/** Apply the theme to <html> and remember it on this device. */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem('set_theme', theme);
  } catch {
    /* private mode */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5f8' : '#0a0c11');
}

export function currentTheme(): Theme {
  try {
    return localStorage.getItem('set_theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Boot-time: apply the remembered theme before first paint. */
applyTheme(currentTheme());

/** Persist the choice to the account so it follows the user across devices. */
export function saveThemePreference(theme: Theme) {
  try {
    const token = localStorage.getItem('set_token');
    if (token) {
      void fetch('/api/users/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ theme }),
      });
    }
  } catch {
    /* device-local is fine */
  }
}

/** Pull the account's theme (cross-device sync); applies it when present. */
export async function syncThemeFromAccount() {
  try {
    const token = localStorage.getItem('set_token');
    if (!token) return;
    const res = await fetch('/api/users/preferences', { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json();
    const theme = data?.preferences?.theme;
    if (theme === 'light' || theme === 'dark') applyTheme(theme);
  } catch {
    /* offline / logged out — keep device theme */
  }
}
