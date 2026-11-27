import { catAudio } from './audio';

export type AgentStatusKind = 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'idle';
export type AgentActionKind =
  | 'happy'
  | 'pet'
  | 'angry'
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
   * 会话标识（可选）。多会话客户端（如同时跑多个 agent 会话）用它区分气泡。
   * 缺省时回退到 `source`，因此单会话客户端的行为保持不变。
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
  tone: BubbleTone;
  status: AgentStatusKind;
  ttlTimer: number | null;
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
  /** 每个会话一个气泡；key = session ?? source ?? 'AI'。Map 保持插入顺序 = 气泡上下顺序。 */
  private readonly bubbles = new Map<string, SessionBubble>();
  /** 屏幕上最多同时显示的气泡数，超出时淘汰最早的（避免遮住画面）。 */
  private static readonly MAX_BUBBLES = 4;
  private autoTyping = false;
  private realUserInputUntil = 0;
  private typeTimer: number | null = null;
  private releaseTimers = new Set<number>();
  private heldVirtualVks = new Set<number>();
  private ttlTimer: number | null = null;
  private burstRemaining = 0;
  private lastSoundAt = 0;

  constructor(opts: AgentCompanionOptions) {
    this.bubbleEl = opts.bubbleEl;
    this.getTarget = opts.getTarget;
    this.is3DTarget = opts.is3DTarget;
    this.allowSound = opts.allowSound;
  }

  public setPrivacyMode(active: boolean): void {
    this.privacyPaused = Boolean(active);
    if (this.privacyPaused) {
      this.releaseAllVirtualKeys();
      this.hideBubble();
    }
  }

  /** Pause synthetic coding keystrokes briefly so the user's real keyboard/mouse always wins. */
  public notifyRealUserInput(): void {
    if (!this.autoTyping) return;
    this.realUserInputUntil = performance.now() + 1800;
    this.releaseAllVirtualKeys();
  }

  public handleEvent(ev: AgentCompanionEvent): void {
    if (!ev || typeof ev !== 'object') return;
    if (this.privacyPaused) return;

    const target = this.getTarget();
    const is3d = this.is3DTarget();
    const ttl = Math.max(1200, Math.min(300_000, ev.ttlMs ?? 6500));
    // 会话标识：显式 session 优先，其次 source（单会话客户端行为不变）
    const sessionKey = (ev.session || ev.source || 'AI').trim() || 'AI';

    if (ev.kind === 'action' && ev.action) {
      this.stopAutoTyping();
      this.activeStatus = 'idle';
      this.dispatchAction(ev.action, target, is3d);
      if (ev.text) {
        this.showBubble(sessionKey, ev.text, 'info', ttl);
      }
      if (ev.sound && this.allowSound()) {
        this.playNoticeThrottled(ev.action === 'angry' ? 'error' : 'done');
      }
      return;
    }

    if (ev.kind === 'bubble') {
      if (ev.text) {
        this.showBubble(sessionKey, ev.text, 'info', ttl);
      } else {
        this.hideBubble(sessionKey);
      }
      return;
    }

    const status = (ev.status || 'idle').toLowerCase() as AgentStatusKind;
    this.activeStatus = status;

    switch (status) {
      case 'working': {
        if (ev.autoType !== false) {
          this.startAutoTyping();
        } else {
          this.stopAutoTyping();
        }
        this.showBubble(sessionKey, ev.text || '写代码中…', 'working', ev.ttlMs ?? 45_000);
        break;
      }
      case 'thinking': {
        if (ev.autoType) {
          this.startAutoTyping();
        } else {
          this.stopAutoTyping();
        }
        target?.triggerCuriousDemo(is3d ? 2.6 : 2600);
        this.showBubble(sessionKey, ev.text || '思考中…', 'thinking', ev.ttlMs ?? 35_000);
        break;
      }
      case 'waiting': {
        this.stopAutoTyping();
        target?.triggerCuriousDemo(is3d ? 4.2 : 4200);
        this.showBubble(sessionKey, ev.text || '等你确认操作', 'waiting', ev.ttlMs ?? 90_000);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('waiting');
        }
        break;
      }
      case 'done': {
        this.stopAutoTyping();
        if (target?.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        } else {
          target?.triggerCuriousDemo(is3d ? 2.2 : 2200);
        }
        this.showBubble(sessionKey, ev.text || '任务完成！', 'done', ev.ttlMs ?? 6_500);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('done');
        }
        break;
      }
      case 'error': {
        this.stopAutoTyping();
        target?.triggerCrossDemo();
        this.showBubble(sessionKey, ev.text || '任务出错了', 'error', ev.ttlMs ?? 8_500);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('error');
        }
        break;
      }
      default: {
        this.stopAutoTyping();
        if (ev.text) {
          this.showBubble(sessionKey, ev.text, 'info', ev.ttlMs ?? 3_200);
        } else {
          this.hideBubble(sessionKey);
        }
        break;
      }
    }
    // 所有会话状态落定后再统一决定动画，实现"任一在工作就打字"的或逻辑
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

  /**
   * 多条会话气泡的渲染层。
   *
   * 设计要点：
   * - 每个会话一个气泡元素，按首次出现的顺序从上到下排列（Map 的插入顺序）。
   * - 同一会话重复事件只更新自己那一条，不会覆盖别的会话。
   * - 每个气泡各自持有 TTL 定时器：done/error 到点淡出并移除，互不影响。
   * - 角色动画与气泡解耦：只要**任一**会话处于 working，就播放打字动画（或逻辑）。
   */
  /**
   * 清掉"孤儿"气泡元素：DOM 里存在但已不在 bubbles 表里的节点。
   * 这类节点一旦出现就永远不会被移除（没有 TTL、没有 key），会一直挂在猫头上。
   * 每次渲染前做一次廉价对账，保证屏幕上的气泡数 === 会话数。
   */
  private pruneOrphans(): void {
    const host = this.bubbleEl;
    if (!host) return;
    // 用「元素身份」对账，而不是 key：同一个 key 可能残留多个节点（旧节点淡出中又被重建），
    // 按 key 比对会把这些重复节点当成合法成员，永远留在屏幕上。
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

  /** 超过上限时淘汰最早创建的气泡，避免多会话把画面糊死。 */
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

  private showBubble(key: string, text: string, tone: BubbleTone, ttlMs: number): void {
    const host = this.bubbleEl;
    if (!host) return;
    this.pruneOrphans();

    let entry = this.bubbles.get(key);
    if (entry) {
      entry.el.classList.remove('leaving');
    } else {
      const el = this.createBubbleEl(key);
      host.appendChild(el);
      entry = { el, key, tone, status: 'idle', ttlTimer: null };
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
    // 与上游一致：只有非 AI / MCP 才显示前缀；前缀现在就是会话名
    const prefix = key && key !== 'AI' && key !== 'MCP' ? `${key} · ` : '';

    entry.tone = tone;
    entry.status = (
      tone === 'working' || tone === 'thinking' || tone === 'waiting' || tone === 'done' || tone === 'error'
        ? tone
        : 'idle'
    ) as AgentStatusKind;
    entry.el.dataset.tone = tone;
    const textEl = entry.el.querySelector('.agent-bubble-text') as HTMLSpanElement | null;
    if (textEl) textEl.textContent = `${icon} ${prefix}${text}`;

    host.classList.remove('hidden');
    this.armTtl(entry, ttlMs);
  }

  /** 移除某个会话的气泡（animate=true 时先播淡出动画）。 */
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
    }
  }

  /**
   * 清理气泡：给 key 就只清那一条，不给就清空全部（隐私模式/销毁时用）。
   */
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

  /**
   * 或逻辑：只要还有会话在 working，就让猫保持打字动画；全部收工才停。
   */
  private syncTyping(): void {
    let anyWorking = false;
    for (const b of this.bubbles.values()) {
      if (b.status === 'working') {
        anyWorking = true;
        break;
      }
    }
    if (anyWorking) {
      this.startAutoTyping();
    } else {
      this.stopAutoTyping();
    }
  }

  public getStatus(): AgentStatusKind {
    for (const b of this.bubbles.values()) {
      if (b.status === 'working') return 'working';
    }
    return this.activeStatus;
  }

  /** 当前正在跟踪的会话数（测试与调试用）。 */
  public getActiveSessionCount(): number {
    return this.bubbles.size;
  }

  public dispose(): void {
    this.stopAutoTyping();
    this.hideBubble();
  }
}
