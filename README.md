# Polenta

**System engineering made easy**

Polenta is a desktop ALM tool (think Polarion or DOORS) for system engeeniring.
Think to be inclusive for non technical person but respecting system engineering strictness. 
To reach this goal, a natural human expression is used instead of ML formalism. UI is designed to be intuitive.
A data model to manage Requirements, test cases, campaigns, reviews and
trace links is configurable to meet each team terminology & process needs. 
An MCP server gives AI agents such as Claude Code, Cursor and Codex the access to whole data model to allow assist redaction, mass import, coherence review...

> Status: early development (desktop `v0.0.7`). Expect breaking changes.

---

## Why Polenta

- **Git is the source of truth.** Every requirement is a readable, diffable YAML file.
  Branches, merges, tags and history come from git, not from a vendor database.
- **Works with AI from the start.** The data is plain text an agent can read directly,
  there is an MCP server, and the app generates `AGENTS.md` for the agent to follow.
- **Traceability you can check.** A coverage matrix, missing-link detection, impact
  analysis and a `needsRevalidation` flag when a linked item changes after approval.
- **Reusable components.** Share a spec (a BMS or a motor controller, say) across several
  products as a git repo, pinned to a baseline and read-only in the parent project.
- **No server.** The only backend is a git remote (GitHub, GitLab or self-hosted). Push
  and pull happen when you choose.

## Features

| Area | What you get |
|---|---|
| **Requirements** | Configurable object types per project, custom fields (text, rich text with images, enum, number, date, draw.io diagrams, links…), stable IDs (`SYS-0042`), integer versions with diffs, EARS syntax validation |
| **Tests** | Versioned test cases with ordered steps, preconditions and postconditions; campaigns and campaign runs; manual execution; JUnit XML / JSON result import |
| **Traceability** | Requirements × tests coverage matrix, orphan and uncovered item detection, impact analysis, test plan generation from a selection of requirements |
| **Collaboration** | Every change is made on its own `dev-*` branch and published to an integration branch. Reviews have threaded comments at review, object and field level, with a configurable approval quorum. |
| **Baselines** | Immutable snapshots (git tags plus coverage stats) that you can compare |
| **Dashboards** | SQL-style queries over an in-memory index, with bar, pie, line, KPI and table widgets. Coverage, progress and maturity dashboards come ready-made. |
| **Parameters** | A shared parameter base (`parameters/parameters.yaml`) referenced as `{name}` inside requirements and tests |
| **Spreadsheet view** | Excel-like grid editing with drag & drop, copy and paste, and Excel / CSV import and export |
| **Export** | PDF audit reports, Excel matrices, Word, JUnit XML |
| **i18n** | English and French UI |



## Using Polenta with an AI agent

The desktop app ships a stdio MCP server that runs on the same service layer as the UI.
It generates IDs, resolves types and validates required fields in the same way. The server
never commits: agents write to the working tree, and you review and publish from the app.
Bulk imports run as a dry run unless you explicitly turn that off.

```bash
pnpm --filter @polenta/desktop run mcp-server -- --repo /path/to/my-product
```

See [specs/SPEC-MCP-SERVER.md](specs/SPEC-MCP-SERVER.md) for the full list of tools.

## Getting started

### Download

Windows installers are published on the
[Releases](https://github.com/laurentolive/polenta/releases) page.

### Build from source

Requirements: Node.js ≥ 20 and pnpm ≥ 9.

```bash
git clone https://github.com/laurentolive/polenta.git
cd polenta
pnpm install
pnpm --filter @polenta/desktop dev      # run the desktop app in dev mode
pnpm --filter @polenta/desktop package  # build an installer
```

Other commands from the repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

A starter template for battery-powered appliances is in
[templates/electro-domestic-battery.yaml](templates/electro-domestic-battery.yaml).

## Repository structure

This is a pnpm and Turborepo monorepo.

| Path | Contents |
|---|---|
| `apps/desktop` | Electron + React desktop app (main product) and the MCP server |
| `apps/api`, `apps/web` | Earlier NestJS API and web client, replaced by the desktop architecture |
| `packages/types` | Shared TypeScript types |
| `packages/zod-schemas` | Shared validation schemas |
| `packages/api-client` | Renderer ↔ main process client |
| `specs/` | Functional and technical specifications |

Main technologies: Electron, React, TanStack Router and Query, Tiptap, isomorphic-git,
AlaSQL, MiniSearch, Recharts, Zod.

## Documentation

- [SPEC.md](SPEC.md): functional specification (French)
- [specs/SPEC-INDEX.md](specs/SPEC-INDEX.md): index of detailed specs
- [CONTEXT.md](CONTEXT.md): design decisions and the reasons behind them
- [WORKFLOW.md](WORKFLOW.md): development workflow (tickets, AI agents, human review)

## License

[GNU GPL v3](LICENSE)
