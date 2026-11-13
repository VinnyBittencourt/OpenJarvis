// Desktop app mode: the launcher (JARVIS.bat) opens the interface in its own window with
// "?app=1". The flag is kept for the session because in-app navigation drops the query string.
const KEY = 'jarvis-app-mode';

export function isAppMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('app')) sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
