# Pi Session Sidebar

A pinned session picker on the right side of [Pi](https://pi.dev). The chat, prompt editor, and footer keep their own column, rather than being covered by an overlay.

**Experimental: requires the included Pi 1.0.0 core patch. This is not a drop-in pinned sidebar for stock Pi.** Setup creates a separate source checkout; it does not replace your existing `pi` installation.

```text
Pi conversation                         │ Sessions
                                        │ Current project
Transcript keeps its own scroll area    │ > Search sessions…
                                        │
                                        │ › ● Fix auth redirect
                                        │     my-project · 8m ago
Prompt editor                           │
Pi footer                               │ Enter open · Esc back
```

## Install

Requires macOS or Linux, Node.js 22.19.0 or newer, pnpm 10, Git, npm, and tar. tmux is only needed for terminal tests.

```sh
git clone https://github.com/abyigiter/pi-session-sidebar.git
cd pi-session-sidebar
pnpm install --frozen-lockfile --ignore-scripts
pnpm setup:core
pnpm install:local
```

The installer links `pi-session-sidebar` into `~/.local/bin` and refuses to overwrite an unrelated existing command. Keep the checkout: the command points to its launcher and picks up changes from it.

If `~/.local/bin` is not on your PATH, add this to your shell configuration:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Start it from the project you want to work in:

```sh
cd /path/to/your/project
pi-session-sidebar
```

The launcher preserves your working directory and forwards CLI arguments to the patched Pi. It uses your normal Pi configuration, credentials, themes, extensions, and session storage. The standard `pi` command stays unchanged; no global extension is added to stock Pi.

Without installing a command, run `node /path/to/pi-session-sidebar/scripts/pi.mjs` from your project, or `pnpm pi` from this checkout.

## Controls

| Action | Result |
| --- | --- |
| `Ctrl+O` while the sidebar is mounted | Move focus between the editor and sidebar |
| `Ctrl+Shift+S` or `/sessions` | Show/focus the sidebar, or return to the editor if already focused |
| Type in sidebar search | Match session names, first prompts, and project paths |
| `Up` / `Down`, `PageUp` / `PageDown` | Navigate results |
| `Tab` in the sidebar | Switch current-project/all-project scope |
| `Enter` in the sidebar | Resume the selected session |
| `Escape` in the sidebar | Return to the editor without hiding the sidebar |
| `/sessions toggle` | Hide/show the sidebar and reclaim/reserve its width |

Sessions are ordered by recent activity. The active session is marked with `●`. Switching is blocked while the agent is busy or has queued messages; a non-empty text draft requires confirmation. Existing modal dialogs retain focus priority. Rename and delete remain available through Pi's built-in `/resume` picker.

The sidebar reserves 42 columns in fullscreen mode. It collapses below 102 terminal columns or 12 rows and returns focus to the editor if necessary. It does not draw a pinned panel in regular, RPC, JSON, or print mode.

## Core patch and configuration

`pnpm setup:core` clones Pi v1.0.0 at commit `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, applies `patches/pi-1.0.0-sidebar.patch`, and installs dependencies with lifecycle scripts disabled. Model data comes from the matching published Pi AI 1.0.0 package, not live provider catalogs. No build is required to run the source launcher.

The patch adds a fullscreen sidebar hook and keyboard-focus handling while keeping Pi's existing chat viewport. It has not been accepted upstream.

| Environment variable | Purpose |
| --- | --- |
| `PI_SIDEBAR_CORE` | Use a different core checkout instead of `.pi-core` under this repository |
| `PI_SIDEBAR_BIN_DIR` | Install the local command somewhere other than `~/.local/bin` |

A custom core checkout must be at the pinned revision. Setup refuses to apply the patch to a dirty, unpatched checkout. It recognizes an already-applied patch and can be rerun.

**Security:** Pi runs with your operating-system permissions; this patch does not add sandboxing. The pinned upstream source workspace audit reported one critical and three high production-dependency advisories during initial verification, including `shell-quote`, `brace-expansion`, and Gondolin's `node-forge` dependency. These are inherited from the upstream lockfile; their runtime reachability has not been established. Inspect the current report with:

```sh
cd .pi-core
npm audit --omit=dev
```

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:tui
```

Terminal tests require the patched core and tmux. They use an isolated Pi configuration, temporary sessions, and a local faux provider, without paid model calls. They cover search, draft protection, streaming and busy-switch guards, cross-project resume, resizing, reload, modal focus, and regular/fullscreen transitions. A paused-process resize check ensures tmux clipping is not mistaken for Pi having rendered the new layout and restored editor focus.

To exercise an installed launcher or a custom theme:

```sh
PI_SIDEBAR_TEST_LAUNCHER="$HOME/.local/bin/pi-session-sidebar" pnpm test:tui
PI_SIDEBAR_TEST_THEME=/path/to/theme.json pnpm test:tui
```

GitHub Actions also runs the patched core's checks and focused coding-agent/TUI tests. The extension is MIT licensed; the bundled patch includes Pi's license in `LICENSE.pi`.
