/**
 * dsh-multi-pet — patch-only DSH Web bundle.
 *
 * The whole plugin is the `cordis.patch.yml` in the package root: an
 * id-targeted patch that gives the built-in `pet` entry an entry-local
 * isolate realm so its `pet` service no longer collides with third-party
 * pet providers (e.g. whale-girl) that register the same service on the
 * root realm.
 *
 * This module exists to satisfy the standard bundle shape; it is never
 * imported, because the patch inserts no row that references this package.
 */
export const name = 'dsh-multi-pet'

export default function apply() {}
