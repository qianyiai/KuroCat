export interface CompanionSettings {
  enabled: boolean; dshEnabled: boolean; codexEnabled: boolean;
  dshRoot: string; codexRoot: string; layout: 'merged' | 'stacked' | 'minimal'; maxSessions: number;
  bubbleWidth: number; lines: number; fontSize: number; gap: number; showProjects: boolean;
  staleSeconds: number; officeEnabled: boolean; officeApps: string;
  idleSeconds: number; moodEnabled: boolean; moodMinutes: number;
  adapterRoots: Record<string, string>; disabledAdapters: string[];
}
export interface CompanionSession {
  key: string; source: string; project: string; label: string; activity: string;
  progress?: string; stage?: string; outcome: string | null; lastMs: number; visible: boolean; fresh: boolean;
}
export interface CompanionSnapshot {
  settings: CompanionSettings;
  appearance?: { scale: number; opacity: number };
  sources: { id: string; name: string; status: string; sessions: number; errors: number; limited: boolean }[];
  sessions: CompanionSession[]; office: string | null; workSeconds: number; moodLevel: number;
  paused: boolean; locale: string; updatedMs: number; heightLimit?: number;
}
export const companionDefaults: CompanionSettings = {
  enabled: false, dshEnabled: true, codexEnabled: true, dshRoot: '', codexRoot: '',
  layout: 'merged', maxSessions: 3, bubbleWidth: 240, lines: 2, fontSize: 13, gap: 4,
  showProjects: true, staleSeconds: 180, officeEnabled: false,
  officeApps: 'com.microsoft.Excel\ncom.microsoft.Word\ncom.apple.iWork.Numbers\nEXCEL.EXE\nWINWORD.EXE',
  idleSeconds: 180, moodEnabled: true, moodMinutes: 20, adapterRoots: {}, disabledAdapters: [],
};
export function visibleSessions(s: CompanionSnapshot): CompanionSession[] {
  if (!s.settings.enabled || s.paused) return [];
  return s.sessions.filter(r => r.visible && !r.outcome && ['working', 'thinking', 'waiting-approval', 'waiting-input', 'waiting-update'].includes(r.activity))
    .sort((a, b) => a.key.localeCompare(b.key));

}
/** Stable cyclic window: advance one row every four seconds, covering every running session. */
export function rotatingWindow<T>(rows: T[], limit: number, elapsedMs: number): T[] {
  const count = Math.max(1, Math.min(6, Math.floor(limit) || 1));
  if (rows.length <= count) return rows.slice();
  const start = Math.floor(Math.max(0, elapsedMs) / 4000) % rows.length;
  return Array.from({ length: count }, (_, i) => rows[(start + i) % rows.length]);
}
export function motorStatus(s: CompanionSnapshot): 'working' | 'waiting' | 'idle' {
  const rows = visibleSessions(s);
  if (!s.settings.enabled || s.paused) return 'idle';
  if (rows.some(r => r.activity === 'waiting-approval')) return 'waiting';
  if (rows.some(r => r.activity === 'working') || s.office) return 'working';
  return 'idle';
}
export function demoSnapshot(): CompanionSnapshot {
  const now = Date.now();
  return { settings: { ...companionDefaults, enabled: true }, sources: [
    { id: 'dsh', name: 'DSH', status: 'ready', sessions: 2, errors: 0, limited: false },
    { id: 'codex', name: 'Codex', status: 'ready', sessions: 1, errors: 0, limited: false },
  ], sessions: [
    { key: 'demo-a', source: 'dsh', project: '示例项目', label: '完善桌宠工作陪伴', progress: '整理多会话展示与设置入口', stage: 'editing', activity: 'working', outcome: null, lastMs: now, visible: true, fresh: true },
    { key: 'demo-b', source: 'codex', project: 'KuroCat', label: '实现免插件状态同步', progress: '验证只读适配器与界面布局', stage: 'testing', activity: 'working', outcome: null, lastMs: now, visible: true, fresh: true },
    { key: 'demo-c', source: 'dsh', project: '', label: '检查工作计划', activity: 'unknown', outcome: null, lastMs: now, visible: true, fresh: false },
  ], office: null, workSeconds: 1340, moodLevel: 1, paused: false, locale: 'zh-CN', updatedMs: now };
}

/** Reserve heading, two title lines, progress/project lines, stage and card spacing. */
export function bubbleRowHeight(cfg: CompanionSettings): number {
  return cfg.layout === 'minimal' ? Math.ceil(cfg.fontSize * 1.4) + 14 : cfg.fontSize * (cfg.lines * 3 + 6) + 32;
}

export function bubbleCapacity(cfg: CompanionSettings, heightLimit?: number): number {
  if (cfg.layout === 'minimal') return 1;
  return Math.min(cfg.maxSessions, Math.max(1, Math.floor(((heightLimit || 1200) - 62) / bubbleRowHeight(cfg))));
}
