# NetworkBase plugin for Claude Code

Adds the NetworkBase MCP server and a skill that teaches Claude Code the common requests (report §26.5, D15).

```
/plugin marketplace add NetWorkBase/claude-code-plugin
/plugin install networkbase@networkbase
```

Then in a project folder: `npx @networkbase/cli login` and `npx @networkbase/cli init <workspace>`.

## Publishing (owner)

This folder is the content of the public repository `NetWorkBase/claude-code-plugin`. Create that repository on GitHub, copy this folder's contents to its root, and push. The check workflow starts the MCP server and fails if a tool the skill names is missing.

The server is pinned to `@networkbase/cli@2`, so it starts working once CLI 2.0.0 is published.
