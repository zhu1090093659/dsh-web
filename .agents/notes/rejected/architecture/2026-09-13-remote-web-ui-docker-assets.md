# Agent Note: No container assets for the remote web UI plugin

Status: rejected — the plugin is not a standalone service and this repository cannot verify container artifacts

## Problem

Issue #1538 asked for a `Dockerfile` and `docker-compose.yml` so the remote web UI plugin could be deployed locally or on a server.

## Decision

The repository ships no container assets. `dsh-remote-web-ui` is a Cordis plugin that only runs inside the official `@deepseek-ai/dsh` host, so a container image packages the upstream host rather than this plugin. The reporter received a working recipe (official host, `dsh plugin --profile web add`, `dsh web --host 0.0.0.0`) in the issue, which was then closed.

## Alternatives considered

Committing a Dockerfile at the repository root was rejected: the layout rules restrict top-level directories, and it would put upstream host packaging under this repository's maintenance.

Committing the same recipe inside the package was rejected as well: neither CI nor the development machine has Docker, so the artifact could not be built or exercised, and an unverified image definition pinned to a moving upstream decays silently.

Documenting the recipe in the package README stays open. If the maintainer wants a container path in-tree, it belongs in the remote-access documentation with an explicit statement that the container route is community-supported.
