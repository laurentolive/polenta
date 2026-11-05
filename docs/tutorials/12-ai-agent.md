# 12. Working with an AI agent

**English** | [Français](../tutoriels/12-agent-ia.md)

A Polenta project is made of text files in git repositories: an AI coding agent (Claude Code,
Cursor, Codex…) can read it directly. Polenta also gives it a user guide and an **MCP server** that
applies the same rules as the application.

## What Polenta prepares

Every time a project is opened, Polenta writes at the root of the product repository:

| File | Role |
|---|---|
| `AGENTS.md` | the agent's guide: file layout, IDs, links, rules to follow |
| `.mcp.json` | the declaration of Polenta's MCP server, pointing to the installed application (ignored by git, specific to each machine) |

An agent started in the demo's `demo-ll800-produit` folder finds both files. Claude Code, for example,
offers to enable the `polenta` server declared in `.mcp.json` on first launch.

## What the MCP server does

The server goes through the same services as the interface: it assigns IDs, resolves types, checks
required fields, EARS syntax and allowed link types.

| Tools | Use |
|---|---|
| `get_schema` | the data model: components, types, fields, statuses, link types |
| `list_requirements`, `list_tests`, `list_campaigns`, `get_history` | read items and the history of their tracked fields |
| `bulk_import_requirements`, `bulk_import_tests`, `bulk_import_campaigns` | create items in bulk |
| `update_requirements`, `update_tests` | modify existing items (before / after preview, change comment) |
| `list_parameters`, `set_parameters`, `delete_parameter` | manage the parameter base |
| `list_links`, `create_links`, `delete_links` | manage traceability |
| `add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type` | evolve the data model |
| `list_versions`, `get_version`, `get_version_backlog`, `get_version_impact`, `get_version_tests` | read versions, their backlog, their impact analysis and the tests to run |
| `list_issues`, `get_issue`, `create_issue`, `update_issue` | read and maintain issues |
| `list_validations`, `get_validation`, `propose_validation_decision` | read validations and **propose** a decision, which a human confirms or rejects |
| `run_query`, `create_query`, `add_widget`, `test_script`… | read and build Tracking queries, dashboards and scripts |

Two safeguards:

- writes are **dry runs by default** (`dryRun`): the agent sees what would be created and the
  errors, and must explicitly ask for the real write;
- the server **never publishes**: what the agent writes shows up in the pending changes of the
  Version panel. You review in Polenta, then publish.

An agent does not sign a validation either: its decisions stay *Proposed by …* until a human
**Confirms** or **Rejects** them ([tutorial 10](10-issues-validation.md)).

## Examples on the demo

A few requests to make to the agent, in the `demo-ll800-produit` folder:

- "List the approved requirements that no test verifies."
- "Rewrite the statement of PRD-0012 in EARS and suggest a measurable acceptance criterion."
- "Create the Wi-Fi module requirements from this specification, then the links to the relevant
  system requirements." (dry-run import, review, then real import)
- "Write a test case for SYS-0008 with its steps and link it to the requirement."
- "Add a widget to the Pilotage dashboard with the number of requirements per coverage status."
- "Change the value of the `vitesse_essorage` parameter to 1600 rpm and show me what it changes."
- "Summarize the impact analysis of version 2.0 (LLV-0002) and list the tests to run."
- "Propose a decision for SYS-0004 in validation VAL-0002." (the decision stays *Proposed by …*
  until it is confirmed in Polenta)

Then go back to Polenta: the new items are in the Requirements and Tests views, the files in
**Version > Modifications**.

## Exercises

**Query versions and issues.**
1. Start an agent in the `demo-ll800-produit` folder and enable the `polenta` server.
2. Ask it: "List the project's versions with their status, then the requirements impacted by
   ISS-0003."

Result: the agent uses `list_versions` and `get_issue`. It cites LLV-0001 `1.0` (released), LLV-0002
`2.0` (in progress), LLV-0003 `1.1` (abandoned), the components' versions, and PRD-0002 as the
requirement impacted by ISS-0003.
