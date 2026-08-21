## Non-Negotiable Engineering Rules

### Understand Before Changing

* Read all relevant files before making edits.
* Inspect the existing implementation, tests, helpers, conventions, and surrounding code first.
* Do not invent files, APIs, requirements, assumptions, or expected behavior.
* Confirm that every proposed change directly supports the requested task.

### Keep the Scope Strict

* Make the smallest safe change that fully solves the problem.
* Only edit files that are directly related to the task.
* Do not create new files, abstractions, helpers, utilities, or configuration unless they are necessary.
* Do not refactor, clean up, rename, reorganize, or improve unrelated code.
* Do not change APIs, routes, configuration, data formats, or existing behavior unless the task requires it.
* Match the project's existing style, naming, architecture, and patterns.
* Prefer existing helpers and utilities over introducing new ones.
* If strict scope conflicts with correctness (e.g. a correct fix requires touching a file outside the stated scope), stop and flag it rather than silently expanding scope or leaving the task half-fixed.

### No Unrequested Additions

* Do not add new methods, functions, classes, parameters, config options, or exported symbols unless the task explicitly requires them.
* Before adding any new method or function, confirm either: (a) it is actually called somewhere as a result of this change, or (b) the task explicitly asked for a new public API. If neither is true, do not add it.
* Do not add "convenience" overloads, alternate signatures, extra utility methods, or helper abstractions "while you're in there."
* Do not add error handling, logging, retries, or validation for cases outside the task's scope, even if they seem like good practice.
* Do not leave in unused methods, variables, imports, or parameters introduced during the change.
* If an addition beyond the stated scope seems genuinely necessary, stop and flag it for confirmation instead of adding it silently.

### Every Change Must Be Justified

* Every code change must have a clear, task-specific reason.
* Do not add code for hypothetical future use.
* Do not add defensive logic without an identified failure case.
* Do not introduce abstractions unless they reduce necessary duplication or are required by the current task.
* Remove any proposed change that cannot be directly tied to a requirement, bug, test, or verified behavior.
* Comments should explain why something is necessary, not restate what the code does. Do not strip out pre-existing comments that already follow this rule.

### Syntax and Build Verification

* After every edit, the affected file(s) must be parsed, linted, or compiled before the change is considered complete — visual inspection of a diff is not sufficient.
* Run the appropriate syntax/build check for the language and project (e.g. `node --check`, `python -m py_compile`, `tsc --noEmit`, `cargo check`, the project's configured lint/build command).
* For any statement spanning or touched by an edit — string concatenation, template literals, multi-line strings — re-read the full statement afterward to confirm quotes, escapes, and delimiters are balanced.
* For structured data (JSON, YAML, function argument lists, object/array literals), explicitly verify commas, matching brackets, and correct nesting before finishing.
* Do not mark a task complete if a syntax/build check was skipped or failed. Either fix the error or state plainly in the final response and in `TASK_PROGRESS.md` that verification could not be completed and why.

### Dependencies and Sensitive Files

* Do not add dependencies unless the task cannot be completed safely with the existing stack. If a new dependency seems necessary, stop and ask before adding it rather than deciding unilaterally.
* Do not modify lockfiles unless dependencies were intentionally changed.
* Do not edit secrets, `.env` files, tokens, keys, credentials, or generated sensitive values.
* Preserve all existing authentication, authorization, validation, and security checks.

### Progress Tracking Is Required

* Create a `TASK_PROGRESS.md` file in the repository root to keep track of where the task currently stands.
* Record the task objective and current status.
* List all relevant files inspected.
* List every file created, modified, or deleted.
* Record what has been completed and what still needs to be done.
* Record tests added or updated.
* Record tests run and their results, including syntax/build/lint check output — paste or summarize actual command output, not just a claim that checks passed.
* Record any blockers, unresolved questions, assumptions, limitations, or remaining risks.
* Update the file after every meaningful change and before ending the work session.
* Keep the file concise, factual, and up to date.
* Do not include secrets, tokens, keys, credentials, or other sensitive values.

### Changelog Is Required

* Create a `CHANGELOG.md` file in the repository root if one does not already exist.
* Record completed changes that affect users, integrations, APIs, configuration, data formats, deployment, or documented behavior.
* Group changes under clear version or date headings.
* Categorize entries when appropriate, such as Added, Changed, Fixed, Deprecated, Removed, or Security.
* Write entries in clear language that explains what changed and why it matters.
* Do not include unfinished work, investigation notes, temporary implementation details, or internal progress updates.
* Do not duplicate the contents of `TASK_PROGRESS.md`.
* Update the changelog before completing any task that introduces a changelog-worthy change.
* Do not rewrite or remove existing changelog history unless explicitly asked.

### Testing Is Required

* Identify the relevant test method before or while implementing the change. Confirm the project's actual test runner/command before assuming one (e.g. do not assume `npm test` or `pytest` without checking).
* Add or update tests whenever behavior changes, a bug is fixed, or a new case is supported.
* Test the specific behavior being changed, including relevant edge cases and failure paths.
* Prefer focused tests that prove the requirement rather than broad or unrelated test changes.
* Run the most relevant tests after each meaningful change when practical.
* Run regression tests scoped to the affected module and its direct dependents when the change could affect shared behavior; do not assume a full-suite run is required unless the change is broad or the project's norms call for it.
* Do not weaken, remove, skip, or rewrite failing tests merely to make the suite pass.
* If a test fails, investigate whether the implementation or the test is incorrect before changing either.
* If tests cannot be run, clearly state what was not tested and why.
* Do not claim that code works unless it was tested or the limitation is explicitly stated.

### Git and Repository Safety

* Do not commit unless explicitly asked. Leave changes staged or in the working tree, uncommitted, until asked to commit.
* Do not rewrite, reset, rebase, or otherwise change git history.
* Do not discard existing user changes.
* Do not modify generated files unless the task specifically requires regeneration.
* Never add Co-Authored-By or any AI attribution lines.
* Never add Claude attribution to PR descriptions.
* Commit message format: [type]: [description]

### Failure Handling

* If a change breaks existing behavior or tests mid-task, stop and assess before proceeding further — do not layer additional changes on top of a known-broken state.
* Prefer fixing forward when the cause is understood and the fix is within scope; revert the specific change when the cause is unclear or the fix would expand scope.
* Record the failure, its cause (if known), and the resolution in `TASK_PROGRESS.md`.

### Pre-Completion Checklist

Before finalizing any change, confirm all of the following:

* [ ] Every changed file parses/compiles/lints with no errors
* [ ] Every string, bracket, and delimiter in changed lines is balanced
* [ ] No method, function, class, or symbol was added that isn't directly used or explicitly requested
* [ ] No unrelated files were touched
* [ ] No new dependencies were added without flagging them first
* [ ] Tests were run and results recorded, including actual command output
* [ ] `TASK_PROGRESS.md` and `CHANGELOG.md` (if applicable) are up to date

### Final Response Requirements

The final response must include:

* What changed and why.
* Every file changed.
* Tests added or updated.
* Tests run and their results, including syntax/build verification.
* Anything not tested or not completed.
* Any assumptions, limitations, or remaining risks.
* Confirmation that `TASK_PROGRESS.md` is up to date.
* Confirmation that `CHANGELOG.md` was updated when required.