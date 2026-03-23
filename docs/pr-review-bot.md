# PR Review Bot

Automated code review on every pull request targeting `main`, powered by Claude.

## How it works

1. When a PR is opened or updated, the workflow generates a git diff of the changes.
2. The diff is sent to the Claude API (model: `claude-sonnet-4-6`) with a prompt tailored to the First Whistle codebase.
3. Claude reviews for bugs, security issues, UX regressions, Firebase best practices, and TypeScript type safety.
4. The review is posted as a comment on the PR.

The review is informational — it does not block merging.

## Required GitHub secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | How to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no setup needed.

## Notes

- Diffs larger than 8,000 characters are truncated before being sent to the API.
- If the API call fails, the workflow logs the error but does not fail the PR check (`continue-on-error: true`).
