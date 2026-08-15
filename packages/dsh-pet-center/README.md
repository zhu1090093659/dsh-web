# dsh-pet-center — Pet Center

English | [中文](README.zh.md)

> Switch your companion pet in one click from the settings: the original whale-girl "dsh-pet" and the introduced whale-maid "dsh-pet-maid", with try-on preview and apply.

## Features

| Feature | Description |
|---|---|
| Pet list | Shows the two selectable pets: the original whale-girl (dsh-pet) and the introduced whale-maid (dsh-pet-maid) |
| Try-on preview | Click "Try on" to switch to the target pet and preview it; "Exit try-on" reverts at any time |
| One-click apply | Click "Apply" to persist the choice — it writes the managed section of `~/.dsh/cordis.patch.yml`; the config watcher hot-reloads it within seconds and a page refresh lands on the new pet, no restart |
| Current state | Each pet shows an active / trying-on badge |

## Install

Install together with the family aggregate package `@linxin666/dsh-web-ui-all` (or install `@linxin666/dsh-client-ui-pet-center` alone), then **restart `dsh web`** and open "Settings → Plugins → Web UI Plugins → Pet Center".

## Architecture

```
dsh-pet-center/
|-- src/
|   |-- index.ts        # host half: registers the /api/pet-center/* routes
|   |-- pet-switch.ts   # switches the active pet: rewrites the managed section of ~/.dsh/cordis.patch.yml
|   |-- routes.ts       # /api/pet-center/state + /apply (same-origin fence against CSRF)
|   `-- client/         # browser half
|       |-- index.ts    # registers the pet-center card into the web-ui.plugin.item group
|       |-- PetCenter.tsx   # card UI: list + try-on/apply + status badges
|       |-- locales.ts  # en/zh copy
|       `-- pet-center.module.css
`-- cordis.patch.yml    # bundle patch: inserts the ui-pet-center row
```

## Mechanism

- Both pets are bundle-wired rows of the aggregate (no insert row needed). The active pet is the one the managed section does NOT disable.
- "Apply / Try on" both call the host `/api/pet-center/apply {pet}`, which rewrites the pet managed section of `~/.dsh/cordis.patch.yml` (disabling the other pet); the skin managed section is left untouched.
- The DSH config watcher hot-reloads it within seconds; a page refresh lands on the new pet — mirroring the skin center's switching experience.

## Development

```sh
pnpm --filter @linxin666/dsh-client-ui-pet-center build
pnpm --filter @linxin666/dsh-client-ui-pet-center test
```

## License

[Apache-2.0](LICENSE)
