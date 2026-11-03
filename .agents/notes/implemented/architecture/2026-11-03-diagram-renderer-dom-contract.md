# Agent Note: diagram rendering rides the markdown renderer's DOM

Status: implemented

## Problem

The official markdown renderer (\`ui-primitives\` \`MarkdownText\`) has no code-block
extension seam: a fenced \`\`\`mermaid block is highlighted like an unknown language
(plain text) and rendered as an ordinary code block with a copy button. The family's own
mermaid rendering lived in \`dsh-aionui-panel\` and left the repository with that package, so
the architecture document's eight mermaid diagrams — and any mermaid a user pastes into a
chat — had no rendering path at all.

Math is a different story and stayed out of scope: the renderer already ships KaTeX with the
dollar and backslash delimiters (\`micromark-extension-math\` plus a compatibility extension), so
re-implementing it would only fight the host.

## Decision

- **A new package, \`dsh-diagrams\`, renders mermaid fences in place.** It covers the chat
  transcript and the document preview panel from one observer, because both surfaces render
  through the same component.
- **The integration point is the rendered DOM.** A page-side observer watches
  \`document.body\`, maps each mutation batch to the owning \`div.md-code-block\`, and reads the
  fence language from the banner's infostring element. The names are pinned in one module
  (\`src/core/contract.ts\`) with a test beside them.
- **The original block is hidden, never removed.** The renderer's copy button keeps reading
  the source from the \`<pre>\`; a failed render restores the block exactly.
- **The runtime is served by the package, fetched on demand.** The host half owns one
  read-only route (\`/api/dsh-diagrams/vendor/mermaid.js\`, behind the shared pairing fence)
  that serves the mermaid IIFE the build copies out of the npm package into
  \`lib/assets/\`. Pages without a mermaid block download nothing.
- **Rendered SVG is sanitized twice.** Mermaid runs at \`securityLevel: 'strict'\` and the
  output still goes through a strip pass (elements, \`on*\` attributes, \`javascript:\` URLs);
  markup that stays suspicious is rejected and the fence falls back to a code block.
- **Theme flips re-render.** Mermaid paints colors into the SVG, so a light/dark switch
  re-renders each finished diagram from its stored source.

## Alternatives considered

- **Patch or extend the host's renderer.** Impossible by rule and by design: the host is not
  this repository, and the browser halves of the family may only type-import host client
  modules — there is no seam to register a code-block renderer through.
- **Ship our own markdown renderer for these surfaces.** Rejected: it would duplicate the
  host's renderer (tables, footnotes, math, streaming) to gain one fence language.
- **Bundle mermaid into the client artifact.** Rejected: the library is roughly 2–3 MB
  minified; every page would pay it even when no diagram is present.
- **Load mermaid from a CDN.** Rejected: the desktop client is expected to work offline, and
  a third-party origin in the page contradicts the family's same-origin stance.
- **Extend the package to other diagram DSLs now.** Deferred: the user scoped this change to
  mermaid; the observer and the renderer table are the places a second DSL would attach.

## Consequences

- **The DOM hooks are not a contract.** A host release that renames \`md-code-block\` or the
  infostring class stops diagram rendering; fences simply stay code blocks. The pinned
  constants and their test are what turn that into a visible failure during an SDK cohort
  bump rather than a silent regression.
- **Streaming fences render late.** An unclosed fence cannot be parsed; the block is retried
  on the next mutation and the diagram appears once the fence closes.
- **The family row carries its own display metadata.** The aggregate's \`shellNotes\` section
  covers family sub-paths (the tombstoned compatibility shells); a row that mounts a real
  package gets its title and purpose from that package's \`locale/{en,zh}.json\`, which this
  package therefore ships.
- **The vendored runtime is a build artifact.** \`lib/assets/mermaid.min.js\` is copied by
  tsdown, never committed; a build that skips it degrades to 404 plus plain code blocks.
- Adding a second diagram DSL means a second entry in the renderer table, not a second
  observer.

## Testing

\`pnpm --filter @linxin666/dsh-client-ui-diagrams typecheck\` and \`test\` (21 cases: block
discovery, claim/restore, SVG sanitizing, observer render + failure fallback + theme
re-render, mutation scoping, the vendor route's 200/403/404/405/HEAD paths, and the contract
pins). A live check needs the package mounted (a host restart), so it is handed to the user
rather than claimed here.
