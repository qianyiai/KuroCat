import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { renderBubbles } from './companionUi';
import { demoSnapshot, type CompanionSnapshot } from './companionModel';
const host = document.getElementById('companion-bubbles')!;
let last = 0; let latest: CompanionSnapshot | null = null;
function render(s: CompanionSnapshot) { if (s.updatedMs < last) return; last = s.updatedMs; latest = s; renderBubbles(host, s); }
async function boot() {
  if (isTauri()) {
    await listen<CompanionSnapshot>('kuro-work-companion', e => render(e.payload));
    render(await invoke<CompanionSnapshot>('get_companion_snapshot'));
  } else {
    const s = demoSnapshot(); const query = new URLSearchParams(location.search);
    s.settings.layout = query.get('layout') === 'minimal' ? 'minimal' : query.get('layout') === 'stacked' ? 'stacked' : 'merged';
    const count = Math.min(20, Math.max(0, Number(query.get('demoSessions')) || 0));
    if (count) { s.sessions = Array.from({ length: count }, (_, i) => ({ ...s.sessions[0], key: `demo-${i}`, label: `示例任务 ${i + 1}`, progress: '正在验证状态同步', stage: 'testing' })); s.settings.maxSessions = 6; }
    s.locale = query.get('lang') || 'zh-CN'; render(s);
  }
}
window.setInterval(() => { if (latest) renderBubbles(host, latest); }, 500);
void boot();
