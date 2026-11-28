# Passive work companion (draft)

Enable **Work companion** in the desktop pet settings to observe local DSH and Codex sessions. The feature is off by default. No host plugin, hook, MCP registration, proxy, or prompt change is required. Existing keyboard input and explicit MCP/hook actions keep their existing behavior; explicit agent events take priority over the passive animation until their TTL expires.

## Display

- Only sessions with observed open-turn evidence are shown. Explicit finish/cancel/failure removes a session.
- Combined and stacked layouts show up to 1–6 sessions. Extra sessions rotate every four seconds.
- Minimal layout shows one single-line pill (tool, title, activity) and rotates all observed sessions. Detailed-layout preferences are preserved.
- Bubbles follow pet scale and opacity. Width, font and gap settings use the upstream default 100% pet scale as their reference. Screen space reduces the number of simultaneous rows.
- On macOS the overlay copies the pet's native level and Spaces behavior. This still needs full multi-display/fullscreen acceptance before leaving draft.
- Quiet open turns become **Waiting for an update** instead of disappearing, typing forever, or being marked successful. Recent tool categories and public progress messages are activity hints, not completion percentages.
- Optional foreground office-app matching is off by default; it matches exact app/executable identifiers, respects inactivity, and never reads document contents. Linux foreground-office detection is not implemented.

The existing settings and update system, product identity, network ports and model renderer are unchanged by this feature.

## Local data and privacy

Default roots are `~/.dsh/sessions` (DSH v4 Zstandard JSONL) and `~/.codex/sessions` (Codex JSONL). `DSH_HOME` and `CODEX_HOME` are respected when present in the app environment. GUI launches may not inherit shell environment variables; explicit absolute session-root overrides are available in settings. Codex titles can also come from the sibling `session_index.jsonl`.

Source files are opened read-only. The observer does not start, resume, repair or delete host sessions. It adds no network calls. Only bounded normalized state, titles and public progress snippets are checkpointed inside KuroCat's own data directory; raw transcripts, code/output, full tool arguments and hidden reasoning text are not persisted or displayed by the observer. New checkpoint/config files use mode 0600 on Unix. The UI inserts text with `textContent`.

Work-companion settings live in `companion.json`; cursors and normalized state live in `companion-cursors-v2.json`. Disabling the feature stops discovery and activity animation. Existing global keyboard animations still require the usual OS permissions; passive log observation does not grant or replace those permissions.

## Known limitations / draft acceptance

- Discovery currently selects the latest 32 files per tool (not the 1–6 display limit), with a 12,000-entry traversal budget. More concurrent files can evict an older long-running session.
- Host crashes with no end event can leave an observed session in Waiting for an update. This is not a process-liveness claim, and it does not accumulate work time.
- Codex approval/user-input states are not claimed to be exact. Tool errors are not automatically promoted to whole-turn failure. A normal turn end is not proof that the requested work succeeded.
- Source-format errors are isolated and reported. Partial lines/frames wait for more bytes; unsupported/corrupt/oversized input is not repaired.
- Remote sessions, all historical host versions, fork/subagent grouping, Windows/Linux runtime acceptance, and full macOS Spaces/mixed-DPI acceptance are not covered.
- English/Chinese copy is provided; some Japanese/Korean work-companion labels currently use English fallback text and need native-language review.

## Validation

```sh
npm ci
npm run build
node --experimental-strip-types --test validation/companion-model.test.mjs validation/companion-controller.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Node 22+ is needed for the TypeScript model tests. Controller regressions use the esbuild dependency already installed with Vite and fake timers; they do not inject real input or require audio devices. The Rust suite includes synthetic lifecycle, truncation/replacement, partial JSONL/Zstandard, checkpoint and bounded-reader tests. The `local_read_only_adapters` test is ignored in CI because it reads a developer's existing session files; run it explicitly only when appropriate. It prints aggregate counts, not transcript text.

See [adapter contribution guide](CONTRIBUTING-ADAPTERS.md) for new sources.
