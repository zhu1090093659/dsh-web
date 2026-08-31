# Agent Note: banner rebuild and social preview refresh

Status: implemented

## Problem

The README H1 still read "dsh-web · DSH Web UI" and the committed banner (docs/dsh-web-banner.png) still showed the old product name "dsh-web-ui", "DSH Web UI", and chips for removed or renamed features (live token stats, skin center). The banner PNG had no matching source: scripts/banner/banner.html produced a different, older design, so the committed image could not be regenerated or edited reproducibly. The GitHub social preview was a separately uploaded copy of the same stale image.

## Decision

- Root README pair H1 renamed: "dsh-web · DSH Web 插件聚合生态包" / "dsh-web · Aggregate Plugin Ecosystem for DSH Web".
- scripts/banner/banner.html rewritten to reproduce the whale-girl design in-repo: the blue-fantasy skin artwork (packages/skins/skin-center/skins/blue-fantasy/assets/whale-art.jpg) as the dimmed backdrop, brand block on the left (eyebrow "The Plugin Ecosystem for DeepSeek Harness", title "dsh-web", subtitle "DSH Web 插件聚合生态包", single-row chips listing current features: task board, Git graph, right panel, mobile remote, whale-girl pet, skins, workshop), and a chibi pet sticker cut from the dsh-pet whale spritesheet cell 0,0 with a CSS drop-shadow outline.
- scripts/banner/shoot.mjs now renders two outputs: docs/dsh-web-banner.png (1280x400, README) and docs/dsh-web-social.jpg (1280x640, JPEG to stay under the 1 MB GitHub limit, GitHub social preview dimensions).
- The GitHub social preview must be replaced with docs/dsh-web-social.jpg in the repository settings; the upload was attempted through ego-browser but the browser wedged on the native file dialog, so the final upload step is manual.

## Alternatives considered

- Regenerating the banner with an image model to edit text in place: rejected; text rendering is unreliable and the source-template mismatch in the repo would persist.
- Keeping the old browser-mockup banner.html and only swapping its strings: rejected; it produces a different design than the banner users actually see, which is the whale-girl artwork.

## Consequences

- The banner is reproducible again: edit banner.html, run node scripts/banner/shoot.mjs, commit both PNGs.
- The chips row is the only place listing features in image form; update it when the headline feature set changes.
- Follow-up: upload docs/dsh-web-social.jpg in GitHub repo settings (social preview), then the old "dsh-web-ui" image stops serving.
