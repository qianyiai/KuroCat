interface DeskOptions {
  keyboardLayout: string;
  whiteKeyboard?: boolean;
  trackpadEnabled?: boolean;
}

export function syncDeskOptions(settings: DeskOptions, mac: boolean, unavailable: boolean): void {
  const white = settings.whiteKeyboard === true;
  const trackpad = settings.trackpadEnabled === true;
  document.querySelectorAll('[data-mac-finish]').forEach((el) => {
    el.classList.toggle('hidden', settings.keyboardLayout !== 'macbook');
  });
  document.querySelectorAll('[data-pad-options]').forEach((el) => {
    el.classList.toggle('hidden', !mac);
  });
  document.querySelectorAll('[data-pad-error]').forEach((el) => {
    el.classList.toggle('hidden', !mac || !trackpad || !unavailable);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-finish], [data-pointer]')) {
    const active =
      button.dataset.finish !== undefined
        ? button.dataset.finish === (white ? 'white' : 'black')
        : button.dataset.pointer === (trackpad ? 'trackpad' : 'mouse');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
