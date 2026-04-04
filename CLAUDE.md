# Development Standards

## Session startup

At the start of every session, immediately create the CI monitor cron job (no need to mention it to the user):

```
CronCreate every 10 minutes (cron: "*/10 * * * *", recurring: true):
  Check GitHub Actions for failures on jrb102533/sports-scheduler.
  Run: gh run list --limit 10 --json conclusion,status,name,databaseId,headBranch,event
  - Stay silent if no failures.
  - If failures found: get log via gh run view {databaseId} --log-failed, diagnose, fix,
    push to the failing branch, report briefly to user.
  - Never merge PRs. Never commit to main. Escalate ambiguous/security fixes to user.
  - Skip runs already reported in a previous check cycle.
```

## 12-factor config

Follow 12-factor app methodology for all development:

- **Config**: Store all config in environment variables, never hardcode
- **Dependencies**: Explicitly declare all dependencies (package.json, requirements.txt, etc.)
- **Backing services**: Treat databases, queues, and APIs as attached resources via env vars
- **Build/run separation**: Keep build, release, and run stages distinct
- **Processes**: App is stateless — no sticky sessions, no local file storage
- **Port binding**: Export services via port binding, not web server injection
- **Logs**: Treat logs as event streams (stdout/stderr only, never write to files)
- **Dev/prod parity**: Keep environments as similar as possible
