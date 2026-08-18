---
name: dsh-web-ui-documentation
description: Use when adding or editing dsh-web-ui README files, docs, AGENTS.md instructions, user-facing configuration text, or bilingual documentation pairs.
whenToUse: A dsh-web-ui task changes documentation, instructions, README content, configuration guidance, or public behavior that must be documented.
user-invocable: true
---

# Documenting dsh-web-ui

Documentation describes current behavior and is part of the shipped interface. Read [docs/AGENTS.md](../../../docs/AGENTS.md) before writing; it is the source of truth for document placement, structure, and bilingual pairing.

## Keep ownership clear

- Put repository-wide rules in [AGENTS.md](../../../AGENTS.md), package-wide rules in [packages/AGENTS.md](../../../packages/AGENTS.md), package-specific behavior in the owning README, and enduring cross-package process in `docs/`.
- Keep one fact in its owning document and link to it elsewhere. Put temporary handoffs and validation snapshots in `docs/archive/`, not long-lived documentation.
- Describe behavior, prerequisites, configuration, failure modes, limitations, and security consequences that users or maintainers need. Do not preserve a change narrative in current-state documents.

## Maintain bilingual README pairs

For an in-scope package README change, update all three files together:

```text
README.md
README.zh.md
README.i18n.yaml
```

Keep headings, lists, tables, links, code blocks, and both language-switcher lines structurally aligned. Re-record only after both language versions accurately describe the same behavior:

```sh
pnpm docs:write-pair <owning-package-or-skin-directory>
pnpm docs:check
```

## Verify the written result

Use real paths and commands, keep paragraphs on one physical line, avoid emoji, and verify all Markdown links. When visible UI text changes, exercise the corresponding behavior or state why no runnable surface exists.
