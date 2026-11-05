# 4. Tests and campaigns

**English** | [Français](../tutoriels/04-tests-campagnes.md)

A **test case** describes how to verify one or more requirements. A **campaign** groups tests to be
run together and keeps their results; each result says on which **version** of the product the test
was run.

## Test cases

**Tests** view, type *Lave-linge LL800 / Test Système*. Like requirements, tests are grouped in
sections and listed in a table, with their type's fields: level, estimated duration, destructive
test…

![System tests in table view](../img/test-table.en.png)

Open **TSYS-0001** (*Mesure de la capacité de charge*) and scroll to the bottom of the editor:

![TSYS-0001's links and steps](../img/test-steps.en.png)

- **Links**: TSYS-0001 *verifies* PRD-0001. This link is what makes the requirement covered.
- **Steps**: one action and one expected result per row; **+ Add a step** adds one. The expected
  result of step 1 contains the `{capacite_kg}` parameter: the value is frozen when the test enters
  a campaign.
- **Executions**: the grid of all the test's runs, across all campaigns (see below).

A test can also iterate over requirements: TSYS-0005 (*Vérification des KPI produit*) checks the
`{req.kpi_cible}` of each requirement associated with it, with one instance per requirement in
campaign CAMP-0003.

### Run fields

In the data model, the test type can declare **Run fields** (entered once per run: serial number of
the sample, bench used…) and **Step fields** (entered at each step: measured value…). The **Req. if**
column makes them required depending on the result (`result = FAIL`: describe the deviation). They
appear at execution and in the execution Excel workbook.

## Campaigns

**Campaigns** view. The demo has five, one per project milestone:

![The demo's campaigns](../img/campaigns.en.png)

| Campaign | Status |
|---|---|
| CAMP-0001 EVT | completed |
| CAMP-0002 DVT | in progress |
| CAMP-0003 KPI | in progress |
| CAMP-0004 Endurance | abandoned |
| CAMP-0005 PVT | planned |

Each row shows the campaign's tests and the count of results. **+ New campaign** creates one from
the tests you choose; in the test picker, ⚙️ chooses the displayed columns without losing the
selection. A campaign only contains tests of its own repository.

## A campaign in progress

Open **DVT — Essais de vérification design**:

![DVT campaign](../img/campaign.en.png)

- Parameter values are the ones read when the test entered the campaign: the same measurement
  expects 1200 rpm in the EVT campaign and 1400 rpm in the DVT campaign, created after the value
  changed.
- The orange banner reports an **unresolved parameter reference** in TSYS-0011: an unknown
  component and an empty value. The test can still be run, but the tester is warned.
- Each test shows its result (*Passed*, *Incomplete*, *Pending*), **View** to read the last
  execution again, **Execute** to run a new one.
- At the bottom, **Close campaign** or **Abandon**.

## Run a test

**Execute** on *TSYS-0008 Détection de balourd*:

![Step-by-step execution of TSYS-0008](../img/campaign-execute.en.png)

1. Read the **preconditions**.
2. Indicate the **Tested version** when the repository declares versions
   ([tutorial 9](09-versions.md)): a version from the list (in progress or released), or **Other
   (free text)…**. The version of the previous run is suggested. **Tested structure** details the
   version of each component and lets you note a deviation (a component mounted in a different
   version than planned).
3. For each step, choose the result (*Passed*, *Failed*, *Blocked*, *Skipped*), fill in the step
   fields, add a comment if needed.
4. Fill in the run fields, choose the **global result** (*Passed*, *Failed*, *Blocked*,
   *Incomplete*) and **Submit result**.

The result is stored in `test-runs/` of the **test's** repository, with a frozen copy of the tested
version and structure: a motor component test run in a product campaign keeps its result in
`comp-moteur`. When a test is run several times, the last execution counts: TSYS-0004, failed in
EVT, passed in DVT.

**On failure**, Polenta offers to track the problem: *Failed execution — do you want to track this
problem in an issue?*, with **Create an issue**, **Link to an existing issue** or **Ignore**
([tutorial 10](10-issues-validation.md)).

## Execution history

At the bottom of a test's card, and of a requirement's, the **Executions** section lists all the
runs: verdict, date, tester, duration, campaign, test version, **tested version**, deviations,
origin (*entered* or *Excel import*)… **Columns** chooses the columns, **Show steps** details each
run. This is the place to answer "on which version was this test run?".

## Outside the tool

At the top of the campaign:

| Button | Use |
|---|---|
| **Export plan** | the test plan, to print or have reviewed |
| **Export report** | the campaign's results |
| **Execution Excel** | **Export execution workbook…** to fill in at the test bench (steps, run fields, tested version), then **Import results…**: a preview separates the rows to import, those in error and those with a warning before the import |
