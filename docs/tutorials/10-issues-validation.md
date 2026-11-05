# 10. Issues and validation

**English** | [Français](../tutoriels/10-issues-validation.md)

An **issue** tracks a problem or a change that the requirements do not describe: a bug, a
non-conformity, a test finding. A **validation** is quality's decision, requirement by requirement,
on a delivered version — up to the final green light of the product version.

Like versions, neither issues nor validations are declared in the demo: add the types as shown
below, after following [tutorial 9](09-versions.md).

## Issues

### Declare an issue type

*Project › Data model › Structure*, on the repository's row: **+** then **+ Issue**. The type has
its fields (severity, description…) and its statuses, like a requirement type, and accepts the same
transition constraints ([tutorial 3](03-requirements.md#type-rules)).

### Create and follow an issue

**Issues** view: the same table and document views as for requirements, with the edit card. An issue
is created in three ways:

- from the view, like any item;
- **after a failed execution**: Polenta offers *Create an issue*, *Link to an existing issue* or
  *Ignore*; the issue keeps the execution as its origin ([tutorial 4](04-tests-campaigns.md));
  importing an execution Excel workbook offers it too for the imported failures;
- **from a validation decision** that asks for it (*Decision to track*, below).

In the card, the **impacte** (impacts) link section connects the issue to the requirements it
touches, in the same component. These requirements become starting points of the impact analysis
when the issue enters a version: an issue is included in a version like a requirement or a test,
through the backlog. An issue has no approval lock: it stays editable.

Issues are stored in `issues/<ID>.yaml`.

## Validating a version

### Declare a validation type

On the repository's row, **+** then **+ Validation**. The type defines the possible **decisions**;
by default: *En attente* (pending), *Conforme* (compliant), *Non conforme* (non-compliant), *Hors
scope* (out of scope), *Dérogation* (waiver). A decision can be marked to offer creating an issue
(non-compliant, for example).

### Create the validation

**Validation** view: the panel lists the repository's versions and the state of their validation. On
a version, **Create validation**, give a title (*Validation 1.0* by default).

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

The filter narrows the list: *To decide*, *Proposed*, *To review*, *Changed or impacted*. A decision
becomes *To review* if the requirement is modified or becomes impacted afterwards. A decision
proposed by an AI agent (*Proposed by …*) waits for a human **Confirm** or **Reject**. A decision
that asks for it opens the issue proposal (*Decision to track*).

### Sign

**Sign** is only possible on a **released** version, and when no decision is pending, proposed or to
review any more, and the required fields are filled in; otherwise Polenta lists what is missing
(*Cannot sign yet: …*).

On signing, Polenta freezes for each requirement what the signatory saw: authoring, design,
verification, impact, tests and executions. A link removed or an execution added later no longer
changes the signed validation. The signature saves only the validation's file, with no tag or
baseline. **Cancel validation** lets you start over with a new validation.

The decision of the latest signed validation appears in the **Validation** column of the
Requirements views, with the version's label: *Conforme (1.0)*. Signed on the **product** version,
it is the final green light, for example the go for series production.

Validations are stored in `validations/<ID>.yaml`.
