import { catAudio } from './audio';

export type AgentStatusKind = 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'idle';
export type AgentActionKind =
  | 'happy'
  | 'pet'
  | 'wag'
  | 'angry'
  | 'boop'
  | 'chin'
  | 'dizzy'
  | 'curious'
  | 'sleep'
  | 'wake'
  | 'tail_pat';

export interface AgentCompanionEvent {
  kind: 'status' | 'action' | 'bubble';
  status?: AgentStatusKind | string;
  action?: AgentActionKind | string;
  source?: string;
  /**
   * Optional session key for multi-session clients (e.g. concurrent Claude/Codex/DSH tasks).
   * Falls back to `source` when omitted, preserving single-session behavior.
   */
  session?: string;
  text?: string;
  tool?: string;
  autoType?: boolean;
  sound?: boolean;
  ttlMs?: number;
  ts?: number;
}

export interface AgentCompanionTarget {
  onKeyDown(vk: number, repeat?: boolean): void;
  onKeyUp(vk: number): void;
  triggerCuriousDemo(duration?: number): void;
  triggerCrossDemo(): void;
  triggerSleepDemo(): void;
  triggerHappyDemo?(duration?: number): void;
  triggerBoopDemo?(): void;
  triggerChinScratchDemo?(duration?: number): void;
  triggerDizzyDemo?(duration?: number): void;
  triggerWakeDemo?(): void;
  triggerTailPatDemo?(): void;
}

// Natural coding keystroke VKs (home-row letters, symbols, space, enter, backspace)
const CODING_VKS: readonly number[] = [
  0x41, 0x43, 0x44, 0x45, 0x46, 0x47, 0x49, 0x4c, 0x4d, 0x4e,
  0x4f, 0x50, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x20,
  0x20, 0x0d, 0x08, 0xbc, 0xbe,
];

type BubbleTone = 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'info';

interface SessionBubble {
  el: HTMLDivElement;
  key: string;
  label: string;
  tone: BubbleTone;
  status: AgentStatusKind;
  autoType: boolean;
  ttlTimer: number | null;
}

interface SessionGuard {
  lastTs: number;
  doneAt: number;
}

/** Detect opaque hex/UUID/thread identifiers so bubbles display a clean client name instead of raw IDs. */
function isOpaqueSessionId(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (/^dsh:/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^[0-9a-f_-]{14,}$/i.test(s)) return true;
  if (/^(sess|session|thread|conv|turn|task|t)[_-]?[0-9a-f]{4,}$/i.test(s)) return true;
  return false;
}

function resolveDisplayLabel(session: string | undefined, source: string | undefined, key: string): string {
  const cleanSession = session?.trim() || '';
  const cleanSource = source?.trim() || '';
  if (cleanSession && !isOpaqueSessionId(cleanSession)) {
    return cleanSession;
  }
  if (cleanSource) return cleanSource;
  return isOpaqueSessionId(key) ? 'AI' : key;
}

export interface AgentCompanionOptions {
  bubbleEl: HTMLDivElement | null;
  getTarget: () => AgentCompanionTarget | null;
  is3DTarget: () => boolean;
  allowSound: () => boolean;
}

export class AgentCompanionController {
  private readonly bubbleEl: HTMLDivElement | null;
  private readonly getTarget: () => AgentCompanionTarget | null;
  private readonly is3DTarget: () => boolean;
  private readonly allowSound: () => boolean;

  private activeStatus: AgentStatusKind = 'idle';
  private privacyPaused = false;
  /** Per-session stacked bubbles; Map preserves insertion order = top-to-bottom stack order. */
  private readonly bubbles = new Map<string, SessionBubble>();
  /** Per-session ordering & post-done race guard (#128). */
  private readonly sessionGuards = new Map<string, SessionGuard>();
  /** Cap concurrent on-screen bubbles so multi-session stacks never clutter the pet. */
  private static readonly MAX_BUBBLES = 4;
  private autoTyping = false;
  private realUserInputUntil = 0;
  private typeTimer: number | null = null;
  private releaseTimers = new Set<number>();
  private heldVirtualVks = new Set<number>();
  private burstRemaining = 0;
  private lastSoundAt = 0;

  constructor(opts: AgentCompanionOptions) {
    this.bubbleEl = opts.bubbleEl;
    this.getTarget = opts.getTarget;
    this.is3DTarget = opts.is3DTarget;
    this.allowSound = opts.allowSound;
  }

  public setPrivacyMode(active: boolean): void {
    const next = Boolean(active);
    if (this.privacyPaused === next) return;
    this.privacyPaused = next;
    if (this.privacyPaused) {
      this.releaseAllVirtualKeys();
      // Hide stack visually during password entry without wiping active session state (#128)
      this.bubbleEl?.classList.add('hidden');
    } else {
      if (this.bubbles.size > 0) {
        this.bubbleEl?.classList.remove('hidden');
      }
      this.syncTyping();
    }
  }

  /** Pause synthetic coding keystrokes briefly so the user's real keyboard/mouse always wins. */
  public notifyRealUserInput(): void {
    if (!this.autoTyping) return;
    // Slightly longer than 2D's 2200ms mouse hold so user mouse/keyboard input never fights auto-typing (#128)
    this.realUserInputUntil = performance.now() + 2400;
    this.releaseAllVirtualKeys();
  }

  public handleEvent(ev: AgentCompanionEvent): void {
    if (!ev || typeof ev !== 'object') return;

    const sessionKey = (ev.session || ev.source || 'AI').trim() || 'AI';
    const displayLabel = resolveDisplayLabel(ev.session, ev.source, sessionKey);
    const nowPerf = performance.now();

    // Out-of-order protection (#128): drop older hook events delivered out-of-sequence by parallel processes
    let guard = this.sessionGuards.get(sessionKey);
    if (!guard) {
      guard = { lastTs: 0, doneAt: 0 };
      this.sessionGuards.set(sessionKey, guard);
      if (this.sessionGuards.size > 64) {
        const oldestKey = this.sessionGuards.keys().next().value as string | undefined;
        if (oldestKey && oldestKey !== sessionKey && !this.bubbles.has(oldestKey)) {
          this.sessionGuards.delete(oldestKey);
        }
      }
    }
    const evTs = typeof ev.ts === 'number' && Number.isFinite(ev.ts) ? ev.ts : 0;
    if (evTs > 0 && guard.lastTs > 0 && evTs < guard.lastTs) {
      return;
    }

    const rawStatus = ev.kind === 'status' ? (ev.status || 'idle').toLowerCase() : '';
    // Drop late-arriving tool working events that race behind Stop / turn-end (#128)
    if (
      ev.kind === 'status' &&
      rawStatus === 'working' &&
      Boolean(ev.tool) &&
      guard.doneAt > 0 &&
      nowPerf - guard.doneAt < 1500
    ) {
      return;
    }
    if (evTs > 0) {
      guard.lastTs = evTs;
    }

    const target = this.privacyPaused ? null : this.getTarget();
    const is3d = this.is3DTarget();
    const ttl = Math.max(1200, Math.min(300_000, ev.ttlMs ?? 6500));

    if (ev.kind === 'action' && ev.action) {
      this.activeStatus = 'idle';
      this.dispatchAction(ev.action, target, is3d);
      if (ev.text) {
        this.showBubble(sessionKey, displayLabel, ev.text, 'info', 'idle', false, ttl);
      }
      if (!this.privacyPaused && ev.sound && this.allowSound()) {
        this.playNoticeThrottled(ev.action === 'angry' ? 'error' : 'done');
      }
      this.syncTyping();
      return;
    }

    if (ev.kind === 'bubble') {
      if (ev.text) {
        const existing = this.bubbles.get(sessionKey);
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text,
          'info',
          existing?.status ?? 'idle',
          existing?.autoType ?? false,
          ttl,
        );
      } else {
        this.hideBubble(sessionKey);
      }
      this.syncTyping();
      return;
    }

    const status = (rawStatus || 'idle') as AgentStatusKind;
    this.activeStatus = status;

    switch (status) {
      case 'working': {
        guard.doneAt = 0;
        const wantAutoType = ev.autoType !== false;
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text || '写代码中…',
          'working',
          'working',
          wantAutoType,
          ev.ttlMs ?? 180_000,
        );
        break;
      }
      case 'thinking': {
        guard.doneAt = 0;
        const wantAutoType = Boolean(ev.autoType);
        target?.triggerCuriousDemo(is3d ? 2.6 : 2600);
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text || '思考中…',
          'thinking',
          'thinking',
          wantAutoType,
          ev.ttlMs ?? 180_000,
        );
        break;
      }
      case 'waiting': {
        guard.doneAt = 0;
        target?.triggerCuriousDemo(is3d ? 4.2 : 4200);
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text || '等你确认操作',
          'waiting',
          'waiting',
          false,
          ev.ttlMs ?? 180_000,
        );
        if (!this.privacyPaused && ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('waiting');
        }
        break;
      }
      case 'done': {
        guard.doneAt = nowPerf;
        if (target?.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        } else {
          target?.triggerCuriousDemo(is3d ? 2.2 : 2200);
        }
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text || '任务完成！',
          'done',
          'done',
          false,
          ev.ttlMs ?? 6_500,
        );
        if (!this.privacyPaused && ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('done');
        }
        break;
      }
      case 'error': {
        target?.triggerCrossDemo();
        this.showBubble(
          sessionKey,
          displayLabel,
          ev.text || '任务出错了',
          'error',
          'error',
          false,
          ev.ttlMs ?? 8_500,
        );
        if (!this.privacyPaused && ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('error');
        }
        break;
      }
      default: {
        guard.doneAt = nowPerf;
        if (ev.text) {
          this.showBubble(sessionKey, displayLabel, ev.text, 'info', 'idle', false, ev.ttlMs ?? 3_200);
        } else {
          this.hideBubble(sessionKey);
        }
        break;
      }
    }

    // Reconcile pet typing animation across all live sessions (OR logic)
    this.syncTyping();
  }

  private dispatchAction(
    action: string,
    target: AgentCompanionTarget | null,
    is3d: boolean,
  ): void {
    if (!target) return;
    switch (action.toLowerCase()) {
      case 'happy':
      case 'pet':
        if (target.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        } else {
          target.triggerCuriousDemo(is3d ? 2.4 : 2400);
        }
        break;
      case 'angry':
        target.triggerCrossDemo();
        break;
      case 'boop':
        target.triggerBoopDemo?.();
        break;
      case 'chin':
        if (target.triggerChinScratchDemo) {
          target.triggerChinScratchDemo(is3d ? 2.8 : 2800);
        } else if (target.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        }
        break;
      case 'dizzy':
        target.triggerDizzyDemo?.(is3d ? 3.8 : 3800);
        break;
      case 'curious':
        target.triggerCuriousDemo(is3d ? 3.5 : 3500);
        break;
      case 'sleep':
        target.triggerSleepDemo();
        break;
      case 'wake':
        if (target.triggerWakeDemo) {
          target.triggerWakeDemo();
        } else {
          target.triggerCuriousDemo(is3d ? 1.5 : 1500);
        }
        break;
      case 'tail_pat':
        if (target.triggerTailPatDemo) {
          target.triggerTailPatDemo();
        } else {
          target.onKeyDown(0x0d, false);
          window.setTimeout(() => target.onKeyUp(0x0d), 140);
        }
        break;
    }
  }

  private playNoticeThrottled(kind: 'done' | 'waiting' | 'error'): void {
    const now = performance.now();
    if (now - this.lastSoundAt < 1200) return;
    this.lastSoundAt = now;
    catAudio.playAgentNotice(kind);
  }

  private startAutoTyping(): void {
    if (this.autoTyping) return;
    this.autoTyping = true;
    this.burstRemaining = 5 + Math.floor(Math.random() * 7);
    this.scheduleNextVirtualKey(40);
  }

  private stopAutoTyping(): void {
    this.autoTyping = false;
    if (this.typeTimer !== null) {
      window.clearTimeout(this.typeTimer);
      this.typeTimer = null;
    }
    this.releaseAllVirtualKeys();
  }

  private releaseAllVirtualKeys(): void {
    for (const id of this.releaseTimers) {
      window.clearTimeout(id);
    }
    this.releaseTimers.clear();
    const target = this.getTarget();
    for (const vk of this.heldVirtualVks) {
      target?.onKeyUp(vk);
    }
    this.heldVirtualVks.clear();
  }

  private scheduleNextVirtualKey(delayMs: number): void {
    if (!this.autoTyping) return;
    if (this.typeTimer !== null) {
      window.clearTimeout(this.typeTimer);
    }
    this.typeTimer = window.setTimeout(() => {
      this.typeTimer = null;
      if (!this.autoTyping) return;

      const now = performance.now();
      if (this.privacyPaused || now < this.realUserInputUntil) {
        this.scheduleNextVirtualKey(260);
        return;
      }

      const target = this.getTarget();
      if (target) {
        const vk = CODING_VKS[Math.floor(Math.random() * CODING_VKS.length)];
        target.onKeyDown(vk, false);
        this.heldVirtualVks.add(vk);
        const holdMs = 55 + Math.floor(Math.random() * 55);
        const rid = window.setTimeout(() => {
          this.releaseTimers.delete(rid);
          if (this.heldVirtualVks.delete(vk)) {
            this.getTarget()?.onKeyUp(vk);
          }
        }, holdMs);
        this.releaseTimers.add(rid);
      }

      this.burstRemaining -= 1;
      if (this.burstRemaining <= 0) {
        this.burstRemaining = 5 + Math.floor(Math.random() * 8);
        this.scheduleNextVirtualKey(260 + Math.floor(Math.random() * 340));
      } else {
        this.scheduleNextVirtualKey(75 + Math.floor(Math.random() * 105));
      }
    }, delayMs);
  }

  /** Reconcile orphan DOM bubble nodes that are no longer tracked in `this.bubbles`. */
  private pruneOrphans(): void {
    const host = this.bubbleEl;
    if (!host) return;
    const live = new Set<HTMLElement>();
    for (const entry of this.bubbles.values()) live.add(entry.el);
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('.agent-bubble'))) {
      if (!live.has(el) && !el.classList.contains('leaving')) el.remove();
    }
  }

  private createBubbleEl(key: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'agent-bubble';
    el.dataset.tone = 'info';
    el.dataset.session = key;
    const text = document.createElement('span');
    text.className = 'agent-bubble-text';
    el.append(text);
    return el;
  }

  private enforceCap(keepKey: string): void {
    const max = AgentCompanionController.MAX_BUBBLES;
    while (this.bubbles.size > max) {
      const oldest = this.bubbles.keys().next().value as string | undefined;
      if (!oldest || oldest === keepKey) break;
      this.removeBubble(oldest, false);
    }
  }

  private armTtl(entry: SessionBubble, ms: number): void {
    if (entry.ttlTimer !== null) {
      window.clearTimeout(entry.ttlTimer);
      entry.ttlTimer = null;
    }
    const ttl = Math.max(600, Math.min(300_000, ms));
    entry.ttlTimer = window.setTimeout(() => {
      entry.ttlTimer = null;
      this.removeBubble(entry.key, true);
    }, ttl);
  }

  private showBubble(
    key: string,
    label: string,
    text: string,
    tone: BubbleTone,
    status: AgentStatusKind,
    autoType: boolean,
    ttlMs: number,
  ): void {
    const host = this.bubbleEl;
    if (!host) return;
    this.pruneOrphans();

    let entry = this.bubbles.get(key);
    if (entry) {
      entry.el.classList.remove('leaving');
    } else {
      const el = this.createBubbleEl(key);
      host.appendChild(el);
      entry = { el, key, label, tone, status, autoType, ttlTimer: null };
      this.bubbles.set(key, entry);
      this.enforceCap(key);
    }

    const icon =
      tone === 'working'
        ? '💻'
        : tone === 'thinking'
          ? '🧠'
          : tone === 'waiting'
            ? '⏳'
            : tone === 'done'
              ? '✅'
              : tone === 'error'
                ? '❌'
                : '🐾';
    const prefix = label && label !== 'AI' && label !== 'MCP' ? `${label} · ` : '';

    entry.label = label;
    entry.tone = tone;
    entry.status = status;
    entry.autoType = autoType;
    entry.el.dataset.tone = tone;
    const textEl = entry.el.querySelector('.agent-bubble-text') as HTMLSpanElement | null;
    if (textEl) textEl.textContent = `${icon} ${prefix}${text}`;

    if (!this.privacyPaused) {
      host.classList.remove('hidden');
    }
    this.armTtl(entry, ttlMs);
  }

  private removeBubble(key: string, animate: boolean): void {
    const entry = this.bubbles.get(key);
    if (!entry) return;
    if (entry.ttlTimer !== null) {
      window.clearTimeout(entry.ttlTimer);
      entry.ttlTimer = null;
    }
    this.bubbles.delete(key);
    const el = entry.el;
    if (animate) {
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 180);
    } else {
      el.remove();
    }
    if (this.bubbles.size === 0) {
      this.bubbleEl?.classList.add('hidden');
      this.activeStatus = 'idle';
    }
    this.syncTyping();
  }

  private hideBubble(key?: string): void {
    if (key) {
      this.removeBubble(key, true);
      return;
    }
    for (const k of [...this.bubbles.keys()]) {
      this.removeBubble(k, false);
    }
    this.bubbleEl?.classList.add('hidden');
  }

  /** OR logic across live sessions: keep typing animation active as long as any session wants it. */
  private syncTyping(): void {
    if (this.privacyPaused) {
      this.stopAutoTyping();
      return;
    }
    let anyAutoTyping = false;
    for (const b of this.bubbles.values()) {
      if (b.autoType && (b.status === 'working' || b.status === 'thinking')) {
        anyAutoTyping = true;
        break;
      }
    }
    if (anyAutoTyping) {
      this.startAutoTyping();
    } else {
      this.stopAutoTyping();
    }
  }

  public getStatus(): AgentStatusKind {
    for (const b of this.bubbles.values()) {
      if (b.status === 'working') return 'working';
    }
    for (const b of this.bubbles.values()) {
      if (b.status === 'waiting') return 'waiting';
    }
    for (const b of this.bubbles.values()) {
      if (b.status === 'thinking') return 'thinking';
    }
    return this.activeStatus;
  }

  public getActiveSessionCount(): number {
    return this.bubbles.size;
  }

  public dispose(): void {
    this.stopAutoTyping();
    this.hideBubble();
    this.sessionGuards.clear();
  }
}
