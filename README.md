# pi agent settings summary

Config dir for the pi coding agent (`~/.pi/agent`). Secrets, sessions, memory and logs are git-ignored (see `.gitignore`).

## `settings.json`
| Setting | Value |
|---|---|
| Provider / model | `github-copilot` / `claude-sonnet-5.5` |
| Thinking level | `medium` |
| Enabled models | `github-copilot/*`, `google/gemini-*` |
| Compaction | on, keepRecent 20000, reserve 16384 tokens |
| Retry | on, max 3 |
| Theme | `system` |
| Startup | quiet, clear on start, changelog collapsed |
| Install telemetry | off |
| Shell prefix | loads aliases from the zsh config |

### Packages
- `pi-powerline-footer` – footer/status bar
- `@xynogen/pix-optimizer` – token optimizer (see below)
- `git:tianrendong/pi-cp`
- `pi-markdown-preview` – markdown/PDF preview
- `pi-web-access` – web search/fetch
- `@gotgenes/pi-permission-system` – permission rules
- `pi-cache-optimizer` – prompt cache stats
- `@petechu/pi-extension-toggle`
- `pi-packages-manager`
- `pi-antigravity` – Google search/image tools
- `@heyhuynhgiabuu/pi-pretty` – output formatting

## Optimizer (`pix.json`, `optimizer.json`)
`caveman: full`, `rtk: on`, `ponytail: lite`. The `rtk` and `rg` binaries live in `bin/`.

## Permissions (`extensions/pi-permission-system/config.json`)
- Default: allow
- Paths: `*.env`, `*.env.*` denied; `*.env.example` allowed
- Bash: ask by default; `rm -rf *` denied; `sudo *` ask
- External directories: ask

## Local extensions (`extensions/`)
- `bash-guard` – prompts/blocks destructive bash and git commands (stricter in subagents)
- `browser` – Playwright headless Chromium for debugging live pages
- `web-fetch` – URL fetch tool
- `prompt-snippets` – toggleable prompt rules (`alt+s` or `/snippets`)
- `ask-user-question.ts`, `atuin.ts`, `session-manager.ts` – single-file extensions
- `interactive-subagents`, `observational-memory` – external repos (README pointers only)

## Skills (`skills/`)
- `analyze-sessions` – cost and prompt analysis of past sessions
- `web-debug` – debug frontends via `browser_*` tools

## Other
- `models-store.json`, `pi-cache-optimizer-stats.d/`, `pi-pretty/`, `pi-web-access/`, `extension-toggle/` – state/cache (not reviewed)
