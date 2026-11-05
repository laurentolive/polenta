# 9. Versions and impact analysis

**English** | [Français](../tutoriels/09-versions.md)

A **version** is the delivered state of a repository — a component, or the product for the root
repository — with the list of changes it brings: `1.2.4` of the motor, `2.0` of the washing machine.
It carries the **impact analysis** of those changes and the list of **tests to run**, and is frozen
when it is delivered. Test executions say on which version they were made
([tutorial 4](04-tests-campaigns.md)), and quality validates a version
([tutorial 10](10-issues-validation.md)).

The demo declares no versions: follow this tutorial by adding a version type to the demo's product
repository, or on your own project.

## Declare a version type

A repository has at most one version type. In *Project › Data model › Structure*, on the
repository's row (*Lave-linge LL800*), **+** then **+ Version**. The type gets a prefix (`LLV`…) and
the default statuses:

| Status | Meaning |
|---|---|
| **In progress** | the version is being prepared: changes are added to it |
| **Released** | delivered: frozen, tagged in git |
| **Abandoned** | will not be delivered |

As with other types, fields and status labels can be edited. A local component (a folder of the
product repository) has no version of its own: it is delivered with its repository. Neither does a
read-only component: its version is created in its own repository.

## Create a version

**Version** view, **Product** button (package icon) at the top of the panel:

1. choose the repository in the drop-down list;
2. **New version**: the **Label** (`1.0`), the **Previous version** (the one it builds on, to
   establish the changes) and, for each reusable component, the version of that component it
   embeds;
3. **Create**.

The panel lists the repository's versions with their status; **Show abandoned versions** brings
them back. Right-clicking a version lets you copy or delete it as long as it is not delivered (its
ID is never reused).

## Changes and the backlog

The **Change backlog** (in the same panel) lists the requirements, tests and issues of the
repository modified since the last delivered version and not yet attached to a version, with their
**Nature**: *new*, *modified*, or *modified outside the app* (file changed directly in git).

- Tick items, choose the **Target version**, then **Include selection** (or **Include all**).
- In the version's page, the **Changes** table lists what is included (component, type, ID, title);
  **See changes** shows the differences with the last delivered version; **Add** and **Remove (back
  to the backlog)** adjust the list.

A change with no requirement or test to justify it (a fix, a non-conformity) is included through an
**issue** ([tutorial 10](10-issues-validation.md)).

## Analyze the impact

The **Impact analysis** section of the version's page starts from each included change and unrolls
the **tree** of linked items: tests that verify it, requirements it refines or implements, and so
on. An included issue adds, as starting points, the requirements it impacts (*via ISS-…*).

For each node of the tree:

- an **Impact status**, from *Impact not verified* to *Modification verified*, through *No real
  impact* or *Modification to do*;
- a **Comment**, for the review.

While the version is in progress, the analysis is recomputed on opening (*computed on …*): an item
that is no longer reached is flagged. On release it is **frozen** and shown as a table.

## Tests to run

The **Tests to run** section deduces from the analysis the tests to run again: for each, what
**brought** it (the originating change) and the campaign where it is **already** included, if any;
it also flags the *requirements without a test*. Tick tests, then:

- **Create a campaign**: opens campaign creation with these tests;
- **Add to …**: adds them to an existing campaign.

The campaign is not attached to the version: it is each execution that records its **tested
version**.

## Deliver: release

**Release** freezes the version:

1. Polenta offers a **Tag** (`<repository>-<label>`, editable);
2. on confirmation, it records the version, sets the git tag and freezes the list of changes and the
   impact analysis. The tag goes to the server on the next publication (*Tag … not pushed yet* until
   then).

The release is refused as long as an embedded component is not itself released, or an included item
has unsaved changes. A released version can no longer be modified, like an approved requirement.

Once the version is delivered, the **Design** column of requirements
([tutorial 3](03-requirements.md#the-four-statuses-of-a-requirement)) shows its label for each
requirement it contains in its current state.

## On disk

A version is a `versions/<ID>.yaml` file of the repository: label, previous version, component
versions, included changes, impact analysis entries, then, on release, the tag, the commit and the
frozen analysis.
