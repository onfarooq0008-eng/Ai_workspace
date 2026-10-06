# AI Agent Platform — self-hosted multi-AI agent team

A web platform (built for a 1 GB Ubuntu VPS: Node.js + SQLite, no Docker/Redis, vanilla-JS frontend) where you configure
many AI API providers and a **Manager AI** plans work and delegates it to a team of **14 specialist worker roles** that
use real, sandboxed filesystem / terminal / git tools.

## Deploy
```bash
unzip ai-agent-platform.zip && cd ai-agent-platform
chmod +x install.sh update.sh scripts/backup.sh && ./install.sh
```
Then put Nginx + HTTPS in front (`deploy/nginx.conf.example`, `sudo certbot --nginx -d your-domain`). Service: `ai-agent`
(`systemctl status|restart ai-agent`, `journalctl -u ai-agent -f`). Re-running install/update never touches `data/`, `workspaces/` or `.env`.

## What's in the WebUI (everything is a real page wired to the backend)
| Page | What it does |
|---|---|
| **Chat** | Chat/Agent/Team/Developer/Research/Autonomous modes, project + Manager selectors, chat history & search, Stop / Resume, slash commands (`/model /agents /status /tasks /files /run /test /build /git /stop /resume /clear /reset /help`), inline approve / always-allow / deny cards, live tool & checkpoint feed, export conversation, dark/light |
| **Office View** | One desk per role (14 workers + Manager + Planner). Characters animate **only** when a real backend event arrives (working / thinking / error / waiting for approval); finished work flies as a 📄 to the Manager. Live event feed underneath. Idle = grayscale, nothing is scripted. Works across tabs/devices (global SSE stream) and re-syncs from a server snapshot after refresh |
| **Tasks** | Plan with dependencies, per-task cancel / retry, resume whole plan |
| **API Providers** | Add / edit / duplicate / enable / delete, Test Connection (auth, model, completion, latency, last error), discover models, capabilities, priority, rate limits & budgets, manual pricing, masked keys. Types: OpenAI-compatible, OpenRouter, Anthropic, Google Gemini, custom |
| **Agents** | Per-role model override, temperature, max tokens, extra instructions, enable/disable, tool list, effective model |
| **Projects / Files** | Project instructions & memory, delete, workspace browser + editor, upload (size-capped, executables refused), download project `.zip`, git checkpoints list, manual checkpoint, **restore** (safety checkpoint taken first), diff |
| **Activity** | Today / week / month usage, per provider / agent / project, 14-day chart, request log with request IDs, audit log |
| **Settings** | Default manager/worker, fallback order, load-balancing strategy, concurrency, retries, timeouts, approval requirement, token & cost budgets, log retention, upload limit, theme, language, search provider, API tokens, user preferences memory, password change, backups |

## The team (roles)
Manager, Planner, **Coder, Researcher, Reviewer, Tester, Security Reviewer, UI Designer, Documentation, Debugger, DevOps,
Database, API Designer, Performance, Accessibility, Localization**. Add a role by adding its name in
`orchestrator/jsonParsing.ts` (`ALL_WORKER_ROLES`) plus a prompt, tool list and meta entry.

## How a team run works
Planner → JSON task graph → dependency-aware scheduler (bounded concurrency, default 2) → each worker runs a real
tool-use loop (model → tools → results → model…) → on failure the real error goes to the **Debugger** whose diagnosis
is handed to the retry → cancelled/blocked tasks are marked, never silently skipped → final report (files changed,
tests, issues found/fixed, remaining, location, last checkpoint). Runs continue server-side if the browser closes.
Failover follows your fallback list; providers over their limits are skipped; budgets are enforced.

## Security model — read this
Enforced in the backend (not by prompts): login (bcrypt), persistent sessions, CSRF, rate limiting, Bearer API tokens,
AES-256-GCM encrypted keys (never returned or logged), secret redaction, path-traversal-proof file tools, per-project
workspaces, command blocklist + path guard (no absolute/`..`/`~`/`$(…)`/`.env` access), 4 permission tiers with human
approval for SENSITIVE actions, DANGEROUS commands blocked outright, audit log, `.env` root-owned so agent code cannot read it.

**Honest limit:** commands and code the agents run (e.g. `npm test` on code they just wrote) execute as the service
user. The guards above are defense in depth, not an OS sandbox. For untrusted workloads run the service on a dedicated
VPS/user, keep approvals on, and consider adding containers later (extension point: `tools/terminal.ts`).

## Testing status (be aware)
Built in a sandbox without network, so `npm install` / `tsc` never ran there. Verified by actually running: command
classification & path guard, filesystem sandbox, real shell execution & timeouts, real git, JSON parsers, load-balance,
limits and stage logic (58 tests, `npm test` after install). Every TS file is syntax-checked and every frontend file
parses, but **Express/SQLite/provider-HTTP/UI code has not been run end-to-end** — expect to fix small integration bugs on
first deploy. Run `npm test` and try a Team-mode task, then report what breaks.

## Not built (by design / future)
Browser automation (interface in `tools/browser.ts`), MCP, Telegram/Discord/Slack, PostgreSQL, local models. Full WebUI
translation: only the language setting is stored; UI text is English. Vision/image input to models is not wired.
