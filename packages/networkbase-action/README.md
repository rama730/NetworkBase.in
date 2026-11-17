# NetworkBase for GitHub Actions

Push build output to a NetworkBase task, or finish the task a merged pull request closes. It runs the published
`@networkbase/cli` with a workspace's personal access token.

```yaml
# Finish the task when its pull request merges ("Closes #4" in the pull request, or a branch nb/4-…)
on:
  pull_request:
    types: [closed]
jobs:
  networkbase:
    runs-on: ubuntu-latest
    steps:
      - uses: networkbase/action@v1
        with:
          token: ${{ secrets.NETWORKBASE_TOKEN }}
          workspace: design-lab
          action: done
```

```yaml
# Send the build to task 4 as a draft
- uses: networkbase/action@v1
  with:
    token: ${{ secrets.NETWORKBASE_TOKEN }}
    workspace: design-lab
    action: push
    task: 4
    paths: dist/report.pdf dist/site.zip
```
