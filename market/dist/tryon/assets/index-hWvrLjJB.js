const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./index-DGS2ur_Y.js","./git-DJDr4heb.js"])))=>i.map(i=>d[i]);
import{b as S,t as ie,a as re,r as oe,ab as ae,g as ce,_ as de,m as le,ak as ue}from"./index-DGS2ur_Y.js";import{SessionQueryEngine as pe,SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY as z,SESSION_QUERY_READ_WINDOW_MAX as V,SessionQueryError as c,assertSessionHeadersCompatible as U,materializeSessionResultFilters as he,buildSessionEventSearchDocuments as _e,materializeSessionEventResultFilters as Ee,SessionSearchCursor as Se}from"./index-DXc5tg3K.js";import"./git-DJDr4heb.js";import"./index-n_Xtm1JV.js";import"./schemas-BjdgLEE2.js";import"./json-schema-processors-6dmQcDt8.js";const Je=8,fe=1146308689,ge=new Set(["search_state","persisted_sessions","persisted_docs","persisted_docs_data","persisted_docs_idx","persisted_docs_content","persisted_docs_docsize","persisted_docs_config"]);async function Ie(e){try{await(await ue(e,"wx",384)).close()}catch(t){if(t.code!=="EEXIST")throw t}}async function me(e,t){const s=e===":memory:"?e:oe(e);s!==":memory:"&&(await ae(ce(s),{recursive:!0,mode:448}),await Ie(s));const{DatabaseSync:n}=await de(async()=>{const{DatabaseSync:r}=await import("./index-DGS2ur_Y.js").then(o=>o.cL);return{DatabaseSync:r}},__vite__mapDeps([0,1]),import.meta.url),i=new n(s);try{const{application_id:r}=i.prepare("PRAGMA application_id").get(),{user_version:o}=i.prepare("PRAGMA user_version").get(),d=Ae(i);if(r!==0&&r!==1146308689)throw new Error(`session-search database at "${s}" belongs to another application`);if(r===0&&d.length>0)throw new Error(`session-search database at "${s}" is not an empty or recognized derived index`);return r===1146308689&&(Ne(s,d),o!==8&&Te(i,d)),i.exec(`PRAGMA journal_mode = ${t.toUpperCase()}`),ve(i),Re(i),i}catch(r){throw i.close(),r}}function Ae(e){return e.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(t=>t.name)}function Ne(e,t){const s=t.filter(n=>!ge.has(n));if(s.length>0)throw new Error(`session-search database at "${e}" has unrecognized user tables: ${s.join(", ")}`)}function Te(e,t){for(const s of t)e.exec(`DROP TABLE IF EXISTS ${Le(s)}`);e.exec("PRAGMA user_version = 0")}function ve(e){e.exec(`PRAGMA application_id = ${fe}`),e.exec(`
    CREATE TABLE IF NOT EXISTS search_state (
      singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_generation INTEGER NOT NULL
    ) STRICT
  `),e.exec("INSERT OR IGNORE INTO search_state (singleton, global_generation) VALUES (1, 0)"),e.exec(`
    CREATE TABLE IF NOT EXISTS persisted_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      revision       TEXT NOT NULL,
      generation     INTEGER NOT NULL
    ) STRICT
  `),e.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS persisted_docs USING fts5(
      text,
      session_id UNINDEXED,
      seq UNINDEXED,
      type UNINDEXED,
      time UNINDEXED,
      surface UNINDEXED,
      codepoint_length UNINDEXED,
      tokenize = 'unicode61'
    )
  `),e.exec("PRAGMA user_version = 8")}function Re(e){e.exec(`
    CREATE TEMP TABLE IF NOT EXISTS live_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      fingerprint    TEXT NOT NULL,
      persisted      INTEGER NOT NULL CHECK (persisted IN (0, 1)),
      generation     INTEGER NOT NULL
    ) STRICT
  `),e.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS temp.live_docs USING fts5(
      text,
      session_id UNINDEXED,
      seq UNINDEXED,
      type UNINDEXED,
      time UNINDEXED,
      surface UNINDEXED,
      codepoint_length UNINDEXED,
      tokenize = 'unicode61'
    )
  `)}function Le(e){return`"${e.replaceAll('"','""')}"`}const I=Number.MAX_SAFE_INTEGER-1,we=32766;function m(e){if(e>32766)throw new c(`session-search request exceeds SQLite's portable ${we}-variable limit; reduce filter values`,"SESSION_QUERY_INVALID_FILTER")}function T(e){if(e>14)throw new c("session-search request exceeds the supported SQLite FTS5 outer-predicate budget of 14; reduce filters","SESSION_QUERY_INVALID_FILTER")}function be(e,t){const s=he(e.sessionFilters??[]),n=K(e.eventFilters??[]),i=J(e.cursor);return{query:j(e.query),sessionFilters:s,eventFilters:n,limit:Z(e.limit,t),...i===void 0?{}:{cursor:i}}}function ye(e,t){if(typeof e.sessionId!="string")throw new c("session-search session id must be text","SESSION_QUERY_INVALID_FILTER");const s=K(e.filters??[]),n=J(e.cursor);return{sessionId:e.sessionId,query:j(e.query),filters:s,limit:Z(e.limit,t),...n===void 0?{}:{cursor:n}}}function Oe(e){const t=[],s=[];for(const n of e)switch(n.kind){case"id":O(t,s,"session_id",n.values);break;case"cwd":F(t,s,"cwd",n.values);break;case"created-at":D(t,s,"created_at",n);break;case"parent":F(t,s,"parent_session",n.values);break;case"availability":{const i=[...new Set(n.values)];if(i.length===0)t.push("0");else if(i.length===1){const r=i[0];switch(r){case"live":t.push("live = 1");break;case"persisted":t.push("persisted = 1");break;default:xe(r)}}break}default:C(n)}return T(t.length),{sql:t.join(" AND "),params:s,predicateCount:t.length}}function M(e){const t=[],s=[];for(const n of e)switch(n.kind){case"seq":D(t,s,"seq",n);break;case"time":D(t,s,"time",n);break;case"type":O(t,s,"type",n.values);break;case"surface":O(t,s,"surface",n.values);break;default:C(n)}return T(t.length),{sql:t.join(" AND "),params:s,predicateCount:t.length}}function De(e){return`"${e.replaceAll('"','""')}"`}function y(e){return e.replaceAll("\0","�").replaceAll("﷐","�").replaceAll("﷑","�")}function x(e){return"sessionId"in e?JSON.stringify({scope:"events",sessionId:e.sessionId,query:e.query,filters:R(e.filters),limit:e.limit}):JSON.stringify({scope:"sessions",query:e.query,sessionFilters:R(e.sessionFilters),eventFilters:R(e.eventFilters),limit:e.limit})}function Ce(e,t){const{text:s,matchStart:n}=Ue(e),i=Array.from(s);if(i.length<=t)return s;if(t===1)return"…";const r=Math.min(n,i.length-1);let o=Math.max(0,r-Math.floor(t/3));const d=o>0?"…":"";let a="…",u=t-d.length-a.length;u<1?(o=r,a="",u=t-d.length-a.length):r>=o+u&&(o=r-u+1);let h=Math.min(i.length,o+u);return h===i.length&&(a="",u=t-d.length,o=Math.max(0,h-u)),h=Math.min(i.length,o+u),`${d}${i.slice(o,h).join("")}${a}`}function Ue(e){const t=[];let s;for(const n of e){if(n==="﷐"){s??=t.length;continue}n!=="﷑"&&(/\s/u.test(n)?t.length>0&&t.at(-1)!==" "&&t.push(" "):t.push(n))}return t.at(-1)===" "&&t.pop(),{text:t.join(""),matchStart:s??0}}function j(e){if(typeof e!="string")throw new c("session-search query must be text","SESSION_QUERY_INVALID_QUERY");const t=e.trim().replace(/\s+/gu," ");if(t.length===0)throw new c("session-search query must contain non-whitespace text","SESSION_QUERY_INVALID_QUERY");if(t.includes("\0"))throw new c("session-search query must not contain NUL","SESSION_QUERY_INVALID_QUERY");return y(t)}function J(e){if(e!==void 0){if(typeof e!="string")throw new c("session-search cursor must be text","SESSION_QUERY_INVALID_CURSOR");return e}}function K(e){const t=e;for(const s of t)switch(s.kind){case"seq":case"time":case"type":case"surface":break;case"text":throw new c("session-search metadata filters do not accept text clauses","SESSION_QUERY_INVALID_FILTER");default:C(s)}return Ee(e)}function Z(e,t){const s=e??t.defaultLimit,n=Math.min(t.maxLimit,I);if(!Number.isSafeInteger(s)||s<1||s>n)throw new c(`session-search limit must be an integer between 1 and ${n}`,"SESSION_QUERY_INVALID_LIMIT");return s}function O(e,t,s,n){if(n.length===0){e.push("0");return}e.push(`${s} IN (${ee(t,n)})`)}function F(e,t,s,n){if(n.length===0){e.push("0");return}const i=n.filter(o=>o!==null),r=[];i.length>0&&r.push(`${s} IN (${ee(t,i)})`),n.includes(null)&&r.push(`${s} IS NULL`),e.push(`(${r.join(" OR ")})`)}function D(e,t,s,n){n.from!==void 0&&(m(t.length+1),e.push(`CAST(${s} AS INTEGER) >= ?`),t.push(n.from)),n.to!==void 0&&(m(t.length+1),e.push(`CAST(${s} AS INTEGER) <= ?`),t.push(n.to))}function ee(e,t){m(e.length+t.length);for(const s of t)e.push(s);return t.map(()=>"?").join(", ")}function R(e){return e.map(t=>"values"in t?{...t,values:[...t.values].sort(Me)}:{kind:t.kind,from:t.from??null,to:t.to??null}).sort((t,s)=>JSON.stringify(t).localeCompare(JSON.stringify(s)))}function Me(e,t){return e===t?0:e===null?-1:t===null?1:e.localeCompare(t)}function xe(e){throw new c(`session availability filter contains unknown value "${String(e)}"`,"SESSION_QUERY_INVALID_FILTER")}function C(e){const t=e.kind;throw new c(`session filter contains unknown kind ${typeof t=="string"?`"${t}"`:"(missing)"}`,"SESSION_QUERY_INVALID_FILTER")}const Ke="launcherSessionQueryPath",Ze=20,et=100,tt=240,Fe=2;var st=class extends pe{static inject=["sessions"];static Config=S.object({path:S.string().required(),openAt:S.union(["startup","first-search","never"]).default("startup"),journalMode:S.union(["wal","delete","truncate","persist"]).default("wal"),defaultLimit:S.number().step(1).min(1).max(I).default(20),maxLimit:S.number().step(1).min(1).max(I).default(100),snippetChars:S.number().step(1).min(1).default(240),readWindowMax:S.number().step(1).min(0).default(V),persistedInspectConcurrency:S.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(z)});config;_instance=ie();_ready;_db;_persistenceBinding={identity:Symbol()};_lastPersistenceIdentity;_persistenceEpoch=0;_globalGeneration=0;_localGeneration=0;_tail=Promise.resolve();_closed=!1;_closePromise;_optionalPersistenceFiber;constructor(e,t){super(e,t=qe(t)),this.config=t,this._optionalPersistenceFiber=e.inject(["sessionPersistence"],s=>{const n=s.sessionPersistence,i={identity:Symbol(),service:n};this._persistenceBinding=i,s.effect(()=>()=>{this._persistenceBinding===i&&(this._persistenceBinding={identity:Symbol()})},"sessionQuerySqlite.persistenceBinding")}),e.effect(()=>()=>this._optionalPersistenceFiber.dispose(),"sessionQuerySqlite.optionalPersistence"),e.effect(()=>async()=>this.close(),"sessionQuerySqlite.close")}async[re.init](){this.config.openAt==="startup"&&await this._ensureReady(void 0)}async searchSessions(e,t){this._assertSearchEnabled();const s=be(e,this.config),n=t?.signal;return this._serialized(n,async()=>{await this._ensureReady(n);const i=await this._reconcile(n);_(n);const r=String(this._globalGeneration),o=x(s),d=s.cursor===void 0?0:$(s.cursor,this._instance,"sessions",o,r);return q(this._querySessions(s,d,i),s.limit,a=>this._sessionHit(a),a=>G({version:1,instance:this._instance,scope:"sessions",fingerprint:o,generation:r,offset:a}),d)})}async searchEvents(e,t){this._assertSearchEnabled();const s=ye(e,this.config),n=t?.signal;return this._serialized(n,async()=>{await this._ensureReady(n);const i=await this._reconcile(n);_(n);const r=this._targetObservation(s.sessionId,i),o=x(s),d=s.cursor===void 0?0:$(s.cursor,this._instance,"events",o,r.generation),a=this._queryEvents(s,d,i);return{session:r.header,...q(a,s.limit,u=>this._eventHit(u),u=>G({version:1,instance:this._instance,scope:"events",fingerprint:o,generation:r.generation,offset:u}),d)}})}close(){return this._closePromise??=this._close(),this._closePromise}_assertSearchEnabled(){if(this.config.openAt==="never")throw new c('session search is disabled: this deployment configures the session-query index with openAt "never"',"SESSION_QUERY_SEARCH_DISABLED")}async _close(){if(this._closed=!0,await this._tail,this._ready!==void 0)try{await this._ready}catch{}this._db?.close(),this._db=void 0}async _open(){this._db=await me(this.config.path,this.config.journalMode);const e=this._db.prepare("SELECT global_generation FROM search_state WHERE singleton = 1").get();this._globalGeneration=e.global_generation,this._localGeneration=e.global_generation}async _ensureReady(e){this._ready??=this._open();try{await H(this._ready,e)}catch(t){throw W(t)?t:new c(`session-search SQLite index failed to open: ${b(t)}`,"SESSION_QUERY_INDEX_FAILED",{cause:t})}}async _serialized(e,t){if(this._isClosed())throw w();let s;const n=new Promise(r=>{s=r}),i=this._tail;this._tail=i.then(()=>n);try{await H(i,e)}catch(r){throw s(),r}if(this._isClosed())throw s(),w();try{return _(e),await t()}finally{s()}}async _reconcile(e){_(e);const t=this._requireDb(),s=t.prepare("SELECT id, revision, generation FROM persisted_sessions").all(),n=t.prepare("SELECT id, fingerprint, persisted, generation FROM temp.live_sessions").all(),i=new Map(s.map(l=>[l.id,l])),r=new Map(n.map(l=>[l.id,l])),o=await this._observeStable(i,e);_(e);const d=o.persistenceBinding.service===void 0?[]:[...o.persisted.values()].filter(l=>l.loaded!==void 0),a=o.persistenceBinding.service===void 0?[]:s.filter(l=>!o.persisted.has(l.id)),u=[...o.live.values()].filter(l=>{const p=r.get(l.header.id),v=o.persisted.has(l.header.id)?1:0;return p?.fingerprint!==l.fingerprint||p.persisted!==v}),h=n.filter(l=>!o.live.has(l.id)),A=this._lastPersistenceIdentity!==void 0&&this._lastPersistenceIdentity!==o.persistenceBinding.identity,E=d.length>0||a.length>0||u.length>0||h.length>0;let f=this._mainGeneration(),N=this._localGeneration;(d.length>0||a.length>0)&&(f+=1);const se=u.map(l=>(N=Math.max(N,f)+1,{entry:l,generation:N,persisted:o.persisted.has(l.header.id)}));if(E){let l=!1;try{t.exec("BEGIN IMMEDIATE"),l=!0;for(const p of a)this._deleteSession("persisted",p.id);for(const p of d){if(p.loaded===void 0)throw new Error(`missing loaded revision for session "${p.header.id}"`);this._replacePersistedSession(p.loaded,p.revision,f)}(d.length>0||a.length>0)&&t.prepare("UPDATE search_state SET global_generation = ? WHERE singleton = 1").run(f);for(const p of h)this._deleteSession("live",p.id);for(const{entry:p,generation:v,persisted:ne}of se)this._replaceLiveSession(p,v,ne);t.exec("COMMIT")}catch(p){if(l)try{t.exec("ROLLBACK")}catch{}throw new c(`session-search reconciliation failed: ${b(p)}`,"SESSION_QUERY_INDEX_FAILED",{cause:p})}}return(E||A)&&(this._globalGeneration+=1),A&&(this._persistenceEpoch+=1),this._localGeneration=N,this._lastPersistenceIdentity=o.persistenceBinding.identity,o.persistenceBinding}async _observeStable(e,t){for(let s=0;s<Fe;s+=1){_(t);const n=this._persistenceBinding,i=n.service,r=new Set(this.ctx.sessions.list().map(a=>a.id));let o=new Map;if(i!==void 0)try{const a=this._lastPersistenceIdentity===void 0||this._lastPersistenceIdentity===n.identity,u=await i.listSnapshots(t);_(t),o=Y(u);for(const E of o.values()){if(a&&e.get(E.header.id)?.revision===E.revision||r.has(E.header.id)||this.ctx.sessions.get(E.header.id)!==void 0)continue;_(t);const f=await i.inspect(E.header.id,t);_(t),U(E.header,f.meta),E.loaded=te(f.meta,f.events)}_(t);const h=await i.listSnapshots(t);_(t);const A=Y(h);if(!Qe(o,A)||this._persistenceBinding!==n)continue}catch(a){if(W(a)||t?.aborted)throw new c("session-search aborted","SESSION_QUERY_ABORTED",{cause:a});if(this._persistenceBinding!==n)continue;throw a instanceof c?a:new c(`session-search persistence observation failed: ${b(a)}`,"SESSION_QUERY_PERSISTENCE_FAILED",{cause:a})}const d=new Map;for(const a of this.ctx.sessions.list()){const u=Pe(a),h=o.get(a.id);h!==void 0&&U(u.header,h.header),d.set(a.id,u)}if(Be(r,d))return{persistenceBinding:n,persisted:o,live:d}}throw new c("session-search persistence observation did not stabilize after one retry","SESSION_QUERY_PERSISTENCE_FAILED")}_mainGeneration(){return this._requireDb().prepare("SELECT global_generation FROM search_state WHERE singleton = 1").get().global_generation}_deleteSession(e,t){const s=this._requireDb();e==="persisted"?(s.prepare("DELETE FROM persisted_docs WHERE session_id = ?").run(t),s.prepare("DELETE FROM persisted_sessions WHERE id = ?").run(t)):(s.prepare("DELETE FROM temp.live_docs WHERE session_id = ?").run(t),s.prepare("DELETE FROM temp.live_sessions WHERE id = ?").run(t))}_replacePersistedSession(e,t,s){this._deleteSession("persisted",e.header.id);const n=this._requireDb();n.prepare(`
      INSERT INTO persisted_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, revision, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...P(e.header),t,s);const i=n.prepare(`
      INSERT INTO persisted_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);for(const r of e.documents){const o=y(r.text);i.run(o,r.sessionId,r.seq,r.type,r.time,r.surface,Array.from(o).length)}}_replaceLiveSession(e,t,s){this._deleteSession("live",e.header.id);const n=this._requireDb();n.prepare(`
      INSERT INTO temp.live_sessions
        (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, fingerprint, persisted, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...P(e.header),e.fingerprint,s?1:0,t);const i=n.prepare(`
      INSERT INTO temp.live_docs (text, session_id, seq, type, time, surface, codepoint_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);for(const r of e.documents){const o=y(r.text);i.run(o,r.sessionId,r.seq,r.type,r.time,r.surface,Array.from(o).length)}}_querySessions(e,t,s){const n=Q(),i=Oe(e.sessionFilters),r=M(e.eventFilters);T(i.predicateCount+r.predicateCount);const o=[i.sql,r.sql].filter(Boolean).join(" AND "),d=[...B(e.query,s.service!==void 0),...i.params,...r.params,e.limit+1,t];return m(d.length),this._requireDb().prepare(`
      ${n.sql},
      filtered AS (
        SELECT * FROM matched ${o.length===0?"":`WHERE ${o}`}
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY session_id
          ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC
        ) AS event_rank
        FROM filtered
      )
      SELECT * FROM ranked
      WHERE event_rank = 1
      ORDER BY match_count DESC, document_length ASC, time DESC, session_id ASC, seq DESC
      LIMIT ? OFFSET ?
    `).all(...d)}_queryEvents(e,t,s){const n=Q(),i=M(e.filters);T(1+i.predicateCount);const r=["session_id = ?",i.sql].filter(Boolean).join(" AND "),o=[...B(e.query,s.service!==void 0),e.sessionId,...i.params,e.limit+1,t];return m(o.length),this._requireDb().prepare(`
      ${n.sql}
      SELECT * FROM matched
      WHERE ${r}
      ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC
      LIMIT ? OFFSET ?
    `).all(...o)}_targetObservation(e,t){const s=this._requireDb(),n=s.prepare(`SELECT
        id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, generation
      FROM temp.live_sessions
      WHERE id = ?`).get(e);if(n!==void 0)return{header:L(n),generation:`live:${n.generation}`};if(t.service!==void 0){const i=s.prepare(`SELECT
          id AS session_id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, generation
        FROM persisted_sessions
        WHERE id = ?`).get(e);if(i!==void 0)return{header:L(i),generation:`persisted:${this._persistenceEpoch}:${i.generation}`}}throw new c(`session "${e}" not found`,"SESSION_QUERY_SESSION_NOT_FOUND")}_sessionHit(e){return{header:L(e),live:e.live===1,persisted:e.persisted===1,bestMatch:this._eventHit(e)}}_eventHit(e){return{sessionId:e.session_id,seq:e.seq,type:e.type,time:e.time,surface:e.surface,snippet:Ce(e.marked_text,this.config.snippetChars)}}_requireDb(){if(this._db===void 0)throw w();return this._db}_isClosed(){return this._closed}};function P(e){return[e.id,e.version,e.createdAt,e.cwd??null,e.parentSession??null,e.seedLength??null,e.delegationDepth??null,e.agentPreset??null]}function Q(){return{sql:`WITH candidates AS (
      SELECT
        pd.session_id AS session_id,
        ps.version AS version,
        ps.created_at AS created_at,
        ps.cwd AS cwd,
        ps.parent_session AS parent_session,
        ps.seed_length AS seed_length,
        ps.delegation_depth AS delegation_depth,
        ps.agent_preset AS agent_preset,
        0 AS live,
        1 AS persisted,
        CAST(pd.seq AS INTEGER) AS seq,
        pd.type AS type,
        CAST(pd.time AS INTEGER) AS time,
        pd.surface AS surface,
        highlight(persisted_docs, 0, ?, ?) AS marked_text,
        CAST(pd.codepoint_length AS INTEGER) AS document_length
      FROM persisted_docs AS pd
      JOIN persisted_sessions AS ps ON ps.id = pd.session_id
      WHERE persisted_docs MATCH ?
        AND ? = 1
        AND NOT EXISTS (SELECT 1 FROM temp.live_sessions AS ls WHERE ls.id = pd.session_id)
      UNION ALL
      SELECT
        ld.session_id AS session_id,
        ls.version AS version,
        ls.created_at AS created_at,
        ls.cwd AS cwd,
        ls.parent_session AS parent_session,
        ls.seed_length AS seed_length,
        ls.delegation_depth AS delegation_depth,
        ls.agent_preset AS agent_preset,
        1 AS live,
        CASE WHEN ? = 1 THEN ls.persisted ELSE 0 END AS persisted,
        CAST(ld.seq AS INTEGER) AS seq,
        ld.type AS type,
        CAST(ld.time AS INTEGER) AS time,
        ld.surface AS surface,
        highlight(live_docs, 0, ?, ?) AS marked_text,
        CAST(ld.codepoint_length AS INTEGER) AS document_length
      FROM temp.live_docs AS ld
      JOIN temp.live_sessions AS ls ON ls.id = ld.session_id
      WHERE live_docs MATCH ?
    ), matched AS (
      SELECT *,
        (
          length(CAST(marked_text AS BLOB))
          - length(CAST(replace(marked_text, ?, '') AS BLOB))
        ) / ? AS match_count
      FROM candidates
    )`}}function B(e,t){const s=De(e),n=t?1:0;return["﷐","﷑",s,n,n,"﷐","﷑",s,"﷐",Buffer.byteLength("﷐","utf8")]}function Pe(e){return te(e.header,e.events)}function te(e,t){const s=structuredClone(e),n=t.map(i=>structuredClone(i));return{header:s,documents:_e(s.id,n),fingerprint:le("sha256").update(JSON.stringify({header:s,events:n})).digest("base64url")}}function Y(e){if(!ke(e))throw new Error("persistence snapshots must be an array");const t=new Map;for(const s of e){if(typeof s.revision!="string")throw new Error("persistence snapshot revision must be a string");const n=structuredClone(s.header);if(t.has(n.id))throw new Error(`persistence listed duplicate session "${n.id}"`);t.set(n.id,{header:n,revision:s.revision})}return t}function Qe(e,t){if(e.size!==t.size)return!1;for(const[s,n]of e){const i=t.get(s);if(i===void 0||n.revision!==i.revision||!Ye(n.header,i.header))return!1}return!0}function Be(e,t){if(e.size!==t.size)return!1;for(const s of e)if(!t.has(s))return!1;return!0}function Ye(e,t){return e.version===t.version&&e.id===t.id&&e.createdAt===t.createdAt&&e.cwd===t.cwd&&e.parentSession===t.parentSession&&e.seedLength===t.seedLength&&(e.delegationDepth??0)===(t.delegationDepth??0)&&e.agentPreset===t.agentPreset}function L(e){return{version:e.version,id:e.session_id,createdAt:e.created_at,...e.cwd===null?{}:{cwd:e.cwd},...e.parent_session===null?{}:{parentSession:e.parent_session},...e.seed_length===null?{}:{seedLength:e.seed_length},...e.delegation_depth===null?{}:{delegationDepth:e.delegation_depth},...e.agent_preset===null?{}:{agentPreset:e.agent_preset}}}function q(e,t,s,n,i){const r=e.length>t;return{items:e.slice(0,t).map(s),...r?{nextCursor:n(i+t)}:{}}}function G(e){return Se(Buffer.from(JSON.stringify(e),"utf8").toString("base64url"))}function $(e,t,s,n,i){let r;try{r=JSON.parse(Buffer.from(e,"base64url").toString("utf8"))}catch(o){throw k(o)}if(r.version!==1||r.instance!==t||r.scope!==s||r.fingerprint!==n||!Number.isSafeInteger(r.offset)||r.offset===void 0||r.offset<0)throw k(new Error("cursor does not belong to this normalized request"));if(r.generation!==i)throw new c("session-search cursor is stale because its relevant corpus changed","SESSION_QUERY_STALE_CURSOR");return r.offset}function k(e){return new c("session-search cursor is invalid","SESSION_QUERY_INVALID_CURSOR",{cause:e})}function qe(e){const t={path:e.path,openAt:e.openAt??"startup",journalMode:e.journalMode??"wal",defaultLimit:e.defaultLimit??20,maxLimit:e.maxLimit??100,snippetChars:e.snippetChars??240,readWindowMax:e.readWindowMax??V,persistedInspectConcurrency:e.persistedInspectConcurrency??z};if(typeof t.path!="string"||t.path.trim().length===0)throw g("path must not be blank");if(!["startup","first-search","never"].includes(t.openAt))throw g("openAt is not supported");if(X("defaultLimit",t.defaultLimit),X("maxLimit",t.maxLimit),Ge("snippetChars",t.snippetChars),!Number.isInteger(t.readWindowMax)||t.readWindowMax<0)throw g("readWindowMax must be a non-negative integer");if(!Number.isSafeInteger(t.persistedInspectConcurrency)||t.persistedInspectConcurrency<1)throw g("persistedInspectConcurrency must be a positive safe integer");if(t.defaultLimit>t.maxLimit)throw g("defaultLimit must be less than or equal to maxLimit");if(!["wal","delete","truncate","persist"].includes(t.journalMode))throw g("journalMode is not supported");return t}function Ge(e,t){if(!Number.isInteger(t)||t<1)throw g(`${e} must be a positive integer`)}function X(e,t){if(!Number.isSafeInteger(t)||t<1||t>I)throw g(`${e} must be an integer between 1 and ${I}`)}function g(e){return new c(`session-search SQLite config: ${e}`,"SESSION_QUERY_INVALID_CONFIG")}function w(){return new c("session-search SQLite index is closed","SESSION_QUERY_INDEX_FAILED")}function _(e){if(e?.aborted)throw new c("session-search aborted","SESSION_QUERY_ABORTED")}function H(e,t){return t===void 0?e:t.aborted?Promise.reject(new c("session-search aborted","SESSION_QUERY_ABORTED")):new Promise((s,n)=>{const i=()=>{n(new c("session-search aborted","SESSION_QUERY_ABORTED"))};t.addEventListener("abort",i,{once:!0}),e.then(r=>{t.removeEventListener("abort",i),s(r)},r=>{t.removeEventListener("abort",i),n($e(r))})})}function W(e){return e instanceof c&&e.code==="SESSION_QUERY_ABORTED"}function $e(e){return e instanceof Error?e:new Error("session-search dependency rejected with a non-Error value",{cause:e})}function b(e){return e instanceof Error?e.message:"unknown error"}function ke(e){return Array.isArray(e)}export{fe as SESSION_QUERY_SQLITE_APPLICATION_ID,Ze as SESSION_QUERY_SQLITE_DEFAULT_LIMIT,et as SESSION_QUERY_SQLITE_MAX_LIMIT,Ke as SESSION_QUERY_SQLITE_PATH_KEY,Je as SESSION_QUERY_SQLITE_SCHEMA_VERSION,tt as SESSION_QUERY_SQLITE_SNIPPET_CHARS,st as SqliteSessionQueryEngine,st as default};
