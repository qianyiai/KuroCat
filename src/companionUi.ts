import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t, setActiveLocale } from './i18n';
import { companionDefaults, demoSnapshot, visibleSessions, rotatingWindow, bubbleCapacity, type CompanionSettings, type CompanionSnapshot } from './companionModel';
import './companion.css';

const text = (key: string) => t(`companion.${key}`);
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = '') {
  const el = document.createElement(tag); el.className = className; el.textContent = value; return el;
}
export function statusLabel(activity: string, outcome: string | null) {
  return text(outcome ? `outcome_${outcome}` : `state_${activity}`);
}

const windows = new WeakMap<HTMLElement, { membership: string; since: number; signature: string }>();
export function renderBubbles(host: HTMLElement, snapshot: CompanionSnapshot) {
  setActiveLocale(snapshot.locale);
  const cfg = snapshot.settings; const rows = visibleSessions(snapshot);
  if (!cfg.enabled || snapshot.paused) { host.replaceChildren(); windows.delete(host); return; }
  if (snapshot.office) rows.push({ key: 'office', source: 'office', label: snapshot.office, project: '', activity: 'working', outcome: null, lastMs: 0, visible: true, fresh: true });
  const membership = rows.map(r => r.key).join('|');
  let state = windows.get(host);
  if (!state || state.membership !== membership) { state = { membership, since: state?.since ?? performance.now(), signature: '' }; windows.set(host, state); }
  const appearance = snapshot.appearance ?? { scale: 1, opacity: 1 };
  const nativeOverlay = host.id === 'companion-bubbles';
  const minimal = cfg.layout === 'minimal';
  const limit = minimal || nativeOverlay ? bubbleCapacity(cfg, snapshot.heightLimit) : cfg.maxSessions;
  const selected = rotatingWindow(rows, limit, performance.now() - state.since);
  const signature = JSON.stringify([selected.map(r => [r.key, r.label, r.project, r.activity, r.progress, r.stage]), cfg, appearance, limit, snapshot.locale, snapshot.moodLevel, Math.floor(snapshot.workSeconds / 60)]);
  if (signature === state.signature) return;
  const rotating = state.signature !== '' && rows.length > limit;
  state.signature = signature;
  host.replaceChildren(); host.dataset.layout = cfg.layout;
  host.style.fontSize = `${cfg.fontSize}px`; host.style.opacity = String(appearance.opacity);
  host.style.setProperty('zoom', String(appearance.scale));
  host.style.width = nativeOverlay ? '100%' : `${cfg.bubbleWidth}px`;
  if (nativeOverlay) document.body.style.padding = `${4 * appearance.scale}px`;
  host.style.maxWidth = `${cfg.bubbleWidth}px`;
  host.style.setProperty('--kuro-work-lines', String(cfg.lines));
  const card = cfg.layout === 'merged' ? element('div', 'kuro-work-bubble') : host;
  if (card !== host) host.append(card);
  for (const row of selected) {
    const item = element('div', minimal ? 'kuro-work-row kuro-work-bubble kuro-work-minimal' : cfg.layout === 'stacked' ? 'kuro-work-row kuro-work-bubble' : 'kuro-work-row');
    if (rotating) item.classList.add('kuro-work-roll-in');
    item.dataset.activity = row.activity;
    if (minimal) {
      const status = row.activity === 'working' && row.stage ? text(`stage_${row.stage}`) : statusLabel(row.activity, null);
      item.setAttribute('aria-label', `${row.source} · ${row.label || text('untitled')} · ${status}`);
      item.append(element('span', 'kuro-work-source-name', row.source === 'dsh' ? 'DSH' : row.source === 'codex' ? 'Codex' : row.source),
        element('strong', 'kuro-work-label', row.label || text('untitled')),
        element('span', 'kuro-work-state', status));
      card.append(item);
      continue;
    }
    const heading=element('div','kuro-work-row-heading');
    heading.append(element('span','kuro-work-source-name',row.source === 'dsh' ? 'DSH' : row.source === 'codex' ? 'Codex' : row.source), element('span','kuro-work-state',row.source === 'office' ? text('officeWorking') : statusLabel(row.activity,null)));
    item.append(heading, element('strong','kuro-work-label',row.label || text('untitled')));
    if (row.progress) item.append(element('span','kuro-work-progress',row.progress));
    if (row.stage) item.append(element('span','kuro-work-stage',text(`stage_${row.stage}`)));
    if (row.project && row.project !== row.label && cfg.showProjects) item.append(element('span','kuro-work-project',row.project));
    card.append(item);
  }
  if (!minimal && cfg.moodEnabled && snapshot.workSeconds > 0 && selected.length) {
    const footer = element('div', 'kuro-work-bubble-footer');
    footer.append(element('span', '', `${text(`mood_${snapshot.moodLevel}`)} · ${Math.floor(snapshot.workSeconds / 60)} ${text('minutes')}`));
    card.append(footer);
  }
}

export async function mountCompanionSettings(host: HTMLElement) {
  let cfg = { ...companionDefaults }; let current: CompanionSnapshot | null = null;
  let dirty = false; let saving = false;
  const controls = new Map<keyof CompanionSettings, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  host.replaceChildren();
  const intro = element('section', 'menu-card kuro-work-intro');
  const translated = <K extends keyof HTMLElementTagNameMap>(tag: K, key: string, className = '') => { const node = element(tag, className, text(key)); node.dataset.i18n = `companion.${key}`; return node; };
  intro.append(translated('h2', 'title'), translated('p', 'intro', 'kuro-work-muted'));
  host.append(intro);
  const sources = element('div', 'kuro-work-sources'); intro.append(sources);
  const form = element('form', 'kuro-work-form'); host.append(form);
  function group(title: string) { const section = element('section', 'menu-card kuro-work-section'); section.append(translated('h3', title)); form.append(section); return section; }
  function field(parent: HTMLElement, key: keyof CompanionSettings, title: string, kind: string, min?: number, max?: number, options?: string[]) {
    const row = element('label', `kuro-work-field ${kind === 'checkbox' ? 'kuro-work-switch' : ''} ${kind === 'text' || kind === 'textarea' ? 'kuro-work-field-vertical' : ''}`);
    const label = translated('span', title); row.append(label);
    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (kind === 'select') { const select = element('select'); for (const value of options || []) { const option = translated('option', value); option.value = value; select.append(option); } control = select; }
    else if (kind === 'textarea') { const area = element('textarea'); area.rows = 5; control = area; }
    else { const input = element('input'); input.type = kind; if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); control = input; }
    control.name = key; control.id = `kuro-work-${key}`; label.id = `kuro-work-label-${key}`; control.setAttribute('aria-labelledby', label.id);
    control.addEventListener('input', () => { dirty = true; message.textContent = text('unsaved'); });
    controls.set(key, control); row.append(control); parent.append(row);
  }
  const integration = group('integration');
  field(integration, 'enabled', 'enabled', 'checkbox'); field(integration, 'dshEnabled', 'dshEnabled', 'checkbox'); field(integration, 'codexEnabled', 'codexEnabled', 'checkbox');
  integration.append(translated('p', 'limitations', 'kuro-work-muted'));
  const advanced = element('details', 'kuro-work-advanced'); advanced.append(translated('summary', 'directories')); integration.append(advanced);
  field(advanced, 'dshRoot', 'dshRoot', 'text'); field(advanced, 'codexRoot', 'codexRoot', 'text');
  advanced.append(translated('p', 'directoryHint', 'kuro-work-muted'));
  field(advanced, 'staleSeconds', 'staleSeconds', 'number', 30, 1800);
  const bubbles = group('bubbles');
  field(bubbles, 'layout', 'layout', 'select', undefined, undefined, ['merged', 'stacked', 'minimal']);
  field(bubbles, 'maxSessions', 'maxSessions', 'number', 1, 6); field(bubbles, 'lines', 'lines', 'number', 1, 4);
  field(bubbles, 'bubbleWidth', 'bubbleWidth', 'number', 180, 360);
  bubbles.append(translated('p', 'rotationHint', 'kuro-work-muted'), translated('p', 'minimalHint', 'kuro-work-muted'));
  field(bubbles, 'fontSize', 'fontSize', 'number', 11, 20); field(bubbles, 'gap', 'gap', 'number', 0, 240);
  bubbles.append(translated('p', 'appearanceHint', 'kuro-work-muted'));
  field(bubbles, 'showProjects', 'showProjects', 'checkbox');
  const office = group('office'); field(office, 'officeEnabled', 'officeEnabled', 'checkbox');
  field(office, 'officeApps', 'officeApps', 'textarea'); office.append(translated('p', 'officeHint', 'kuro-work-muted'));
  field(office, 'idleSeconds', 'idleSeconds', 'number', 30, 1800);
  const mood = group('mood'); field(mood, 'moodEnabled', 'moodEnabled', 'checkbox'); field(mood, 'moodMinutes', 'moodMinutes', 'number', 1, 180);
  mood.append(translated('p', 'moodHint', 'kuro-work-muted'));
  const preview = group('preview'); const previewHost = element('div', 'kuro-work-preview'); preview.append(previewHost);
  const actions = element('div', 'kuro-work-actions'); const message = element('span', 'kuro-work-feedback'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const save = translated('button', 'save', 'kuro-work-save'); save.type = 'submit';
  const reset = translated('button', 'reset', 'kuro-work-reset'); reset.type = 'button';
  actions.append(message, reset, save); form.append(actions);
  function fill() { for (const [key, el] of controls) { if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(cfg[key]); else el.value = String(cfg[key]); } }
  function read(): CompanionSettings {
    const next = { ...cfg };
    for (const [key, el] of controls) {
      const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : typeof cfg[key] === 'number' ? Number(el.value) : el.value;
      (next as unknown as Record<string, unknown>)[key] = value;
    } return next;
  }
  function updatePreview() { const minimal = controls.get('layout')?.value === 'minimal'; for (const key of ['maxSessions', 'lines', 'showProjects'] as const) { const control = controls.get(key); if (control) control.disabled = minimal; } const demo = demoSnapshot(); demo.settings = read(); demo.locale = document.documentElement.lang || 'zh-CN'; demo.appearance = current?.appearance; renderBubbles(previewHost, demo); }
  form.addEventListener('input', updatePreview); form.addEventListener('change', updatePreview);
  function update(snapshot: CompanionSnapshot) {
    current = snapshot;
    if (!dirty && !saving) { cfg = snapshot.settings; fill(); }
    updatePreview();
    sources.replaceChildren();
    for (const source of snapshot.sources) {
      const item = element('div', 'kuro-work-source'); item.dataset.health = source.status;
      item.append(element('strong', '', source.name), element('span', '', text(`health_${source.status}`)));
      sources.append(item);
    }

  }
  reset.addEventListener('click', () => { cfg = { ...companionDefaults }; dirty = true; fill(); updatePreview(); message.textContent = text('unsaved'); });
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!form.reportValidity() || saving) return;
    saving = true; save.disabled = true; message.textContent = text('saving');
    try {
      const value = read(); cfg = isTauri() ? await invoke<CompanionSettings>('save_companion_settings', { settings: value }) : value;
      dirty = false; fill(); message.textContent = isTauri() ? text('saved') : text('demoOnly');
    } catch (error) { message.textContent = `${text('saveFailed')} ${String(error)}`; }
    finally { saving = false; save.disabled = false; }
  });
  fill(); updatePreview();
  if (isTauri()) {
    // Subscribe before loading the baseline; timestamps prevent a stale response overwriting live state.
    const accept = (s: CompanionSnapshot) => { if (!current || s.updatedMs >= current.updatedMs) update(s); };
    await listen<CompanionSnapshot>('kuro-work-companion', e => accept(e.payload));
    accept(await invoke<CompanionSnapshot>('get_companion_snapshot'));
  } else { update(demoSnapshot()); message.textContent = text('demoOnly'); }
}
