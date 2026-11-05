# 2. Getting started

**English** | [Français](../tutoriels/02-prise-en-main.md)

This tutorial opens the demo project, introduces the interface and the data model, then shows what
Polenta writes to disk. It assumes a connected account ([tutorial 1](01-account-login.md)).

## Open the demo

With no project open, Polenta shows its home screen.

![Home screen](../img/home.en.png)

1. Click **Discover Polenta with the demo project**.
2. Pick an **empty** folder: Polenta clones the product repository and its components into it.
3. The project opens on its **data model**.

The other home choices are for real projects:

| Choice | Use |
|---|---|
| **Open an existing project** | a folder already on the machine |
| **Open a project from an existing repo** | clone a project: picked from the list of projects accessible with your account, or by its git URL |
| **Create a new project** | an empty project, **On this computer only** or **On a server (GitHub, Forgejo)** ([tutorial 11](11-team-projects.md)) |
| **Your team’s projects** | on a company Forgejo server, the projects published for your teams, to open with one click |

## The interface

- The **activity bar**, on the left, switches views: Account, Project, Tracking, Requirements,
  Tests, Campaigns, Issues, Validation, Parameters, Search, Version. Right-click hides a button (or
  **Reset layout**), drag and drop reorders them.
- The **side panel** shows the view's content: requirement tree, campaign list, dashboards… Clicking
  the icon of the active view again **collapses** or expands it; shortcut **Ctrl+B**.
- The **main area** shows the open item. Each view opens in a **tab** (at the top); **Ctrl+T** opens
  a new tab.
- The **Publish** button, top right, shares your changes
  ([tutorial 8](08-publishing-history.md)).

### Navigating

- **Back** and **Forward** (`<` `>`, left of the tabs), or **Alt+←** / **Alt+→**, as in a browser;
  right-click shows the history. Leaving a page with unsaved changes asks for confirmation.
- Any displayed **ID** that designates another item (in a table, a document, a card, a campaign, a
  search or dashboard result…) is a **link**: a click opens the item, **Ctrl+click** opens it in a
  new tab, hovering for a moment shows a **preview**.
- **Zoom** of the whole interface: **Ctrl+mouse wheel**, **Ctrl+=** / **Ctrl+-**, **Ctrl+0** to go
  back to 100%.

## The data model

*Project > Data model*, **Structure** tab: the tree of the project's repositories and of the item
types in each.

![The demo's data model](../img/schema.en.png)

- Each **item type** has a prefix (`PRD`, `SYS`, `TSYS`…), a category (requirement, test, campaign,
  version, issue, validation), its fields and its statuses. A type's pencil opens its definition;
  the **+** on a component's row adds a type to it.
- **Local components** (folders) break the product down within the same repository: *Sous-système
  hydraulique*, *Carte de commande › Logiciel de commande*…
- **Reusable components** (repository icon) are other git repositories, mounted at a precise
  version: *Pompe de vidange* is pinned to tag `v2.0`. They can be shared between several
  products; within the product they are read-only.
- An **interface** (*Interface* badge) describes an exchange between components, with roles
  (master / slave, controller / device). See [tutorial 6](06-traceability.md).
- Each repository shows its **integration branch**, where the team shares its work
  ([tutorial 8](08-publishing-history.md)) and, on a GitHub or Forgejo server, its **Repository
  settings** (gear on hover, [tutorial 11](11-team-projects.md)).

The **Links** tab defines the link types allowed between items (refinement, implementation,
verification…).

Everything is configurable: type, field and status names are the team's, not the tool's. The
optional rules (conditionally required fields, status transition constraints) are presented in
[tutorial 3](03-requirements.md).

## On disk

A Polenta project is a folder of text files versioned with git. A requirement is a YAML file that
can be read and compared line by line:

```yaml
# ll800-produit/requirements/PRD-0002.yaml
id: PRD-0002
objectTypeRef: root::exigence-produit
title: Vitesse d'essorage maximale
status: approved
version: 1
fields:
  statement: THE lave-linge SHALL essorer à une vitesse maximale de {vitesse_essorage} en programme Coton.
  priority: high
  source: Marketing
  kpi_cible: 1400 tr/min
  acceptanceCriteria: '- [ ] Vitesse mesurée au tachymètre ≥ {vitesse_essorage} − 2 %'
```

| Folder | Contents |
|---|---|
| `requirements/`, `tests/`, `campaigns/` | one file per item |
| `issues/`, `versions/`, `validations/` | one file per issue, version, validation ([tutorials 9](09-versions.md) and [10](10-issues-validation.md)) |
| `links/links.yaml` | all the repository's traceability links |
| `parameters/parameters.yaml` | the parameter base |
| `test-runs/` | execution results |
| `queries/`, `dashboards/` | shared queries and dashboards |
| `.polenta/schema.yaml` | the data model |
| `.polenta/views/` | the team's saved views |
| `polenta-repo.yaml` | the reused components and their version |

History, authors and dates come from git: there is no separate database.
