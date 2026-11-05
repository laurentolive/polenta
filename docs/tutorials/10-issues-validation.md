# 10. Issues and validation

**English** | [Français](../tutoriels/10-issues-validation.md)

An **issue** tracks a problem or a change that the requirements do not describe: a bug, a
non-conformity, a test finding. A **validation** is quality's decision, requirement by requirement,
on a delivered version — up to the final green light of the product version.

This tutorial visits the demo's issues and validations, then explains how to declare their types on
your own project. It follows [tutorial 9](09-versions.md).

## Issues

### The demo's issues

**Issues** view: the same table and document views as for requirements, with the edit card.

| Issue | Status | Origin | Impacts | Version |
|---|---|---|---|---|
| ISS-0001 *Résonance du panneau arrière en essorage* | fixed | TSYS-0004's failure in EVT | PRD-0004 | LLV-0001 `1.0` |
| ISS-0002 *Détection de balourd : couverture partielle* | in progress | *dérogation* decision of VAL-0001 on SYS-0004 | SYS-0004 | LLV-0002 `2.0` |
| ISS-0003 *Vitesse d'essorage sous le KPI sur la machine n°4* | open | TSYS-0005's failure in CAMP-0003 (1352 rpm) | PRD-0002 | LLV-0002 `2.0` |
| MISS-0001 *Temps de coupure de l'onduleur trop long* (`comp-moteur`) | open | TMOT-0003's failure in CMOT-0001 (14 µs) | MOT-0004 | MOTV-0002 `1.3` |

### Create and follow an issue

An issue is created in three ways:

- from the view, like any item;
- **after a failed execution**: Polenta offers *Create an issue*, *Link to an existing issue* or
  *Ignore*; the issue keeps the execution as its origin ([tutorial 4](04-tests-campaigns.md));
  importing an execution Excel workbook offers it too for the imported failures;
- **from a validation decision** that asks for it (*Decision to track*, below): this is ISS-0002's
  origin.

In the card, the **impacte** (impacts) link section connects the issue to the requirements it
touches, in the same component. These requirements become starting points of the impact analysis
when the issue enters a version: an issue is included in a version like a requirement or a test,
through the backlog. An issue has no approval lock: it stays editable.

Issues are stored in `issues/<ID>.yaml`.

## Validating a version

### The demo's validations

**Validation** view: the panel lists the repository's versions and the state of their validation.

- **VAL-0001** *Validation 1.0*, on LLV-0001: signed by Marc Dubois. All requirements are
  *Conforme*, except PRD-0010 and SYS-0013 (*Hors scope*: remote control comes in 2.0) and SYS-0004
  (*Dérogation*: partial coverage accepted, endurance postponed).
- **VMOT-0001** *Validation 1.2.4*, in `comp-moteur`, on MOTV-0001: signed. MOT-0004 is a
  *Dérogation* (cut-off at 14 µs), MOT-0007 *Hors scope*.
- **VAL-0002** *Validation 2.0*, on LLV-0002: in progress. The 1.0 decisions are carried over,
  except for the requirements impacted by the 2.0 (PRD-0002, SYS-0002, SYS-0004), which are *En
  attente*, like PRD-0010, now in scope. SYS-0013 carries a proposed decision, to be confirmed.
  PRD-0006, modified after its decision, is *To review*.

The possible decisions are the type's: *En attente* (pending), *Conforme* (compliant), *Non
conforme* (non-compliant), *Hors scope* (out of scope), *Dérogation* (waiver). *Non conforme* and
*Dérogation* offer to create an issue.

### Create the validation

On a version of the panel, **Create validation**, give a title (*Validation 1.0* by default).
A version has at most one validation in progress or signed. The decisions of the previous version's
signed validation are **carried over** for the requirements neither changed nor impacted since; the
others start as *pending*.

### Decide, requirement by requirement

The validation's page shows one row per requirement of the component:

- its **Authoring**, **Design** and **Verification** statuses and the **Impact** column (*changed*,
  *impacted*);
- under each requirement, its tests and their executions, with the tested version (*other version*
  flags an execution made on a different version than the one being validated);
- the **Decision** and a **Comment**.

At the top, **Component validations** recalls the validation of each embedded component: VAL-0001's
cites VMOT-0001.

The filter narrows the list: *To decide*, *Proposed*, *To review*, *Changed or impacted*. A decision
becomes *To review* if the requirement is modified or becomes impacted afterwards. A proposed
decision (*Proposed by …*), by an AI agent for example, waits for a human **Confirm** or **Reject**.
A decision that asks for it opens the issue proposal (*Decision to track*).

### Sign

**Sign** is only possible on a **released** version, and when no decision is pending, proposed or to
review any more, and the required fields are filled in; otherwise Polenta lists what is missing
(*Cannot sign yet: …*).

On signing, Polenta freezes for each requirement what the signatory saw: authoring, design,
verification, impact, tests and executions. A link removed or an execution added later no longer
changes the signed validation. The signature saves only the validation's file, with no tag or
baseline. **Cancel validation** lets you start over with a new validation.

The decision of the latest signed validation appears in the **Validation** column of the
Requirements views, with the version's label: *Conforme (1.0)* for PRD-0001. The *Suivi de
conformité* team view shows it next to the other statuses. Signed on the **product** version, it is
the final green light, for example the go for series production.

Validations are stored in `validations/<ID>.yaml`.

> **On your project**
>
> A repository has at most one validation type: the demo's already exists, like its issue type. On
> your project, in *Project › Data model › Structure*, on the repository's row: **+** then **+
> Issue**, or **+** then **+ Validation**. The issue type has its fields (severity, description…)
> and its statuses, and accepts transition constraints ([tutorial 3](03-requirements.md#type-rules)).
> The validation type defines the possible decisions; a decision can be marked to offer creating an
> issue.

## Exercises

**Read an issue born from a failure.**
1. Open ISS-0003: *Origin* and *impacte* sections.
2. Open LLV-0002, **Impact analysis**.

Result: the origin is TSYS-0005's failed execution in CAMP-0003; the issue impacts PRD-0002. In
LLV-0002, PRD-0002 is a starting point of the analysis, *via ISS-0003*.

**Create an issue from a failure.**
1. Make TSYS-0008 fail in CAMP-0002 ([tutorial 4](04-tests-campaigns.md#exercises)), then **Create
   an issue**.
2. In the card (ISS-0004 on a fresh demo), *impacte* section: add SYS-0004.
3. **Change backlog**: include ISS-0004 in LLV-0002.

Result: the issue keeps the execution as its origin, impacts SYS-0004 and appears in LLV-0002's
**Changes**.

**Decide in VAL-0002.**
1. Open VAL-0002, *Proposed* filter: **Confirm** SYS-0013's decision.
2. *To decide* filter: decide PRD-0010 *Conforme*.
3. *To review* filter: take PRD-0006 up again, with a decision and a comment.

Result: the counters go down at each step. Three requirements remain pending: PRD-0002, SYS-0002 and
SYS-0004, impacted by the 2.0.

**Try to sign.**
1. Open VAL-0002, **Sign**.
2. Open VAL-0001 and try to change PRD-0001's decision.

Result: VAL-0002's signature is refused (code `SIGNATURE_REFUSED`): *The version is not released*,
*Pending decisions*. VAL-0001 is frozen: its decisions can no longer be changed (code
`VALIDATION_LOCKED`), and each row shows what was seen at signing.

**See a validation reflected.**
1. Product requirements, *Suivi de conformité* view.
2. Change PRD-0001's statement.

Result: the *Validation* column shows *Conforme (1.0)* for PRD-0001, *Hors scope (1.0)* for
PRD-0010. After the change, PRD-0001 is flagged as having evolved since the decision.

**Read a component's validation.**
1. Open VAL-0001, **Component validations** header.

Result: VMOT-0001 *Validation 1.2.4* is listed, signed, for the motor `1.2.4` embedded in the `1.0`.
