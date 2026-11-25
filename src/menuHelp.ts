import { t } from './i18n';

export type MenuHelpKey = 'hover-hide' | 'toggle-lock';

export interface MenuHelpController {
  hide(): void;
  refresh(): void;
}

interface MenuHelpSetup {
  platformKey: 'Alt' | 'Option';
  tooltipId?: string;
}

const buildHints = (platformKey: 'Alt' | 'Option'): Record<MenuHelpKey, string> => {
  const mac = platformKey === 'Option';
  return {
    'hover-hide': t('menu.hover_hide_help', { key: platformKey }),
    'toggle-lock': t(mac ? 'menu.lock_help_macos' : 'menu.lock_help_windows', { key: platformKey }),
  };
};

const TRIGGER_SELECTOR = '.menu-help-btn[data-help]';
const TRIGGER_CLASS = 'menu-help-btn';
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;

// A tooltip rendered in <body> with position:fixed escapes the menu's scroll container,
// so it is never clipped by the small side-menu OS window or the inline fallback menu.
export function setupMenuHelp({ platformKey, tooltipId = 'menu-help-tooltip' }: MenuHelpSetup): MenuHelpController {
  let hints = buildHints(platformKey);
  const tooltipEl = document.getElementById(tooltipId) as HTMLDivElement | null;

  const hide = (): void => {
    if (tooltipEl) {
      tooltipEl.classList.add('hidden');
    }
  };

  const applyLabels = (): void => {
    document.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR).forEach((trigger) => {
      const key = trigger.dataset.help as MenuHelpKey | undefined;
      if (key && hints[key]) {
        trigger.setAttribute('aria-label', hints[key]);
      }
    });
  };

  const positionTooltip = (trigger: HTMLElement): void => {
    if (!tooltipEl) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tipW = tooltipEl.offsetWidth;
    const tipH = tooltipEl.offsetHeight;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - tipW - VIEWPORT_MARGIN);
    let left = triggerRect.left + triggerRect.width / 2 - tipW / 2;
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft);
    let top = triggerRect.bottom + TRIGGER_GAP;
    if (top + tipH + VIEWPORT_MARGIN > window.innerHeight) {
      const above = triggerRect.top - TRIGGER_GAP - tipH;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - tipH - VIEWPORT_MARGIN);
    }
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  };

  const show = (trigger: HTMLElement): void => {
    const key = trigger.dataset.help as MenuHelpKey | undefined;
    if (!tooltipEl || !key || !hints[key]) return;
    tooltipEl.textContent = hints[key];
    tooltipEl.classList.remove('hidden');
    // Measure only after the element is rendered (it starts display:none).
    tooltipEl.style.visibility = 'hidden';
    positionTooltip(trigger);
    tooltipEl.style.visibility = '';
  };

  document.querySelectorAll<HTMLElement>(TRIGGER_SELECTOR).forEach((trigger) => {
    trigger.addEventListener('pointerenter', () => show(trigger));
    trigger.addEventListener('pointerover', () => show(trigger));
    trigger.addEventListener('pointerleave', hide);
    trigger.addEventListener('pointerout', hide);
    trigger.addEventListener('focusin', () => show(trigger));
    trigger.addEventListener('focusout', hide);
  });
  applyLabels();

  // Capture phase keeps the help control from ever toggling the row's setting or closing the menu.
  document.addEventListener(
    'click',
    (e) => {
      const trigger = (e.target as Element | null)?.closest<HTMLElement>(`.${TRIGGER_CLASS}`);
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      show(trigger);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      const trigger = (e.target as Element | null)?.closest<HTMLElement>(`.${TRIGGER_CLASS}`);
      if (!trigger) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        show(trigger);
      }
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  return {
    hide,
    refresh: () => {
      hide();
      hints = buildHints(platformKey);
      applyLabels();
    },
  };
}
