export function createSnapshotStore(init: unknown) { return { get: () => init, set: () => {}, subscribe: () => () => {} } }
