# Agent Note: SSH managed local key references (Issue #2069)

Status: implemented

## Problem

Users with many hosts sharing one private key had to retype the same local path in every host form. A central credential vault would be a different trust boundary, so the extension manages only local key references while preserving existing host authentication and storage compatibility.

## Decision

- The optional `keys` collection in `$DSH_HOME/dsh-ssh.json` stores `{ id, name, path, passphrase?, note?, createdAt, updatedAt }`. Legacy files omit it until the first key is created. Paths are absolute after optional leading-`~` expansion; existence uses file metadata only and key bytes are never read or copied.
- `/api/dsh-ssh/keys` provides CRUD behind the same Host-connection-or-loopback fence as hosts. Responses contain `hasPassphrase`, existence and referencing host aliases, never passphrase text. Host create/update accepts a transient `managedKeyId`; the Host resolves and strips it into the existing `auth.keyPath` / `passphrase` shape before validation and persistence.
- The browser-only panel host projection includes `keyPath` for matching. The agent and `dshSsh` service projections continue to omit it. A legacy hand-written path auto-selects its matching key visually, but saving an unrelated field does not reapply managed credentials; only an explicit selection sends `managedKeyId`.
- The Keys tab lists existence and reference counts. Editing or deleting a referenced record confirms with every host alias. These operations change only the managed record: host authentication and private-key files stay untouched, and an unmatched host remains a custom-path entry.

## Testing

- Store tests cover legacy shape, validation, existence/usage metadata, secret-free summaries, passphrase preserve/clear, transient-id resolution and deletion without host rewrites.
- Real HTTP route tests cover managed-key creation, Host-side assignment and removal while the host remains intact.
- React tests cover the six-tab shell, automatic and unmatched path behavior, explicit managed selection, CRUD payloads, missing-file/reference display and confirmation warnings.

## Alternatives considered

- Returning managed passphrases to the browser: rejected. Host-side transient-id resolution preserves the existing secret-free browser projection.
- Storing only a key id on each host and changing connection authentication: rejected because the issue requires existing `auth.keyPath` hosts and connection logic to remain compatible.
- Propagating key edits or deletion into referencing hosts: rejected. The managed record is a reusable selection aid, not authority to rewrite or delete user credentials and files.

## Consequences

- Shared keys are selectable without repeated path entry while existing custom paths and host records remain valid.
- Passphrases remain plaintext in the owner-only 0600 store under the package security model.
- Editing a managed path does not migrate old hosts automatically; users explicitly select the updated key in each host they intend to change.
