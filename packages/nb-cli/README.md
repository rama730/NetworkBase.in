# @networkbase/cli (`nb`)

The official command-line interface, local workspace mirror, Git credential helper, and Model Context Protocol (MCP) server for [NetworkBase](https://networkbase.in).

## Quick Start

Run instantly without global installation:

```bash
npx @networkbase/cli init
```

Or install globally:

```bash
npm install -g @networkbase/cli
nb init
```

## Key Capabilities

- **Interactive Command Palette & Auth:** 1-click browser PKCE authorization with arrow-key navigation, terminal fuzzy search, and automatic Personal Access Token (PAT) lifecycle.
- **Sub-Second Fast-Push (1-RTT):** SHA-256 deduplicated, parallelized pushes with `HTTP 304` ETag fast-path.
- **Local Mirror & Background Daemon:** Zero-prompt local mirror (`.networkbase/mirror/`) with background auto-sync (`nb watch --daemon-worker`) for seamless pair programming with Claude Code, Cursor, and Antigravity.
- **Task Intelligence & Context Engine:** Real-time task dashboard (`nb task`), task-number binding (`nb task work #4`), interactive subtask checklists (`nb task check`), and live zero-prompt task briefings (`.networkbase/tasks/TASKS.md`).
- **AI MCP Server:** Plug directly into Cursor, Claude Desktop, or Antigravity via `nb mcp` or stdio transport.

## Commands

```bash
# Setup & Authentication
nb init                     # Interactive setup & workspace linker
nb auth login               # Browser PKCE login or token login
nb auth status              # Check current user and linked workspace

# Workspaces & Tasks
nb workspace list           # List all accessible workspaces
nb task                     # View active tasks, subtasks & attached files
nb task 4                   # View complete briefing for task #4
nb task work 4              # Bind task #4 and auto-mirror its attached files
nb task check               # Interactive checklist to toggle subtasks

# Files & Sync
nb sync                     # Fast-path pull & push synchronization
nb push [file]              # Push changes with sub-second finalization
nb push [file] --deliverable # Push final deliverable and link to task
nb watch                    # Watch local mirror and auto-push changes

# AI Integrations
nb mcp                      # Start Model Context Protocol server
```

## Documentation

Full documentation is available at [networkbase.in](https://networkbase.in).
