import { invoke } from '@tauri-apps/api/core';

/** Reflects whether a custom purr recording is installed in a context menu. */
export function syncPurrMenu(hasCustom: boolean): void {
  const hint = document.getElementById('purr-hint');
  if (hint) hint.textContent = hasCustom ? '自定义' : '内置';
  document.getElementById('btn-clear-purr')?.classList.toggle('hidden', !hasCustom);
}

export async function refreshPurrMenu(): Promise<void> {
  syncPurrMenu(await invoke<boolean>('has_custom_purr').catch(() => false));
}
