/**
 * 多会话气泡的可视化冒烟测试（浏览器里跑，不需要 Tauri/Rust）。
 *
 * 场景：
 *   1) 会话「DSH·审计」开始工作  → 出现第 1 个气泡（💻）
 *   2) 会话「DSH·盖章」也开始工作 → 出现第 2 个气泡，两气泡上下排列
 *   3) 会话「DSH·审计」完成      → 第 1 个气泡变 ✅，随后淡出移除
 *   4) 会话「DSH·盖章」完成      → 第 2 个气泡变 ✅，随后淡出移除
 *
 * 同时把「打字动画是否在跑」打印出来，验证或逻辑（任一 working 即打字）。
 */
import { AgentCompanionController } from '../src/agentCompanion';

const stackEl = document.getElementById('agent-bubble') as HTMLDivElement;
const statEl = document.getElementById('stat') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;

let keyDowns = 0;
let typingNow = false;

const controller = new AgentCompanionController({
  bubbleEl: stackEl,
  // 用一个假的"猫"来观测打字动画：onKeyDown 被调用 = 猫在敲键盘
  getTarget: () => ({
    onKeyDown: () => {
      keyDowns += 1;
      typingNow = true;
    },
    onKeyUp: () => {},
    triggerCuriousDemo: () => {},
    triggerCrossDemo: () => {},
    triggerSleepDemo: () => {},
    triggerHappyDemo: () => {},
    triggerWakeDemo: () => {},
    triggerTailPatDemo: () => {},
  }),
  is3DTarget: () => false,
  allowSound: () => false,
});

function log(msg: string) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
}

function renderStat() {
  const n = controller.getActiveSessionCount();
  const status = controller.getStatus();
  statEl.textContent = `sessions: ${n} · status: ${status} · keystrokes: ${keyDowns}`;
}

setInterval(() => {
  // typing 状态：1 秒内没有新的按键就认为停了
  if (typingNow && keyDowns === 0) typingNow = false;
  renderStat();
}, 400);

// ?hold=1 → 只跑到"两个会话都在 working"，方便截图/人工观察
const hold = new URLSearchParams(location.search).has('hold');

const t0 = performance.now();
const at = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

// —— 剧本 ——
at(400, () => {
  log('会话 A（DSH·审计）working');
  controller.handleEvent({ kind: 'status', status: 'working', source: 'DSH·审计', text: '审计底稿生成中…' });
});
at(2200, () => {
  log('会话 B（DSH·盖章）working');
  controller.handleEvent({ kind: 'status', status: 'working', source: 'DSH·盖章', text: '批量盖章中…' });
});
at(6000, () => {
  if (hold) return;
  log('会话 A done');
  controller.handleEvent({ kind: 'status', status: 'done', source: 'DSH·审计', text: '任务完成！', ttlMs: 3000 });
});
at(9500, () => {
  if (hold) return;
  log('会话 B done');
  controller.handleEvent({ kind: 'status', status: 'done', source: 'DSH·盖章', text: '任务完成！', ttlMs: 3000 });
});
at(14000, () => {
  log(`结束：剩余会话 ${controller.getActiveSessionCount()} 个，累计按键 ${keyDowns} 次`);
});

// 供自动化脚本读取
(window as unknown as Record<string, unknown>).__demo = {
  controller,
  snapshot: () => ({
    sessions: controller.getActiveSessionCount(),
    status: controller.getStatus(),
    keystrokes: keyDowns,
    elapsedMs: Math.round(performance.now() - t0),
    bubbles: [...stackEl.querySelectorAll('.agent-bubble')].map((el) => ({
      session: (el.querySelector('.agent-bubble-session') as HTMLElement | null)?.textContent ?? '',
      text: (el.querySelector('.agent-bubble-text') as HTMLElement | null)?.textContent ?? '',
      tone: (el as HTMLElement).dataset.tone ?? '',
      leaving: el.classList.contains('leaving'),
    })),
  }),
};
