/**
 * Staged form model behind the plugin settings card. A card stages what the
 * user types and writes it only when they save — the settings write is a
 * durable, revision-fenced document mutation, so staging keeps what is on
 * screen exactly what a save would store. Mirrors the official
 * ui-plugin-config card-store pattern in a self-contained slice: this
 * package must not depend on a sibling UI package.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** A whole- or decimal-number field. An empty draft clears the field; any other draft that is not a finite number within the constraints blocks the save. */
export function numberField(field, constraints = {}) {
    const { integer = false, min } = constraints;
    return {
        field,
        format: value => typeof value === 'number' ? String(value) : '',
        parse: (text) => {
            const trimmed = text.trim();
            if (trimmed === '')
                return { kind: 'clear' };
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed))
                return undefined;
            if (integer && !Number.isInteger(parsed))
                return undefined;
            if (min !== undefined && parsed < min)
                return undefined;
            return { kind: 'set', value: parsed };
        },
    };
}
/** A free-text field. An empty draft clears the field. */
export function textField(field) {
    return {
        field,
        format: value => typeof value === 'string' ? value : '',
        parse: (text) => {
            const trimmed = text.trim();
            return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed };
        },
    };
}
/** A boolean field, edited through true/false draft text. */
export function booleanField(field) {
    return {
        field,
        format: value => typeof value === 'boolean' ? String(value) : '',
        parse: (text) => {
            const trimmed = text.trim();
            if (trimmed === '')
                return { kind: 'clear' };
            if (trimmed === 'true')
                return { kind: 'set', value: true };
            if (trimmed === 'false')
                return { kind: 'set', value: false };
            return undefined;
        },
    };
}
/**
 * Stages one card's edits over one settings namespace and writes them on save.
 *
 * The Host is the only authority on whether a value was accepted — its
 * validators own the constraints no schema can express — so the outcome is
 * read back from the section rather than predicted here. A save that did not
 * land keeps its drafts, so the user can correct them instead of retyping.
 */
export class CardForm {
    scope;
    specs;
    staged = new Map();
    listeners = new Set();
    saving = false;
    failed = false;
    /** @param scope - the bound settings scope for this card's namespace. */
    constructor(scope, specs) {
        this.scope = scope;
        this.specs = new Map(specs.map(spec => [spec.field, spec]));
        scope.subscribe(() => { this.publish(); });
    }
    /** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
    bind(project) {
        const store = createSnapshotStore(project());
        this.listeners.add(() => { store.set(project()); });
        return store;
    }
    /** Read the card-level state: what the Host serves, and what a save would do. */
    shell() {
        const snapshot = this.scope.getSnapshot();
        const plan = this.plan();
        return {
            available: snapshot.status !== 'loading',
            exposed: snapshot.status === 'ready',
            writable: snapshot.writable,
            dirty: plan.length > 0,
            invalid: plan.some(item => item.run === undefined),
            saving: this.saving,
            failed: this.failed,
        };
    }
    /** Read one field's state from the effective section and its staged draft. */
    field(field) {
        const spec = this.specOf(field);
        const staged = this.staged.get(field);
        if (staged === undefined) {
            return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
        }
        const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text);
        return {
            text: staged.text,
            overridden: write?.kind === 'set',
            invalid: write === undefined,
        };
    }
    /** The actions the card's slot registration injects. */
    actions() {
        return {
            edit: (field, text) => { this.stage(field, { text, clear: false }); },
            resetField: (field) => {
                this.stage(field, { text: this.specOf(field).format(this.baseValue(field)), clear: true });
            },
            save: () => { void this.save(); },
            discard: () => {
                if (this.staged.size === 0 && !this.failed)
                    return;
                this.staged.clear();
                this.failed = false;
                this.publish();
            },
        };
    }
    /**
     * Write every staged edit, then re-seed from what the Host accepted.
     * @returns settlement after every write and the read-back.
     */
    async save() {
        const plan = this.plan();
        const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run]);
        if (plan.length === 0 || this.saving || writes.length !== plan.length)
            return;
        // Snapshot the fields this save writes, so edits staged while it is in
        // flight survive: only the staged keys this save actually wrote are cleared.
        const fields = new Set(plan.map(item => item.field));
        this.saving = true;
        this.failed = false;
        this.publish();
        let landed = true;
        for (const write of writes) {
            landed = await write() && landed;
        }
        if (landed) {
            for (const field of fields)
                this.staged.delete(field);
        }
        this.saving = false;
        this.failed = !landed;
        this.publish();
    }
    /**
     * Every staged edit a save would write. An entry whose draft is not a value
     * its field accepts carries no write: the form is still dirty, and the save
     * refuses rather than dropping the edit. A staged edit that matches the
     * effective section is not a write at all.
     * @returns the planned writes, in the order the fields were staged.
     */
    plan() {
        const plan = [];
        for (const [field, staged] of this.staged) {
            const spec = this.specOf(field);
            if (staged.clear) {
                if (this.stored(field))
                    plan.push({ field, run: () => this.clear(field) });
                continue;
            }
            if (staged.text === spec.format(this.sectionValue(field)))
                continue;
            const write = spec.parse(staged.text);
            if (write === undefined)
                plan.push({ field, run: undefined });
            else if (write.kind === 'clear')
                plan.push({ field, run: () => this.clear(field) });
            else
                plan.push({ field, run: () => this.store(field, write.value) });
        }
        return plan;
    }
    async clear(field) {
        await this.scope.unset(field);
        return !this.stored(field);
    }
    async store(field, value) {
        await this.scope.set(field, value);
        return this.userLayer()?.[field] === value;
    }
    stage(field, edit) {
        this.staged.set(field, edit);
        this.failed = false;
        this.publish();
    }
    specOf(field) {
        const spec = this.specs.get(field);
        // Every call site names a field this card declared; a missing one is a
        // wiring mistake that must not degrade into a silently inert control.
        if (spec === undefined)
            throw new Error(`settings card has no field ${field}`);
        return spec;
    }
    snapshotOf() {
        return this.scope.getSnapshot();
    }
    sectionValue(field) {
        return this.snapshotOf().value?.[field];
    }
    baseValue(field) {
        return this.snapshotOf().base?.[field];
    }
    userLayer() {
        return this.snapshotOf().user;
    }
    stored(field) {
        const user = this.userLayer();
        return user !== undefined && Object.hasOwn(user, field);
    }
    publish() {
        for (const listener of this.listeners)
            listener();
    }
}
