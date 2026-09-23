# Agent Note: Business test discipline as machine-enforced gates

Status: implemented

## Problem

The suite is large (about 4,400 tests in 406 files) and its quality rules lived only in review conventions: 113 arbitrary waits across 58 files, 161 ad-hoc mock or spy sites across 31 files, 3,991 tests whose titles do not name the role under test, no test body carrying an explicit Given/When/Then structure, and 712 assertion-quality defects (call-count-only tests and tautological assertions). Nothing mechanical prevented the next one, so each review had to re-argue the same points.

Three gates that already existed were also incomplete. The bilingual dictionary gate (pnpm i18n:check, unit-tested in scripts/i18n-audit.test.mjs and required by the root instructions before merging) was referenced by no workflow at all, so it only ran when a contributor remembered it. The emoji rule was an inline Python heredoc in ci.yml: correct, but untested, with no unit tests, unable to run locally through a repository script, and reporting a character offset where a line and column were meant. And the repository had no coverage measurement whatsoever, so no change could be told apart from a change that deleted evidence.

## Decision

- scripts/test-standards.mjs is the business test-discipline gate. It enforces six rules on every test file: no-arbitrary-sleep, no-ad-hoc-mock, bdd-title, given-when-then, call-count-only-assertion and tautological-assertion. Each rule and its rationale are documented in the script header, so the gate explains itself at the point of failure.
- The gate scans three parallel views of each source (raw, comment-blanked with string contents kept, and fully masked), so a fixture string containing setTimeout( or a parenthesis inside a test title can neither hide a violation nor desync block matching.
- Existing violations are grandfathered per file and per rule in scripts/test-standards-baseline.json (367 files, 8,968 recorded violations). A new test file starts from a zero baseline and is held to every rule; an existing file may not gain violations; a file whose count drops is reported so the baseline ratchets down with pnpm test:standards:write.
- Rule scope follows the lane: business-behavior tests under packages/, tests/ and desktop/ carry the full contract, while scripts/ holds repository tooling whose tests are plain unit tests of pure functions and therefore only carry the mechanical rules.
- A documented exception uses a "test-standards-allow: <reason>" marker, trailing on the physical line or in the file leading comment block, mirroring the existing i18n-allow convention.
- scripts/emoji-audit.mjs replaces the inline Python emoji step with a reviewed, unit-tested Node gate that runs locally as pnpm emoji:check. It keeps the same code-point ranges and out-of-scope trees, reports file:line:column instead of a character offset, and skips anything that is not strict UTF-8, so an untracked media render or package tarball in a working tree cannot fail it.
- scripts/coverage-gate.mjs is the coverage ratchet. It runs vitest coverage for every plugin package and records lines, statements, functions and branches per package in scripts/coverage-baseline.json; a metric more than half a percentage point below its recorded value fails the gate, because instrumentation is not bit-stable (two identical fleet runs differed by 0.04 points on one package). The coverage provider is declared per vitest major: the six 3.x packages carry @vitest/coverage-v8@^3.2.7, and the root devDependency serves every 4.x package through Node resolution.
- ci.yml now runs the missing pnpm i18n:check, the new pnpm test:standards, and pnpm emoji:check in place of the Python heredoc.
- .github/workflows/nightly.yml is the Tier-2 lane: the coverage ratchet plus three consecutive full-suite runs, which is what distinguishes a consistently broken test from a flake.
- docs/development.md owns the test rules, the baseline mechanics, the tiering, and the failure-path audit checklist; the root instructions list the new commands and require pnpm test:standards before merging.

## Alternatives considered

- Enforce all six rules on the whole corpus with no baseline. It would demand rewriting 3,991 test titles and every test body in one change, or the gate would be red forever; incremental enforcement is what makes the rule real today.
- Match violations by line-content fingerprint or by changed diff lines. Fingerprints churn on every reorder or formatter run, and diff-based enforcement makes the local and CI semantics diverge; per-file, per-rule counts are stable and run identically everywhere.
- Express the rules as ESLint rules (for example a vitest plugin). The repository has no ESLint toolchain; adding one across 23 packages is a larger change than the six rules need, and the established pattern here is a reviewed script under scripts/ with node:test unit tests, as scripts/i18n-audit.mjs, scripts/verify-docs.mjs and scripts/lib-artifact-check.mjs already do.
- Make the rules advisory and report-only. The failure being fixed is review pressure; an advisory report is exactly what gets ignored.
- Run the coverage ratchet on every pull request. It re-runs the entire suite under instrumentation (65.6 seconds locally on ten cores), while the pull-request lane already runs the suite once; the ratchet is Tier-2 work, run nightly and on demand.
- Add impact-based test selection to the pull-request lane. Measured on ten cores, the full monorepo suite is 43.6 seconds and the full typecheck is 27.2 seconds, so the lane wall clock is dominated by install and build; an affected-package graph would add a mapping layer to maintain for a few seconds.
- Add a live dsh-market.com contract check to Tier 2. The Workshop client and the market worker ship from this repository and deploy together, so a live shape check mostly re-tests our own deployment; the genuinely independent dependencies are the pinned @deepseek-ai SDK cohort and the npm registry, already covered by runtime-deps:check and the release-time registry verification.
- Declare @vitest/coverage-v8 in all 23 manifests. Only the six 3.x packages need their own declaration, because the root devDependency already resolves for every 4.x package; the extra 17 entries would be pure maintenance surface.

## Consequences

- A test added or changed under packages/, tests/ or desktop/ must start with a role keyword and name its precondition, action and outcome, or the pull request is red. The mechanical rules bind every test file, including the tooling lane.
- The baseline is a debt ledger, not a target: 367 files and 8,968 recorded violations. Reducing one and re-recording with pnpm test:standards:write is the ratchet; accepting new debt requires the same visible edit in review.
- The coverage baseline holds 21 packages with repository totals of 56.64% lines, 56.14% statements, 69.8% functions and 67.74% branches. The 90% branch target is a direction rather than a current state; the gate's job is to stop the number falling, and the per-package table is the backlog. The weakest branch coverages are dsh-market 56.47%, skin-center 56.99%, dsh-remote-web-ui 58.14%, dsh-preset-center 60.75% and dsh-session-archive 60.65%.
- Pull-request CI gains three steps. Two are text scans over the tree and the third replaces an existing Python step, so the lane cost is a few seconds.
- The nightly lane adds a scheduled workflow with a 30-minute coverage job and a 45-minute flake job. Its first scheduled run is its acceptance run; the workflow is actionlint-clean and both jobs' commands were exercised locally.
- Bumping a package's vitest major now requires bumping its coverage provider in the same change; a mismatched provider fails the nightly gate loudly instead of silently reporting nothing.
- The emoji gate's out-of-scope set now also covers git-ignored local artifacts (coverage, playwright-report, test-results, .codegraph, .zcode, .pnpm-store, .wrangler, gui-test-screenshots), so a working tree that just ran Playwright reports what a clean CI checkout reports.

## Testing

- pnpm test:scripts is green with three new specifications: scripts/test-standards.test.mjs (27 tests over the scanner, test extraction, all six rules, waivers, lane scoping and the baseline diff), scripts/emoji-audit.test.mjs (11 tests over the code-point rule, path scope, line/column reporting and the strict-UTF-8 gate) and scripts/coverage-gate.test.mjs (14 tests over metric extraction, the regression comparison and its epsilon, the weighted total, serialization and package discovery).
- pnpm test:standards passes against the recorded baseline; a probe spec that adds an arbitrary wait and a non-role title fails with three new violation groups and names the offending lines.
- The Node emoji gate and the CI Python snippet it replaces agree on the working tree: both scan the same hand-written sources and report zero violations, after the Node version gained the strict-UTF-8 skip that Python had implicitly through its decode exception.
- pnpm coverage:check ran the full fleet: 21 packages, no package failed to produce coverage, and the baseline was written from that run.
- actionlint passes over .github/workflows including the new nightly.yml; pnpm docs:check and pnpm i18n:check are green.
- Not verified: a real scheduled run of nightly.yml. The scheduled trigger cannot be exercised locally, so its first nightly execution is its acceptance run.
