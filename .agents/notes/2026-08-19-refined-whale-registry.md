# Refined whale registry integration

## Decision

Ship the refined whale-girl artwork as the `whale-girl-refined` built-in entry of `@linxin666/dsh-pet`. The existing `whale-girl` entry remains the default and is labeled as the original variant in the selector.

## Constraints

- Pet selection stays inside the existing registry and `pet` settings namespace.
- The contribution adds no second host service, browser mount, persistence file, API family, or profile patch writer.
- Existing loopback route fencing and `mountOnce` ownership remain the only security and lifecycle paths.
- Installing `@linxin666/dsh-pet` alone provides both variants; the settings selector is populated from `/api/pet/pets`.

## Source record

The refined atlas is an AI-assisted derivative based on the whale-girl design direction. Its DreamSkin reference, original project link, and historical source record are documented in the package README pair.
