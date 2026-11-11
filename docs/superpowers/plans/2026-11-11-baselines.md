# Baselines before the next round (M0, 2026-11-11)

Measured on local `main` at `70a6ab3c0` (CLI 2.0.3 code), macOS, Node 22.

| What | Now | Budget | Note |
|---|---|---|---|
| CLI unpacked size | 365,412 bytes | 409,600 | Parts C, D, G and H add the QR encoder, `merge3`, `nb ui` and about 40 commands; the budget is raised **per milestone, by the measured amount**, recorded here, never silently |
| `nb --version` | 78 ms | 120 ms | |
| `nb help` | 81 ms | 200 ms | |
| MCP tools at session start | 34 tools, ~27,000 characters (~6,700 tokens) | 4,000 tokens (D14) | measured 2026-11-11 |
| Agent test (56 requests, Claude Code) | 52/56 (93%) | 90% | 2026-11-10 |

Each milestone appends its "after" numbers below.
