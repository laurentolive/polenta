# 3. Requirements

**English** | [Français](../tutoriels/03-exigences.md)

This tutorial goes through the demo's requirements: lists, saved views, the editor, EARS syntax,
diagrams, links and the rules for moving from one status to another.

## Choose a requirement type

**Requirements** view (activity bar). The selector at the top of the side panel lists every
requirement type of every component: *Lave-linge LL800 / Exigence Produit*, *Sous-système
hydraulique / Exigence Hydraulique*, *Moteur BLDC & onduleur / Exigence Moteur*… Type to filter
it.

![Component and type selector](../img/req-picker.en.png)

Below the selector, the tree groups requirements into **sections** (*Performance*, *Usage*,
*Réglementaire*…). **New element** adds a requirement; Polenta assigns its ID (`PRD-0014`…), and an
ID is never reused, even after deletion: SYS-0015 was deleted, the `.polenta/tombstones/SYS-0015`
file keeps track of it, and the next system requirement will be SYS-0016. A requirement not yet
placed appears at the end of the list, sorted by ID, until you drag it into a section.

## Table view and document view

The **table view** shows one row per requirement and one column per field.

![Product requirements in table view](../img/req-table.en.png)

- A column's funnel filters it (text, case, whole word, regular expression), including the
  **Verification** column (*Not covered*, *Failing*…).
- The **⚙️ › Visible fields** gear chooses the columns: the type's fields, links, and **computed
  columns** defined by the project (for example the campaign *Last result*, or one column per
  campaign, see [tutorial 7](07-tracking.md)). In the demo, verification links and issue links are
  shown by default. When a type is both source and target of the same link, each direction has its
  own column (*refines* / *is refined by*).
- Underlined blue values (`8 kg`, `1400 tr/min`) are **parameters**: the value comes from the
  parameter base ([tutorial 5](05-parameters.md)).
- Statuses follow the life cycle defined by the type: `draft`, `review`, `approved`, and two
  terminal statuses, `obsolete` (PRD-0011) and `rejected` (PRD-0013).
- **Export** produces an Excel, Word or PDF file, with a customer template if needed.

The **document view** (page icon) shows the same requirements as a specification document, with
their links. Switching from one view to the other keeps the selected requirement.

![Document view](../img/req-document.en.png)

### The four statuses of a requirement

A requirement has four statuses, which the optional columns of **⚙️ › Visible fields** show side by
side:

| Status | What it says | Where it comes from |
|---|---|---|
| **Authoring** | draft, in review, approved… | the status you enter |
| **Design** | the first released version that contains the requirement in its current state (`1.0`), "—" otherwise | versions ([tutorial 9](09-versions.md)) |
| **Verification** | *Not covered*, *Covered*, *Verified*, *Failing*, *Needs revalidation* | tests and their results ([tutorial 6](06-traceability.md)) |
| **Validation** | the decision of the latest signed validation, with its version (*Conforme (1.0)*) | validations ([tutorial 10](10-issues-validation.md)) |

Only authoring is entered; the other three are computed when displayed.

### Saved views

A setup of columns, filters and sorting is saved as a **view**, from the drop-down next to ⚙️:

- **Save as…**: a name, and a **scope** — *Personal* (for you only) or *Team* (written to the
  repository, under `.polenta/views/`, to be published to share it);
- the list groups **My views** and **Team**; a view changed since it was loaded carries the
  *modified* mention; **Save**, **Rename**, **Delete**, **Default columns**.

The demo has two team views on product requirements: *Revue marketing* (priority, source, markets,
KPI) and *Suivi de conformité*, which shows the statuses side by side.

The **Popup** tab of ⚙️ chooses the fields shown in the preview that opens when hovering an ID.

## The editor

A row's pencil opens the editor. Open **SYS-0001** (*Exigence Système*, *Architecture* section):

![SYS-0001 editor, with a draw.io diagram in the statement](../img/req-editor.en.png)

- At the top, the requirement's **verification** state (here *Not covered*: no test verifies it,
  see [tutorial 6](06-traceability.md)).
- Fields come from the type: text, rich text, list, checkboxes, date, user, number, diagram,
  **link** (a label and a URL: web page, file or network share)… An asterisk marks a required
  field. SYS-0001's *Documents de référence* is a link field: a European regulation and a note on a
  network share.
- Rich text accepts **draw.io diagrams**, images, tables and `[[ID]]` references to another item.
  SYS-0001's architecture diagram is a `.drawio` file in the repository, shown inside the statement;
  PRD-0004's rationale cites `[[SYS-0002]]`.
- At the bottom, the **Executions** section lists all the results of the tests that verify the
  requirement ([tutorial 4](04-tests-campaigns.md)).
- **↩ / ↪** undo and redo; **Back** returns to the list.

Every save is dated and attributed by git. Reopening an approved requirement (moving it back to
`review` or `draft`) increments its **version**: SYS-0002, approved at the RE1 review then moved
back to review after the EVT tests, is at version 2. Items linked to it are then marked **Impact to
check** ([tutorial 6](06-traceability.md)).

Changing status offers a **Status change comment (optional)**: it is kept in the requirement's
history, with the date and the author of the change. SYS-0002's history shows its three successive
statuses and the comment *Essorage porté à 1400 tr/min après EVT.*

The history tracks the status and the fields marked **Hist.** in the type (here, the priority). In
the demo, it is written for product and system requirements, system tests, and the motor's
requirements and tests. The local components (hydraulics, control board, user interface…), the
pump, the Wi-Fi module and the bus have none: Polenta infers the current value from the last commit
(*inferred* entry), and *Project › Preferences › Rebuild from git* reconstructs a repository's
history from its commits.

A type can show a field instead of the ID: user interface requirements show their title. In
BIHM-0002's links, IHM-0004 appears under the name *Conformité au bus IHM*.

## Writing in EARS

Statements follow the **EARS** syntax (*Easy Approach to Requirements Syntax*), five short,
verifiable forms:

| Form | Pattern | Demo example |
|---|---|---|
| Ubiquitous | `THE <system> SHALL <action>` | PRD-0001 |
| Event-driven | `WHEN <trigger> THE <system> SHALL <action>` | PRD-0003 |
| State-driven | `WHILE <state> THE <system> SHALL <action>` | PRD-0004 |
| Optional feature | `WHERE <feature> THE <system> SHALL <action>` | PRD-0006 |
| Unwanted behaviour | `IF <condition> THEN THE <system> SHALL <action>` | PRD-0008 |

A type's *Statement* field carries the `EARS` validator. The statement of **PRD-0012** ("Le filtre
de la pompe doit être facile d'accès…") does not follow it: Polenta reports it in the **maturity**
criteria of queries ([tutorial 7](07-tracking.md)), rejects a non-compliant bulk import
([tutorial 12](12-ai-agent.md)) and, if the type asks for it, when the status changes (below).

## Links

At the bottom of the editor, one section per link type, in both directions: *refines* / *is
refined by*, *implements* / *is implemented by*, *is verified by*…

![SYS-0001's links: implemented by CC-0001](../img/req-links.en.png)

Type an ID or a title in **Search for an element…** to create a link; the cross removes it. Only
items allowed by the link type are offered, including those of other repositories of the project:
SYS-0002 is implemented by MOT-0001, a requirement of the motor component.

The link labels are defined by the project; in the demo they are in French (*raffine*, *est
implémentée par*…).

## Type rules

In *Project › Data model*, a type's definition carries two optional rules. The demo uses
them on two types:

- *Exigence Produit*: the *Critères d'acceptance* are required at approval;
- *Exigence Système*: from `draft` to `review`, required fields block and formats (EARS) notify;
  towards `approved`, a missing test notifies.

**Required if.** The **Req. if** column of the fields table makes a field required under a
condition: `status = approved` (the rationale is only required at approval), or a value of another
field (`priority = high`). Renaming the status or the value updates the condition.

**Transition constraints.** The **Transition constraints** section of a requirement, test or issue
type controls moving from one status to another:

1. **+ Add a rule**: **From** (optional, **Any status** by default) and **To** a status;
2. for each condition — **Required fields filled**, **Valid formats (EARS…)**, **Covered by a
   test** — a level: **No check**, **Notify** (default) or **Block**.

In the editor's status list, a blocked transition is greyed out with its reason; a notified
transition remains possible, with a warning and an *items to check* notification after the change.
With no rule, changing status is free.

## Exercises

**Switch from one view to the other.**
1. *Exigence Produit* in table view: change PRD-0005's title.
2. Switch to document view.

Result: the new title appears in the document, on the same requirement.

**Use saved views.**
1. List of views: apply *Suivi de conformité*.
2. Change the columns, then **Save as…** a *Personal* view.
3. **Version** view, **Modifications**.

Result: the *Verification*, *Design* and *Validation* columns are shown. The personal view writes
nothing to the repository: only `.polenta/views/root/exigence-produit.yaml` holds views, the team's.

**Filter uncovered requirements.**
1. *Exigence Système*, funnel of the **Verification** column: *Not covered*.

Result: the list contains SYS-0008.

**Fill in a link field.**
1. Open SYS-0003, *Documents de référence*: add a label and a `https://…` URL.
2. Add a second link with the text `cahier` as URL.

Result: the first link is clickable. The second is refused: *Unsupported URL: http(s)://, file:// or
network path \server\share.*

**Fix format errors.**
1. Open PRD-0012: the statement is not in EARS, and the *Réf. demande client* `CLI-12` does not
   follow the `CLI-0000` format.
2. Rewrite the statement (`THE pompe SHALL …`) and enter `CLI-0012`.

Result: both errors disappear.

**Approve without an acceptance criterion.**
1. Open PRD-0012, which has no acceptance criterion.
2. Choose the `approved` status.

Result: *Critères d'acceptance* is reported as required for this status.

**Run into transition constraints.**
1. *Exigence Système*, **New element**: a title only (SYS-0016 on a fresh demo).
2. Move the requirement to `review`.
3. Open SYS-0007 (in review, no test) and move it to `approved`.

Result: at step 2, the change is blocked (*Status change of SYS-0016 refused*, code
`TRANSITION_BLOCKED`): the required statement is missing. At step 3, the change goes through, with
the notification *Status of SYS-0007 changed — items to check*.

**Reopen an approved requirement.**
1. Open SYS-0003 (approved, version 1) and move it back to `review`, with a comment.

Result: SYS-0003 goes to version 2. The linked items, PRD-0005 and SW-0001, are marked **Impact to
check**.

**Read the history.**
1. Open SYS-0002, status history.
2. Open POMP-0001 (*Pompe de vidange*), same section.
3. *Project › Preferences*: **Rebuild from git** on `comp-pompe-vidange`, then reopen POMP-0001.

Result: SYS-0002 shows real entries, including the comment written after EVT. POMP-0001 shows an
*inferred* entry. After the rebuild, its entries carry the *git* badge (commit date and author);
the file is to be published.

**See a field shown instead of the ID.**
1. Open BIHM-0002 (*Bus IHM*), *est implémentée (interface) par* section.
2. Open the linked requirement.

Result: the link shows *Conformité au bus IHM*, IHM-0004's title, instead of its ID.

**Delete a requirement.**
1. Create a system requirement (SYS-0016 on a fresh demo), then delete it.
2. Create another system requirement.

Result: `.polenta/tombstones/SYS-0016` appears. The new requirement takes the next number: SYS-0016
is not reused.

**Write in rich text.**
1. In PRD-0005's rationale, insert a table, an image and the `[[SYS-0001]]` reference.

Result: the table and the image are shown; the reference becomes a link to SYS-0001.

**Link a Jira ticket.**
1. Open PRD-0010, Jira section: the `LL-128` ticket is listed.
2. Add another one.

Result: both tickets are listed.

**Export.**
1. Apply *Revue marketing*, then **Export** to Word, then to Excel.

Result: each file contains the requirements and the displayed columns.

**Rename a value.**
1. *Project › Data model*, *Exigence Produit*, *Priorité* field: rename `low` to `basse`.

Result: a migration window lists the affected requirements (PRD-0010…) and rewrites them.
