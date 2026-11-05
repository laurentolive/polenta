# 9. Versions and impact analysis

**English** | [Français](../tutoriels/09-versions.md)

A **version** is the delivered state of a repository — a component, or the product for the root
repository — with the list of changes it brings: `1.2.4` of the motor, `2.0` of the washing machine.
It carries the **impact analysis** of those changes and the list of **tests to run**, and is frozen
when it is delivered. Test executions say on which version they were made
([tutorial 4](04-tests-campaigns.md)), and quality validates a version
([tutorial 10](10-issues-validation.md)).

This tutorial visits the demo's versions, then explains how to declare a version type on your own
project.

## The demo's versions

Each repository of the demo has its version type, with its own prefix (a prefix is unique across the
whole project):

| Repository | Version | Status | What it shows |
|---|---|---|---|
| `ll800-produit` | LLV-0001 `1.0` | released | tag `ll800-produit-1.0`, frozen analysis, signed validation |
| `ll800-produit` | LLV-0002 `2.0` | in progress | changes, impact analysis, tests to run, validation in progress |
| `ll800-produit` | LLV-0003 `1.1` | abandoned | fix of the 1.0, abandoned in favour of the 2.0 |
| `comp-moteur` | MOTV-0001 `1.2.4` | released | tag `comp-moteur-1.2.4`, signed validation |
| `comp-moteur` | MOTV-0002 `1.3` | in progress | MOT-0007 and the MISS-0001 issue |
| `comp-pompe-vidange` | POMV-0001 `1.0`, POMV-0002 `2.0` | released | the `2.0` carries the `v2.0` tag, the one mounted in the product |
| `comp-module-wifi` | WIFV-0001 `1.0` | released | |
| `if-bus-interne` | IFV-0001 `1.1` | released | tag `v1.1` |

The statuses of a version type:

| Status | Meaning |
|---|---|
| **In progress** | the version is being prepared: changes are added to it |
| **Released** | delivered: frozen, tagged in git |
| **Abandoned** | will not be delivered |

## Open a version

**Version** view: the panel opens on **Product version** (otherwise, the package-icon button at the
top of the panel). Choose the repository in the drop-down list: the panel lists its versions with
their status; **Show abandoned versions** brings LLV-0003 back.

Open LLV-0001, the washing machine's `1.0` version:

- **Previous version**: none, it is the first one;
- **Components**: the embedded version of each reusable component — motor `1.2.4`, pump `1.0`,
  Wi-Fi module `1.0`. The product has three components: the internal bus is mounted under the motor
  and follows its version (MOTV-0001 embeds IFV-0001);
- **Changes**: all the requirements and tests of the repository, plus the ISS-0001 issue;
- the `ll800-produit-1.0` tag and the frozen impact analysis, shown as a table.

A local component (a folder of the product repository, such as *Sous-système hydraulique*) has no
version of its own: it is delivered with its repository. Neither does a component mounted read-only
(the pump, the Wi-Fi module): its version is created in its own repository.

**New version** creates a version: the **Label**, the **Previous version** (the one it builds on, to
establish the changes) and the embedded version of each component. Right-clicking a version lets you
copy or delete it as long as it is not delivered (its ID is never reused).

## Changes and the backlog

The **Change backlog** (in the same panel) lists the requirements, tests and issues of the
repository modified since the last delivered version and not yet attached to a version, with their
**Nature**: *new*, *modified*, or *modified outside the app* (file changed directly in git). In the
product repository, PRD-0006 is listed: it was modified after the `1.0`.

- Tick items, choose the **Target version**, then **Include selection** (or **Include all**).
- In the version's page, the **Changes** table lists what is included (component, type, ID, title);
  **See changes** shows the differences with the last delivered version; **Add** and **Remove (back
  to the backlog)** adjust the list.

LLV-0002 includes two issues, ISS-0002 and ISS-0003, and PRD-0013. A change with no requirement or
test to justify it (a fix, a non-conformity) is thus included through an **issue**
([tutorial 10](10-issues-validation.md)).

## Analyze the impact

The **Impact analysis** section of the version's page starts from each included change and unrolls
the **tree** of linked items: tests that verify it, requirements it refines or implements, and so
on. An included issue adds, as starting points, the requirements it impacts (*via ISS-…*): in
LLV-0002, ISS-0003 brings PRD-0002, and ISS-0002 brings SYS-0004.

For each node of the tree:

- an **Impact status**, from *Impact not verified* to *Modification verified*, through *No real
  impact* or *Modification to do*;
- a **Comment**, for the review.

In LLV-0002, SYS-0002 is at *Impact to test*, with the comment *À rejouer après la correction de
vitesse.* While the version is in progress, the analysis is recomputed on opening (*computed on
…*): an item that is no longer reached is flagged. On release it is **frozen**, like LLV-0001's.

## Tests to run

The **Tests to run** section deduces from the analysis the tests to run again: for each, what
**brought** it (the originating change) and the campaign where it is **already** included, if any;
it also flags the *requirements without a test*. For LLV-0002: TSYS-0002, TSYS-0005 and TSYS-0008,
and PRD-0013 as a requirement without a test. Tick tests, then:

- **Create a campaign**: opens campaign creation with these tests;
- **Add to …**: adds them to an existing campaign.

The campaign is not attached to the version: it is each execution that records its **tested
version**. The DVT runs carry LLV-0002.

## Deliver: release

**Release** freezes the version:

1. Polenta offers a **Tag** (`<repository>-<label>`, editable);
2. on confirmation, it records the version, sets the git tag and freezes the list of changes and the
   impact analysis. The tag goes to the server on the next publication (*Tag … not pushed yet* until
   then).

The release is refused as long as an embedded component is not itself released, or an included item
has changes not saved in git. A released version can no longer be modified, like an approved
requirement. In the demo, each component was delivered before the product's `1.0`.

Once the version is delivered, the **Design** column of requirements
([tutorial 3](03-requirements.md#the-four-statuses-of-a-requirement)) shows its label for each
requirement it contains in its current state: `1.0` for PRD-0001, "—" for PRD-0006, modified since.

## On disk

A version is a `versions/<ID>.yaml` file of the repository: label, previous version, component
versions, included changes, impact analysis entries, then, on release, the tag, the commit and the
frozen analysis.

> **On your project**
>
> A repository has at most one version type: each repository of the demo already has its own. On
> your project, in *Project › Data model › Structure*, on the repository's row, **+** then **+
> Version**. The type gets a default prefix, to replace if needed (see the demo's: `LLV`, `MOTV`…),
> and the three statuses above. As with other types, fields and status labels can be edited.

## Exercises

**Compare the product's three versions.**
1. **Version** view, product repository: open LLV-0001, LLV-0002, then LLV-0003 (**Show abandoned
   versions**).
2. **New version** with the label `1.0`.
3. Start again with the label `1.1`.

Result: three statuses — released, in progress, abandoned. The label `1.0` is refused: *Label
already used: …* (code `LABEL_TAKEN`). The label `1.1`, that of an abandoned version, is accepted:
the version created is LLV-0004.

**Include a change.**
1. Product repository's **Change backlog**: tick PRD-0006.
2. **Target version** LLV-0002, **Include selection**.

Result: PRD-0006 leaves the backlog and appears in LLV-0002's **Changes**. The impact analysis also
starts from PRD-0006.

**Conduct the impact analysis.**
1. Open LLV-0002, **Impact analysis**: on TSYS-0005, choose *Modification to do* and write a
   comment.
2. **Tests to run**: tick the three tests, **Create a campaign**.

Result: the status and the comment are stored in `versions/LLV-0002.yaml`. The campaign created
(CAMP-0006 on a fresh demo) contains TSYS-0002, TSYS-0005 and TSYS-0008.

**Release a component version.**
1. Open MOT-0007 (*comp-moteur*), change its statement, without publishing.
2. **Version** view, `comp-moteur` repository, MOTV-0002: **Release**.
3. **Terminal**, **Go to …** `comp-moteur`, then `git commit -am "Rendement de l'onduleur"`.
4. **Release** again, with the suggested tag `comp-moteur-1.3`.

Result: at step 2, the release is refused: *Included elements modified and not committed: …* (code
`DIRTY_CHANGES`). At step 4, MOTV-0002 is released and the `comp-moteur-1.3` tag is set locally
(*not pushed yet*). This release cannot be undone: start again from a clean demo afterwards
([tutorial 2](02-getting-started.md#starting-again-from-a-clean-demo)).
