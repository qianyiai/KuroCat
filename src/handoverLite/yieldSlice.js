// Yields back to the browser event loop / compositor without suffering
// WKWebView / Safari unfocused `setTimeout(0)` 4ms–16ms timer clamping.
let channel;
const queue = [];

function ensureChannel() {
  if (channel || typeof MessageChannel === 'undefined') return channel;
  channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const next = queue.shift();
    if (next) next();
  };
  return channel;
}

export function yieldSlice() {
  const ch = ensureChannel();
  if (!ch) {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  return new Promise(resolve => {
    queue.push(resolve);
    ch.port2.postMessage(null);
  });
}
