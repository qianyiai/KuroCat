# Adding a passive work-companion adapter

Implement `PassiveAdapter` in `src-tauri/src/companion/adapters.rs` (or a separate module) and register it in `registry()`. The adapter is compiled into KuroCat; users install nothing into the observed tool.

| Method | Responsibility |
| --- | --- |
| `id`, `display_name` | Stable source ID and human-readable label |
| `default_root` | Local session root; honor the tool's data-home environment variable |
| `compressed` | Whether this source uses independent appended Zstandard frames |
| `matches` | Select supported session files without reading unrelated content |
| `fold` | Validate and map source events to an individual `Mapping` |
| `titles` | Optional bounded title-index reader |

`Mapping` carries session identity, current turn ID, ordering, activity/outcome, timestamps, title and bounded public progress. Bubble rendering and animation consume one normalized model. New adapter roots/disable flags use `adapterRoots` and `disabledAdapters`; direct controls are currently provided only for DSH/Codex.

## Required semantics

- Use source evidence for start/end/cancel. Reject stale end events from older turns and duplicate/out-of-order events. One session ending must not stop another.
- Unknown/stale is never success. `succeeded` means a normal turn end, not successful tests or completion of the user's goal.
- Display public commentary and tool categories only. Never expose hidden reasoning, code/output, secrets or full command arguments.
- Keep source files strictly read-only. Never change host configuration or install hooks as an automatic fallback.
- Preserve resource budgets and graceful degradation; process existence or file mtime alone is not evidence of ongoing work.

## Reader contract

The shared reader supports JSONL and independent Zstandard frames: at most 128 KiB of new source bytes per read, 64 MiB per frame, and 16 MiB per JSON line. The service handles at most 16 readers per 500 ms tick, rotates fairly, and discovers candidates every 10 seconds. Each source currently selects at most 32 recent files. Complete-boundary checkpoints are saved every 15 seconds; file identity, length and boundary fingerprints guard restart/replacement/truncation.

JSON snapshots and SQLite need a dedicated bounded read-only reader before they can fit this pipeline. Do not pretend that filling in a path makes an arbitrary tool compatible. Document whether discovery, titles, public progress, lifecycle and approval are actually supported.

## Contribution checklist

1. Synthetic fixtures/tests for lifecycle, duplicate/out-of-order events, multiple sessions and prior-turn completion.
2. Partial writes, replacement/truncation, checkpoints and resource limits for the reader.
3. At least one actual supported host version checked read-only; clearly separate parsing from real-time approval/latency verification.
4. Privacy tests proving that hidden reasoning and tool output never enter normalized display fields.
5. Document paths, format versions, platform limits and unknown states. No private transcripts in the repository.

Run the commands in [WORK-COMPANION.md](WORK-COMPANION.md). Existing MCP/hooks remain independent explicit controls and are not a prerequisite for passive observation.
