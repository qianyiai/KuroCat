import { invoke } from '@tauri-apps/api/core';

export interface KeyStats {
  day: number;
  tzOffsetMinutes: number;
  total: number;
}

const WEB_STORAGE_KEY = 'kurocat_today_typing_stats';
let nativeBackend = false;

export function isNativeStatsBackend(): boolean {
  return nativeBackend;
}

/** Local wall-clock day index + IANA-free date string, no date library needed. */
export function localDayInfo(): { day: number; tzOffsetMinutes: number; date: string } {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  const localMs = Date.now() - tzOffsetMinutes * 60_000;
  const wall = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  return {
    day: Math.floor(localMs / 86_400_000),
    tzOffsetMinutes,
    date,
  };
}

function readWebStats(date: string): KeyStats {
  const info = localDayInfo();
  try {
    const raw = window.localStorage.getItem(WEB_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { date?: string; total?: number }) : null;
    if (parsed?.date === date && typeof parsed.total === 'number') {
      return { ...info, total: parsed.total };
    }
  } catch {
    // Ignore storage/quota errors
  }
  return { ...info, total: 0 };
}

/** Web playground fallback: count DOM key presses (native hook is unavailable). */
export function bumpWebKeyStats(): number {
  const info = localDayInfo();
  const next = readWebStats(info.date).total + 1;
  try {
    window.localStorage.setItem(
      WEB_STORAGE_KEY,
      JSON.stringify({ date: info.date, total: next }),
    );
  } catch {
    // Ignore storage/quota errors
  }
  return next;
}

/** Reads today's stats from Rust; falls back to localStorage in the browser build. */
export async function readKeyStats(): Promise<KeyStats> {
  const info = localDayInfo();
  try {
    const stats = await invoke<KeyStats>('get_key_stats', {
      day: info.day,
      tzOffsetMinutes: info.tzOffsetMinutes,
    });
    nativeBackend = true;
    return stats;
  } catch {
    nativeBackend = false;
    return readWebStats(info.date);
  }
}
