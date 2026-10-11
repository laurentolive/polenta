# 6. Tracking and search

**English** | [Français](../tutoriels/06-suivi.md)

The **Tracking** view answers project management questions: where the requirements stand, what is
not tested, what failed. It relies on **queries** over the whole project, shown in **dashboards**.

## Dashboards

**Tracking** view, *Pilotage LL800* dashboard:

![Project dashboard](../img/dashboard.en.png)

- Each **widget** shows a query result: bars (here stacked by status), pie, line, table or key
  figure (*À revalider*: 4).
- **Add a widget** adds one; a widget's pencil edits it.
- **Private** / **Shared**: a shared dashboard is saved in the repository and visible to the whole
  team; a private dashboard stays with its author.
- **Export** produces a Word or PDF version of the dashboard.

The second dashboard, *Composants & traçabilité*, tracks coverage component by component.

## Queries

The bottom of the side panel lists the shared queries. Open *Exigences — statut de couverture*:

![SQL query on requirements](../img/query.en.png)

A query can be built in two ways:

- **Builder**: choose the table, filters and groupings, without writing SQL;
- **Advanced SQL**: a read-only `SELECT` on the `requirements`, `tests` and `links` tables.

**Execute** shows the result, **Save** stores the query, the history keeps the latest queries run;
**Export** produces Excel or PDF. Examples:

```sql
-- Approved requirements without a test
SELECT id, title FROM requirements
WHERE status = 'approved' AND coverageStatus = 'not_covered'

-- Requirements that are not "mature", with the reason
SELECT id, title, maturityMissingCriteria FROM requirements
WHERE maturityOk = false
```

**Maturity** groups the writing rules: required fields filled in, EARS statement, measurable
acceptance criterion, verification link for an approved requirement, no pending impact. PRD-0012
shows up with the `EARS` reason.

## Search

**Search** view: a text, or a regular expression, searched across all the project's
repositories.

![Searching for "essorage"](../img/search.en.png)

- **Aa** matches case, **ab|** matches whole words, **.\*** enables regular expressions; the
  checkboxes restrict the search to requirements, tests or campaigns.
- On the left, each match with its field; on the right, the matching items in full.
- The arrow left of the field opens **replace**, across the whole project.

Example: `\{[a-z_]+\}` as a regular expression finds every parameter reference.
