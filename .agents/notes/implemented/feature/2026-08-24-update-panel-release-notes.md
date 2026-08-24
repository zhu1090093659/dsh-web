# Agent Note: Human-readable update release notes

Status: implemented

## Problem

The remote-web-ui auto-update panel showed every registry-managed family component as a long `@linxin666/dsh-*` package-name plus version row. That is technically precise but not useful to a user deciding whether to start an upgrade; the project already publishes GitHub Releases with grouped feature/fix/other notes.

## Decision

The update status now carries structured release notes fetched from the target GitHub Release (`zhu1090093659/dsh-web`), parsed into New Features / Bug Fixes / Other Changes. The panel renders those sections by default and keeps the exact component-version list in a collapsed details block for users who want the precise package mapping. Registry failures still fall back to the package list, and the host caches the GitHub response for ten minutes so the silent sidebar probe and panel-open check do not repeatedly hit the GitHub API.

## Alternatives considered

- Keeping only the package list: rejected because version-only rows do not explain what changed.
- Rendering the raw Markdown body: rejected without a Markdown renderer; the panel stays dependency-free and uses plain-text bullets.
- Fetching notes only on panel open: rejected as an unnecessary split of the status endpoint; the host cache already limits repeated calls.

## Consequences

- Default upgrade UX is now release-note-first; component versions remain one click away for diagnostics.
- When GitHub is unreachable or the release has not been published yet, the panel gracefully falls back to the existing package list.
- The update flow, pnpm verification, and loopback-only security fence are unchanged.
