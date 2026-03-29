# Pre-PR Review

Run security and QA checks before opening a pull request. Launch both agents in parallel.

## Instructions

Run the following two agents simultaneously against the current branch's changes:

1. **cyber-shadow** — review all changed files for security vulnerabilities (auth, injection, secrets, input validation, Firestore rules)
2. **qa-test-engineer** — review test coverage, check for missing tests on new logic, verify build passes, run `npm run lint` and diff new errors vs base branch (new errors = blocking)

Use the Agent tool to launch both in parallel. Pass the current branch name and a summary of what changed.

## After both complete

- If either agent returns **blocking findings**: fix them before opening the PR
- If findings are **non-blocking** (warnings/suggestions): include them in the PR description under a "Known Issues" section
- Once both agents return clean or non-blocking results: open the PR

## Do not skip this

This check is mandatory per CLAUDE.md. If you are about to call `gh pr create`, run `/pre-pr` first.
