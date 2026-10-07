# Documentation

These guides describe the source in this checkout, which may be ahead of npm.
See the [changelog](../CHANGELOG.md) for version boundaries and the
[release guide](releasing.md) for upgrade steps and publication status checks.
The public documentation website is maintained independently in a separate
private repository. The legacy `site/` app remains here for integration tests.

## Using Goribu

- [Getting started](getting-started.md) and [installation reference](installation.md).
- [Routing](routing.md), [rendering](rendering.md), [static routes](static-routes.md), and
  [Worker routing](worker-routing.md).
- [Handlers](handlers.md), [middleware](middleware.md), and [errors](errors.md).
- [Navigation](navigation.md), [forms](forms.md), and [metadata](metadata.md).
- [TypeScript](typescript.md) and [environment variables](environment-variables.md).
- [D1](d1.md), [migrations](migrations.md), [KV](kv.md), and [R2](r2.md) (unreleased; live checkpoint reviewed).
- [Cache](cache.md) — request-scoped JSON caching (unreleased).
- [CLI](cli.md) and [deployment](deploy.md).

## Contributor references

[Contributing](../CONTRIBUTING.md) explains local setup and validation.
[Testing](testing.md) explains the fast and full suites and test isolation.
[Decisions](decisions.md) records design choices in order; later entries may
explicitly supersede earlier ones. The [R2 live checkpoint](r2-live-checkpoint.md)
records completed live checks and explicitly accepted untested account scenarios.

Historical block writeups and implementation reviews are archived locally and
are not part of a fresh clone. Current guides, decisions, and tests contain the
information needed to work on the framework.
