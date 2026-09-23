# Agent Note: Root README search discovery

Status: implemented

## Problem

The root README introduces the project after image badges and uses a long promotional paragraph. Readers looking for DSH plugins, themes, remote access, or a desktop app need a concise description and direct entry points.

## Decision

Both root READMEs put a factual project summary before the banner, name plugins and themes in the title, and provide a use-case table linking to owning documentation. Image alternative text identifies the product and interface. Existing section anchors and installation commands remain unchanged.

The [feature-focus decision](2026-09-10-root-readme-feature-focus-and-desktop.md) remains in force: this is a presentation refinement, not a change to featured capabilities or asset ownership.

## Alternatives considered

Keyword lists and repeated promotional claims were rejected in favor of readable descriptions of actual features. HTML metadata and structured-data scripts were excluded because repository Markdown does not control GitHub page metadata.

## Consequences

Chinese remains README.md and English remains README.en.md. Root documents are outside the package pairing generator, so validation must explicitly compare their structure and check local links and anchors. This improves content clarity; search indexing and ranking remain external outcomes, not verified results.
