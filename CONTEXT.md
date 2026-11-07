# CONTEXT

## Project
- Name: AI Hub
- Path: `/Users/artemvolkovickij/ai-hub/`
- Stack: Node.js 24+ (ESM `node:sqlite`, pure Node.js, zero npm dependencies)
- Type: Local MCP bridge for Codex → GigaChat (external LLM)
- Configuration: `config.example.json` (pre-defined projects disabled by default)

## Current State
- Source files: `src/server.mjs`, `src/hub.mjs`, `src/gigachat.mjs`
- Tests: 3 test files in `test/*.test.mjs` (all use mock — real GigaChat NOT tested)
- MCP tools: `submit_task`, `project_stats`, `record_review`
- Safety: explicit user permission required before paid API calls

## Active Tasks
- (Not set — open a chat to define current tasks)

## Next Steps
- (Not set — open a chat to define next steps)

## Decisions Log
- 2026-11-07: Pure Node.js, zero dependencies, ECMAScript modules.
- 2026-11-07: CONTEXT.md protocol established for all projects.

## Risks / Blockers
- GigaChat connectivity not tested — tests use mock only.
-