# Documentation structure

This directory contains public product documentation. Private working memory,
task records, review reports and launch preparation belong in `context/`, which
is excluded from the public release by `scripts/release-sync.sh`.

## Tracked

| Path | Purpose |
|---|---|
| `docs/STRUCTURE.md` | This directory map. |
| `docs/spec/` | Normative product specifications; `docs/spec/overview.md` indexes every topic and defines global invariants. |
| `docs/tech-spec.md` | Stack, infrastructure and deployment topology; complements `SETUP.md`. |

## Related entry points

- [Product specification index](spec/overview.md)
- [Technical specification](tech-spec.md)
- [Deployment guide](../SETUP.md)
- [Agent conventions and private working-memory layout](../CLAUDE.md)

## Maintenance

Update this map when adding or moving a documentation category. Add or remove
topic entries in `docs/spec/overview.md` when the topic inventory changes.
Tasks and plans use `context/tasks/` and `context/plan.yaml`; do not create a
second copy under `docs/`. Current documents contain current facts and actionable guidance. Historical
narrative belongs in history, not in active task briefs or navigation.
