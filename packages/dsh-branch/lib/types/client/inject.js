import { projectOfficialRows } from "../core/official-rows.js";
import { applySetAt } from "../core/trajectory.js";
import { branchTreeAt, isMainTree, MAIN_TREE, treeByName, withCurrent, } from "../core/trees.js";
import { EMPTY_TRAJECTORY_SNAPSHOT } from "./trajectory-snapshot.js";
import { loadTreeRegistry, saveTreeRegistry } from "./tree-store.js";
import css from './branch.module.css';
const VIEW_SELECTOR = '[data-conversation-composer-overlay]';
const ROW_SELECTOR = 'tr[data-record-index]';
const CELL_MARK = 'data-dsh-branch-cell';
const CHIP_MARK = 'data-dsh-branch-tree';
const NOTICE_MARK = 'data-dsh-branch-notice';
function createState() {
    return {
        sessionId: null,
        cwd: undefined,
        rows: [],
        ops: [],
        registry: loadTreeRegistry(''),
        busy: false,
        pending: null,
        menuOpen: false,
        unbindSession: null,
        observer: null,
        syncTimer: null,
        noticeTimer: null,
    };
}
function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className !== undefined)
        node.className = className;
    for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, value);
    return node;
}
function buttonEl(className, attrs = {}) {
    const node = document.createElement('button');
    node.type = 'button';
    if (className !== undefined)
        node.className = className;
    for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, value);
    return node;
}
/** Line-icon SVGs (stroke-based, inherit currentColor). */
const ROLLBACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';
const BRANCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M6 8.5v7"/><path d="M18 8.5a6 6 0 0 1-6 6H8.5"/></svg>';
/** Start the injector; returns the disposer (registered via ctx.effect). */
export function startBranchInjection(ctx, api, t, sessionIdOf, cwdOf) {
    const state = createState();
    const notice = (kind, text) => {
        if (state.noticeTimer !== null)
            clearTimeout(state.noticeTimer);
        let node = document.querySelector('[' + NOTICE_MARK + ']');
        if (node === null) {
            node = el('div', css.notice + ' ' + (kind === 'error' ? css.noticeError : css.noticeOk), { [NOTICE_MARK]: '' });
            node.style.position = 'fixed';
            node.style.top = '10px';
            node.style.left = '50%';
            node.style.transform = 'translateX(-50%)';
            document.body.appendChild(node);
        }
        else {
            node.className = css.notice + ' ' + (kind === 'error' ? css.noticeError : css.noticeOk);
        }
        node.textContent = text;
        state.noticeTimer = setTimeout(() => { node?.remove(); }, 6000);
    };
    const refreshModel = () => {
        const id = sessionIdOf();
        if (id === undefined) {
            state.sessionId = null;
            state.rows = [];
            state.ops = [];
            syncDom();
            return;
        }
        state.sessionId = id;
        const cwd = cwdOf(id);
        if (cwd !== state.cwd) {
            state.cwd = cwd;
            state.registry = loadTreeRegistry(cwd ?? '');
        }
        const binding = ctx.sessions.binding(id);
        const snapshot = binding?.session.getSnapshot();
        const trajectory = snapshot?.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT;
        const rows = projectOfficialRows({
            nodes: trajectory.eventNodes,
            requests: trajectory.requests,
            partial: trajectory.partial,
            runningCalls: trajectory.runningCalls,
        });
        state.rows = rows;
        state.ops = rows.flatMap(row => row.op === undefined ? [] : [row.op]);
        syncDom();
    };
    const syncSession = () => {
        const id = sessionIdOf();
        if (id === state.sessionId) {
            refreshModel();
            return;
        }
        state.unbindSession?.();
        state.unbindSession = null;
        if (id === undefined) {
            refreshModel();
            return;
        }
        const binding = ctx.sessions.binding(id);
        if (binding === undefined) {
            refreshModel();
            return;
        }
        state.unbindSession = binding.session.subscribe(refreshModel);
        refreshModel();
    };
    const scheduleSync = () => {
        if (state.syncTimer !== null)
            clearTimeout(state.syncTimer);
        state.syncTimer = setTimeout(() => {
            state.syncTimer = null;
            syncDom();
        }, 80);
    };
    const currentMaster = () => isMainTree(state.registry) ? undefined : treeByName(state.registry, state.registry.current);
    const rowOf = (cellIndex) => state.rows.find(row => row.cellIndex === cellIndex);
    const onRowTree = (row) => {
        const master = currentMaster();
        return master !== undefined && master.stateIndex === row.stateIndex;
    };
    const openApply = async (target) => {
        if (state.busy || state.pending !== null)
            return;
        const cwd = state.cwd;
        if (cwd === undefined || cwd === '') {
            notice('error', t('apply.noWorkspace'));
            return;
        }
        const set = applySetAt(state.ops, target.stateIndex);
        if (set.writes.length === 0 && set.deletes.length === 0) {
            notice('ok', t('apply.noChanges') + (set.skipped.length > 0 ? t('apply.partial', { skipped: set.skipped.length }) : ''));
            return;
        }
        state.pending = { target, set, entries: null };
        renderModal();
        const result = await api.preview(cwd, set.writes, set.deletes);
        if (state.pending === null)
            return;
        state.pending = { ...state.pending, entries: result.ok ? [...result.value] : [] };
        renderModal();
        if (!result.ok) {
            notice('error', t('apply.error', { error: result.error.message }));
            state.pending = null;
            renderModal();
        }
    };
    const requestApply = (cellIndex, mode) => {
        if (state.busy || state.pending !== null)
            return;
        const row = rowOf(cellIndex);
        if (row === undefined)
            return;
        if (mode === 'restore') {
            if (isMainTree(state.registry)) {
                notice('ok', t('tree.alreadyOn'));
                return;
            }
            void openApply({
                mode: 'restore',
                stateIndex: state.ops.length,
                cellIndex: -1,
                name: MAIN_TREE,
                created: false,
                treeLabel: t('tree.main'),
                label: t('tree.restoreMain'),
            });
            return;
        }
        if (onRowTree(row)) {
            notice('ok', t('tree.alreadyOn'));
            return;
        }
        const branched = branchTreeAt(state.registry, row.stateIndex, row.cellIndex, row.label, Date.now());
        void openApply({
            mode: 'rollback',
            stateIndex: row.stateIndex,
            cellIndex: row.cellIndex,
            name: branched.tree.name,
            created: branched.created,
            treeLabel: row.label,
            label: row.label + ' · #' + row.cellIndex,
        });
    };
    const requestTreeEntry = (entry) => {
        if (state.busy || state.pending !== null)
            return;
        if (entry.current) {
            notice('ok', t('tree.alreadyOn'));
            return;
        }
        const mode = entry.name === MAIN_TREE ? 'restore' : 'checkout';
        void openApply({
            mode,
            stateIndex: entry.stateIndex,
            cellIndex: entry.cellIndex,
            name: entry.name,
            created: false,
            treeLabel: entry.label,
            label: entry.name === MAIN_TREE ? t('tree.restoreMain') : t('tree.checkout', { name: entry.name }),
        });
    };
    const confirmApply = async () => {
        const pending = state.pending;
        if (pending === null || state.busy)
            return;
        const cwd = state.cwd;
        if (cwd === undefined || cwd === '') {
            notice('error', t('apply.noWorkspace'));
            return;
        }
        state.busy = true;
        syncDom();
        const result = await api.apply(cwd, pending.set.writes, pending.set.deletes);
        state.busy = false;
        if (!result.ok) {
            notice('error', t('apply.error', { error: result.error.message }));
            state.pending = null;
            renderModal();
            syncDom();
            return;
        }
        const target = pending.target;
        let suffix = '';
        if (target.mode === 'rollback') {
            const branched = branchTreeAt(state.registry, target.stateIndex, target.cellIndex, target.treeLabel, Date.now());
            state.registry = withCurrent(branched.registry, branched.tree.name);
            suffix = branched.created
                ? ' · ' + t('tree.created', { name: branched.tree.name })
                : ' · ' + t('tree.switched', { name: branched.tree.name });
        }
        else {
            state.registry = withCurrent(state.registry, target.name);
            suffix = target.name === MAIN_TREE
                ? ' · ' + t('tree.restored')
                : ' · ' + t('tree.switched', { name: target.name });
        }
        saveTreeRegistry(cwd, state.registry);
        state.pending = null;
        renderModal();
        syncDom();
        notice(result.value.failed > 0 ? 'error' : 'ok', t('apply.done', {
            written: result.value.written,
            deleted: result.value.deleted,
            skipped: pending.set.skipped.length,
        })
            + (result.value.failed > 0 ? t('apply.failed', { failed: result.value.failed }) : '')
            + (result.value.failed === 0 ? suffix : ''));
    };
    /* ---------- modal ---------- */
    let overlay = null;
    const closeModal = () => {
        state.pending = null;
        overlay?.remove();
        overlay = null;
    };
    const changeKey = (entry) => {
        if (entry.action === 'create')
            return 'change.create';
        if (entry.action === 'delete')
            return 'change.delete';
        if (entry.action === 'unchanged')
            return 'change.unchanged';
        return 'change.write';
    };
    const changeClass = (entry) => {
        if (entry.action === 'create')
            return css.badgeCreate;
        if (entry.action === 'delete')
            return css.badgeDelete;
        if (entry.action === 'unchanged')
            return css.badgeUnchanged;
        return css.badgeWrite;
    };
    const renderModal = () => {
        overlay?.remove();
        overlay = null;
        const pending = state.pending;
        if (pending === null)
            return;
        const target = pending.target;
        const title = target.mode === 'rollback'
            ? t('modal.rollbackTitle')
            : (target.mode === 'restore' ? t('modal.restoreTitle') : t('modal.checkoutTitle'));
        const confirm = target.mode === 'rollback'
            ? t('modal.confirmRollback')
            : (target.mode === 'restore' ? t('modal.confirmRestore') : t('modal.confirmCheckout'));
        const treeLine = target.mode === 'rollback'
            ? (target.created ? t('tree.rollbackCreate', { name: target.name }) : t('tree.rollbackSwitch', { name: target.name }))
            : (target.name === MAIN_TREE ? t('tree.restoreMain') : t('tree.checkout', { name: target.name }));
        const overlayNode = el('div', css.modalOverlay);
        const card = el('div', css.modalCard);
        const head = el('div', css.modalHead);
        const titleNode = el('span', css.modalTitle);
        titleNode.textContent = title;
        head.appendChild(titleNode);
        const close = buttonEl(css.modalClose, { 'aria-label': t('modal.close') });
        close.textContent = '×';
        close.addEventListener('click', () => { if (!state.busy)
            closeModal(); });
        head.appendChild(close);
        card.appendChild(head);
        const node = el('div', css.modalNode);
        node.textContent = target.label;
        card.appendChild(node);
        const tree = el('div', css.modalTree);
        tree.textContent = treeLine;
        card.appendChild(tree);
        const subtitle = el('div', css.modalSubtitle);
        subtitle.textContent = t('modal.subtitle');
        card.appendChild(subtitle);
        if (pending.entries === null) {
            const loading = el('div', css.modalLoading);
            loading.textContent = t('modal.loading');
            card.appendChild(loading);
        }
        else {
            const list = el('div', css.modalList);
            for (const entry of pending.entries) {
                const row = el('div', css.modalRow);
                const path = el('span', css.modalPath, { title: entry.path });
                path.textContent = entry.path;
                const badge = el('span', css.modalBadge + ' ' + changeClass(entry));
                badge.textContent = t(changeKey(entry));
                row.append(path, badge);
                list.appendChild(row);
            }
            if (pending.set.skipped.length > 0) {
                const skipped = el('div', css.modalSkipped);
                skipped.textContent = t('modal.skipped', { n: pending.set.skipped.length });
                list.appendChild(skipped);
            }
            card.appendChild(list);
        }
        const footer = el('div', css.modalFooter);
        const cancel = buttonEl(css.rowAction);
        cancel.textContent = t('modal.cancel');
        cancel.addEventListener('click', () => { if (!state.busy)
            closeModal(); });
        const ok = buttonEl(css.primaryButton);
        ok.textContent = confirm;
        ok.disabled = state.busy || pending.entries === null;
        ok.addEventListener('click', () => { void confirmApply(); });
        footer.append(cancel, ok);
        card.appendChild(footer);
        overlayNode.addEventListener('click', (event) => {
            if (event.target === overlayNode && !state.busy)
                closeModal();
        });
        overlayNode.appendChild(card);
        document.body.appendChild(overlayNode);
        overlay = overlayNode;
    };
    /* ---------- tree chip ---------- */
    const renderTreeChip = (root) => {
        // Anchor: the official toolbar's search box — the chip sits right next to
        // it as an inline toolbar control (no absolute positioning).
        const searchInput = root.querySelector('[role="toolbar"] input[type="search"]');
        const anchor = searchInput?.parentElement;
        let chip = root.querySelector('[' + CHIP_MARK + ']');
        if (anchor === undefined || anchor === null) {
            // Toolbar not rendered yet; drop any stale chip until the observer re-syncs.
            chip?.remove();
            return;
        }
        if (chip === null) {
            chip = el('div', css.treeChip, { [CHIP_MARK]: '' });
            anchor.after(chip);
        }
        else if (chip.parentElement !== anchor) {
            // The official toolbar re-rendered; re-attach next to the search box.
            anchor.after(chip);
        }
        chip.replaceChildren();
        const button = buttonEl(css.treeChipButton, { 'aria-expanded': String(state.menuOpen), 'aria-label': t('tree.switch') });
        const icon = el('span');
        icon.innerHTML = BRANCH_ICON;
        const name = el('span', css.treeChipName);
        name.textContent = state.registry.current;
        const caret = el('span', css.treeCaret, { 'aria-hidden': 'true' });
        caret.textContent = state.menuOpen ? '▲' : '▼';
        button.append(icon, name, caret);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            state.menuOpen = !state.menuOpen;
            renderTreeChip(root);
        });
        chip.appendChild(button);
        if (state.menuOpen) {
            const menu = el('div', css.treeMenu, { role: 'menu' });
            const entries = [
                {
                    name: MAIN_TREE,
                    label: t('tree.main'),
                    stateIndex: state.ops.length,
                    cellIndex: -1,
                    current: isMainTree(state.registry),
                },
                ...state.registry.trees
                    .slice()
                    .sort((a, b) => a.createdAt - b.createdAt)
                    .map(tree => ({
                    name: tree.name,
                    label: tree.label,
                    stateIndex: tree.stateIndex,
                    cellIndex: tree.nodeIndex,
                    current: state.registry.current === tree.name,
                })),
            ];
            for (const entry of entries) {
                const item = buttonEl(css.treeMenuItem + (entry.current ? ' ' + css.treeMenuItemCurrent : ''), { role: 'menuitem' });
                item.disabled = state.busy || entry.current;
                const itemName = el('span', css.treeMenuName);
                itemName.textContent = entry.name;
                const meta = el('span', css.treeMenuMeta);
                meta.textContent = entry.name === MAIN_TREE ? '#' + entry.stateIndex : (entry.label || '#' + entry.stateIndex);
                item.append(itemName, meta);
                item.addEventListener('click', (event) => {
                    event.stopPropagation();
                    state.menuOpen = false;
                    requestTreeEntry(entry);
                    renderTreeChip(root);
                });
                menu.appendChild(item);
            }
            chip.appendChild(menu);
        }
    };
    /* ---------- row action cells ---------- */
    const createCell = (tr, row) => {
        const cell = document.createElement('td');
        cell.setAttribute(CELL_MARK, '');
        cell.dataset.dshBranchIndex = String(row.cellIndex);
        cell.className = css.actionsCell;
        const inner = el('span', css.actionsInner);
        const rollback = buttonEl(css.iconButton, {
            'data-dsh-branch-role': 'rollback',
            title: t('action.rollback'),
            'aria-label': t('action.rollback'),
        });
        rollback.innerHTML = ROLLBACK_ICON;
        rollback.addEventListener('click', (event) => {
            event.stopPropagation();
            requestApply(row.cellIndex, 'rollback');
        });
        const restore = buttonEl(css.iconButton, {
            'data-dsh-branch-role': 'restore',
            title: t('action.restore'),
            'aria-label': t('action.restore'),
        });
        restore.innerHTML = RESTORE_ICON;
        restore.addEventListener('click', (event) => {
            event.stopPropagation();
            requestApply(row.cellIndex, 'restore');
        });
        inner.append(rollback, restore);
        cell.appendChild(inner);
        tr.appendChild(cell);
        updateCell(cell, row);
    };
    const updateCell = (cell, row) => {
        const rollback = cell.querySelector('button[data-dsh-branch-role="rollback"]');
        const restore = cell.querySelector('button[data-dsh-branch-role="restore"]');
        if (rollback !== null) {
            const onTree = onRowTree(row);
            rollback.disabled = state.busy || onTree;
            rollback.title = onTree ? t('tree.alreadyOn') : t('action.rollback');
            rollback.classList.toggle(css.iconButtonActive, onTree);
        }
        if (restore !== null) {
            const onMain = isMainTree(state.registry);
            restore.disabled = state.busy || onMain;
            restore.title = onMain ? t('tree.alreadyOn') : t('action.restore');
        }
    };
    const syncDom = () => {
        const roots = document.querySelectorAll(VIEW_SELECTOR);
        const byIndex = new Map(state.rows.map(row => [row.cellIndex, row]));
        for (const root of roots) {
            renderTreeChip(root);
            const trs = root.querySelectorAll(ROW_SELECTOR);
            for (const tr of trs) {
                const raw = tr.dataset.recordIndex;
                const index = raw === undefined ? Number.NaN : Number(raw);
                if (!Number.isInteger(index) || index < 0)
                    continue;
                const row = byIndex.get(index);
                const cell = tr.querySelector('td[' + CELL_MARK + ']');
                if (row === undefined) {
                    cell?.remove();
                    continue;
                }
                if (cell === null || Number(cell.dataset.dshBranchIndex) !== row.cellIndex) {
                    cell?.remove();
                    createCell(tr, row);
                    continue;
                }
                updateCell(cell, row);
            }
        }
    };
    /* ---------- wiring ---------- */
    const unsubList = ctx.sessions.list.subscribe(syncSession);
    syncSession();
    state.observer = new MutationObserver(scheduleSync);
    state.observer.observe(document.body, { childList: true, subtree: true });
    const closeOnOutsideClick = (event) => {
        const target = event.target;
        const chip = document.querySelector('[' + CHIP_MARK + ']');
        if (chip !== null && target !== null && !chip.contains(target) && state.menuOpen) {
            state.menuOpen = false;
            for (const root of document.querySelectorAll(VIEW_SELECTOR))
                renderTreeChip(root);
        }
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => {
        unsubList();
        state.unbindSession?.();
        state.observer?.disconnect();
        document.removeEventListener('click', closeOnOutsideClick);
        if (state.syncTimer !== null)
            clearTimeout(state.syncTimer);
        if (state.noticeTimer !== null)
            clearTimeout(state.noticeTimer);
        overlay?.remove();
        overlay = null;
        for (const node of document.querySelectorAll('[' + CELL_MARK + '], [' + CHIP_MARK + '], [' + NOTICE_MARK + ']')) {
            node.remove();
        }
    };
}
