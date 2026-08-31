# dsh-perf

English | [中文](README.zh.md)

Performance observability and governance plugin for DSH Web: streaming and multi-session workloads.

## What it does

Everything lives in the plugin (no core fork, no runtime tricks), in three layers:

1. **Observe**: host `PerfMeter` subscribes to the cordis `session/event` bus (event rate per session / total / type distribution), the `agent/status` migration stream (idle/running timeline), event-loop delay (`perf_hooks`) and memory; a loopback-fenced `GET /api/dsh-perf/stats` exposes aggregates; the browser HUD panel (off by default) shows server metrics plus local FPS / Longtask sampling.
2. **Govern**: `cordis.patch.yml` declares the write-batch delay of `session-persistence-jsonl` (200ms -> 500ms, ~2.5x fewer fsync batches while streaming); `mode: off | balanced | aggressive` and alert presets (light / standard / strict) hot-swap via Settings.
3. **Down-load and forensics**: a session-list store publish gate merges streaming-time "projection-identity-only" flushes (usage/token counters) into a ~1Hz trailing publish while visible-field changes still publish immediately (a 30s window of 30 needless full-tree re-renders became 3); `content-visibility:auto` on message rows approximates virtualization and works on its own even with the HUD off (sidebar session rows rendered by dsh-better-sidebar are deliberately left alone - the fixed 32px placeholder height pinned rows in place and fought the plugin's own layout, so that rule was removed); a session-tail integrity observer watches turn-end edges in the running GUI, cross-checking the final message `finalNode`, the window tail against the host `history` tail seq, and editor residue (the busy-state Stop click keeps the draft), writing findings to a localStorage ring buffer plus console.warn - evidence for "finished but the tail is not shown" cases; agent idle badges.

## Install

In your profile (e.g. `~/.dsh/profiles/web`):

```bash
pnpm add @linxin666/dsh-perf
```

and insert into `cordis.patch.yml` (or use the bundle patch):

```yaml
- insert:
    - id: dsh-perf
      name: '@linxin666/dsh-perf'
      config:
        enabled: true
        mode: balanced
        meterIntervalMs: 2000
        statsWindowSeconds: 120
        alertPreset: standard
        hudEnabled: false
        renderDegrade: true
```

Restart `dsh web` (Web mode does not enable HMR at load time) for the host half; the client half applies on refresh. Enable the HUD panel and toggles from `Settings -> Web Plugins -> Performance Engine`.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch; off = host stops subscribing/sampling, HUD hidden, CSS degrade off |
| `mode` | `balanced` | `off` / `balanced` / `aggressive` |
| `meterIntervalMs` | `2000` | Sampling period (1s-60s, hot-swappable) |
| `statsWindowSeconds` | `120` | Rate window (10s-1h) |
| `alertPreset` | `standard` | `light` (10 sessions / 1000 ev/s) `standard` (5 / 300) `strict` (3 / 150) |
| `hudEnabled` | `false` | HUD panel (browser) |
| `renderDegrade` | `true` | Render down-load (list publish gate; message rows keep `content-visibility:auto`) |

## HUD / panel

- Server side: events/s, active sessions, event-loop p99/mean latency, RSS/Heap, applied write-batch delay (read from the live persistence service).
- Browser: FPS (last 1s), Longtask (last 60s with worst duration), and a per-plugin activity scoreboard - added-node rates attributed to each `data-dsh-plugin` root (top 3 + rest), so a plugin that chews the main thread without emitting semantic attributes shows up under `rest=` instead of invisibly; nodes beyond the per-callback budget share that bucket; `dsh-perf-debug=1` exposes a `window.__dshPerfAttribution` handle (raw snapshots, long-task log, top sources); × collapses the panel to a small tab (click to expand).
- The host endpoint auto-hides the HUD after 3 consecutive failures (silent degradation when the host half is absent).
- Idle agents get a `·idle` badge on their session row (from `agent/status` migration events, zero upstream changes).

## Boundaries / upstream

- `/api/dsh-perf/stats` serves aggregates only (no session content); loopback guard from shared/host/loopback.ts (same-origin + 127/8 + sec-fetch markers).
- Emission-side aggregation and push-frame batching live in core (agent-loop / client-runtime), deliberately outside the plugin scope; measured evidence is in docs/dsh-perf-optimization-report.md (internal research, not upstream PRs).
