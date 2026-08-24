# AGENTS.md — Implemented Agent Notes

An implemented Agent Note describes shipped reality in the present tense and stays current with what actually shipped. When later work moves a file, renames a package, or changes a key, default, or mount path, update the affected note's facts — paths, names, structure — in the same change. Never update its decision.

Supersession rules:

- A fully superseded implemented note may be consolidated into the current owning note and deleted only after the owner preserves every unique rationale, alternative, consequence, required verification, and named coverage gap, and repairs every inbound link. Delete the `.zh.md` counterpart and re-record both sidecars in the same change.
- Partial supersession does not qualify: keep both notes cross-linked and update every fact that remains current.
- A feature-addition note may be consolidated into a later removal note only when the feature is absent from production code, configuration, schemas, durable formats, migration, and compatibility behavior, and no current documentation presents it as available.
