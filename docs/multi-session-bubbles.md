# Multi-session status bubbles

> Rebased onto upstream `main` after the v5.1.3 release (Live chroma capture,
> security banner, website locales). Upstream did not touch `agentCompanion.ts`;
> the stack styles were re-applied on top of the new `#live-toolbar` block in
> `style.css` / `obs.html`.

KuroCat's AI-companion bubble used to be a **single** pill: every new status event overwrote the
previous one, and the newest event also owned the single TTL timer. That is fine for one agent
session, but it silently drops information as soon as two sessions run at the same time — the
bubble keeps flipping between them and you cannot tell which session just finished.

This change makes the bubble layer **per-session**: one bubble per session, stacked vertically,
each with its own status and its own TTL.

![Multi-session bubbles](assets/multi-session-bubbles.png)

*Real desktop capture: three concurrent agent sessions; the middle one just reported `done` and
only its bubble turned ✅, the other two keep showing 💻.*

## Behaviour

| Aspect | Single session (today) | Multiple sessions (this change) |
| --- | --- | --- |
| Bubbles on screen | 1 (overwritten) | one per session, stacked top → bottom (same pill rendering) |
| Status text | last event wins | each session keeps its own |
| `done` / `error` | hides the only bubble after TTL | marks **that** bubble ✅/❌, then fades only it out |
| Character animation | follows the last event | **OR logic**: while *any* session is `working`, the cat keeps the typing animation |
| Max bubbles | 1 | 4 (oldest evicted, so the screen stays readable) |
| Privacy mode / dispose | clears the bubble | clears every bubble |

Bubbles are ordered by the session's first appearance, so the layout does not jump while sessions
come and go.

## Session identity

The controller resolves a bubble key per event:

```ts
const sessionKey = (ev.session || ev.source || 'AI').trim() || 'AI';
```

* `session` — new optional field, for clients that can send a real session id.
* `source` — existing field; when it already carries a per-session label
  (for example `"DSH·audit"`), the feature works **without any Rust change**.
* `AI` — fallback, and it stays invisible in the bubble prefix so single-session payloads render
  exactly like before.

Because the resolution is a fallback chain, existing integrations (`{"status":"working"}`) keep
their current look, and clients that want isolation only need to send distinct `source` values
(or `session` once the native payload carries it).

## Payload examples

Two sessions working at the same time:

```jsonc
POST http://127.0.0.1:27420/hook
{"status":"working","source":"DSH·audit","text":"审计底稿生成中…"}
{"status":"working","source":"DSH·stamp","text":"批量盖章中…"}
```

The first one finishes — only its bubble turns ✅ and fades out, the second keeps typing:

```jsonc
{"status":"done","source":"DSH·audit","text":"任务完成！","ttlMs":3000}
```

## Implementation notes

* `AgentCompanionController` now owns`Map<string, SessionBubble>`; the map's insertion order is the
  visual order.
* `#agent-bubble` became a **stack container** (`.agent-bubble-stack`); the pills are child
  `.agent-bubble` elements whose content renders exactly like before (`icon + "<session> · " +
  text`), so the visual language is unchanged — only the stacking is new. Existing tone selectors
  (`[data-tone='working']` …) still apply.
* Each entry arms its own timer; removing one bubble never touches the others.
* `syncTyping()` is evaluated after every status transition and implements the OR logic, so the
  cat stops typing only when the last working session reports `done` / `error` / `idle`.
* `pruneOrphans()` reconciles the DOM against the live entries **by element identity** before every
  render. A key check is not enough: when an event for the same session arrives while the previous
  node is still fading out, two nodes can carry the same `data-session`, and the stale one would
  otherwise stay on screen forever (no owner, no TTL). This keeps the visible bubble count equal
  to the tracked session count at all times.
* `obs.html` mirrors the container styles so the OBS transparent source shows the same stack.
* `dev/multi-session-demo.html` is a browser-only harness (no Tauri, no Rust) that replays a
  two-session script and exposes `window.__demo.snapshot()` for automated checks:
  `npm run dev`, then open `/dev/multi-session-demo.html` (append `?hold=1` to freeze the
  "both working" state for a screenshot).

## Testing

```bash
npm install
npx tsc --noEmit        # type check
npm run build           # production build (tsc + vite)
npm run dev             # then open /dev/multi-session-demo.html
```

The harness asserts the observable sequence:

| t | expected |
| --- | --- |
| 1.2 s | 2 bubbles (`DSH·audit` 💻, `DSH·stamp` 💻), keystrokes increasing |
| 5.2 s | audit bubble ✅, stamp still 💻, `getStatus() === 'working'` |
| 7.0 s | audit bubble removed, 1 bubble left |
| 10.5 s | no bubbles, `getActiveSessionCount() === 0`, keystrokes stopped |

`getActiveSessionCount()` was added for these checks.

## Edge cases covered

| Case | Behaviour |
| --- | --- |
| Same session reports twice quickly | one bubble, text/tone replaced, TTL re-armed |
| Event arrives during the 180 ms fade-out | old node removed by its timer, new node takes over, no duplicate left behind |
| Session goes `idle` with no text | that bubble is removed, others untouched |
| More than 4 sessions | oldest bubble evicted, so the stack never covers the desktop |
| Privacy mode / dispose | every bubble and timer cleared |
| Missing `session` and `source` | falls back to the `AI` key, prefix hidden, looks exactly like today |
| Unknown session id | label falls back to `会话:<id>` so a raw `session-…` string never shows |

## Compatibility

* No Rust change is required for the stack to work: `source` already travels through
  `AgentCompanionEvent`. A follow-up can add a `session` field to the native payload
  (`src-tauri/src/mcp.rs`) to let hook scripts send explicit session ids instead of overloading
  `source`.
* Single-session clients see no visual difference apart from the container element.
