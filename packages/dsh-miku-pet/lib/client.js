// src/client/pickers.ts
var pick = (pool, exclude) => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};
var randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
var pickWeightedCategory = (categories, facing) => {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};
var rollKind = (roll, w) => {
  const topEnd = (w.idle + w.turn + w.move) / 100;
  if (roll < w.idle / 100) return "idle";
  if (roll < (w.idle + w.turn) / 100) return "turn";
  if (roll < topEnd) return "move";
  return "action";
};
var pickCategoryAction = (categories, idlePool, facing, current) => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: "FALLBACK", name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};

// src/client/motion.ts
var planMove = (o) => {
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  const leftBound = o.margin + o.halfW;
  const rightBound = o.W - o.margin - o.halfW;
  if (target < leftBound || target > rightBound) return null;
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W
  };
};

// src/client/config.ts
var stripJsonc = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\:])\/\/.*$/gm, "$1").trim();
var CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
var CORNER_SET = new Set(CORNERS);
var EMPTY_CONF = {
  pets: [],
  animations: { idle: [], turn: [], drag: [], clicks: [], moves: { default: {}, actions: [] }, categories: [] },
  animationWeights: { idle: 0, turn: 0, move: 0 }
};
function assertClientConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("miku-pet: config \u975E\u5BF9\u8C61");
  const cfg = raw;
  const petsArr = cfg.pets;
  if (!Array.isArray(petsArr) || !petsArr.length) throw new Error("miku-pet: \u7F3A\u5C11 pets");
  const seen = /* @__PURE__ */ new Set();
  const pets = [];
  for (const p of petsArr) {
    const id = String(p?.id ?? "");
    if (!id || seen.has(id)) throw new Error("miku-pet: pet id \u975E\u6CD5\u6216\u91CD\u590D\u300C" + id + "\u300D");
    const size = Number(p?.size);
    if (!Number.isFinite(size) || size <= 0) throw new Error("miku-pet: pet\u300C" + id + "\u300D\u5927\u5C0F\u975E\u6CD5");
    const corner = p?.position?.corner;
    if (typeof corner !== "string" || !CORNER_SET.has(corner)) throw new Error("miku-pet: pet\u300C" + id + "\u300Dcorner \u975E\u6CD5");
    const marginX = Number(p?.position?.marginX);
    const marginY = Number(p?.position?.marginY);
    if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) throw new Error("miku-pet: pet\u300C" + id + "\u300D\u8FB9\u8DDD\u975E\u6CD5");
    const rawName = typeof p?.name === "string" ? p.name.trim() : "";
    const name = rawName && rawName.length <= 32 && !/[\x00-\x1f]/.test(rawName) ? rawName : void 0;
    seen.add(id);
    pets.push({ id, size, position: { corner, marginX, marginY }, ...name ? { name } : {} });
  }
  const a = cfg.animations;
  if (!a || typeof a !== "object") throw new Error("miku-pet: \u7F3A\u5C11 animations");
  for (const key of ["idle", "turn", "drag", "clicks"]) {
    if (!Array.isArray(a[key])) throw new Error("miku-pet: animations." + key + " \u7F3A\u5931");
  }
  if (!a.moves || typeof a.moves !== "object" || typeof a.moves.default !== "object" || a.moves.default === null || !Array.isArray(a.moves.actions)) {
    throw new Error("miku-pet: animations.moves \u7ED3\u6784\u975E\u6CD5");
  }
  if (!Array.isArray(a.categories)) throw new Error("miku-pet: animations.categories \u7F3A\u5931");
  const w = cfg.animationWeights;
  if (!w || typeof w !== "object") throw new Error("miku-pet: \u7F3A\u5C11 animationWeights");
  for (const key of ["idle", "turn", "move"]) {
    const v = Number(w[key]);
    if (!Number.isFinite(v) || v < 0) throw new Error("miku-pet: animationWeights." + key + " \u975E\u6CD5");
    w[key] = v;
  }
  let phrases;
  if (cfg.phrases && typeof cfg.phrases === "object") {
    const cleaned = {};
    for (const [k, v] of Object.entries(cfg.phrases)) {
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
        cleaned[k] = v;
      }
    }
    if (Object.keys(cleaned).length) phrases = cleaned;
  }
  return {
    pets,
    animations: a,
    animationWeights: w,
    ...phrases ? { phrases } : {}
  };
}
function resolvePets(defaults, user) {
  if (user && Array.isArray(user.pets)) return user.pets.length ? user.pets : defaults;
  return defaults;
}
function applyUserOverrides(base, user) {
  const next = { ...base, pets: resolvePets(base.pets, user) };
  if (user.animations) next.animations = user.animations;
  if (user.animationWeights) next.animationWeights = user.animationWeights;
  return next;
}

// src/client/constants.ts
var CANVAS_H = 360;
var FEET_Y = 324;
var HIT_BOX = { x0: 210, y0: 40, x1: 430, y1: 575 };
var DRAG_THRESHOLD = 5;

// src/client/settings.ts
var petBridge = {
  current: [],
  sync: () => {
  },
  template: void 0
};
var NS = "pet.config";
var zh = {
  nav: "\u684C\u5BA0\u914D\u7F6E",
  intro: "\u7BA1\u7406\u591A\u4E2A\u684C\u5BA0\uFF1A\u6BCF\u4E2A\u5BA0\u7269\u53EF\u72EC\u7ACB\u8BBE\u7F6E\u5927\u5C0F\u4E0E\u4F4D\u7F6E\uFF08\u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548\uFF09\u3002",
  petsLabel: "\u5BA0\u7269\u5217\u8868",
  add: "\u6DFB\u52A0\u5BA0\u7269",
  remove: "\u5220\u9664",
  confirmRemove: "\u786E\u5B9A\u5220\u9664\u5BA0\u7269\u300C{id}\u300D\u5417\uFF1F",
  confirmTitle: "\u786E\u8BA4\u64CD\u4F5C",
  cancel: "\u53D6\u6D88",
  atLeastOne: "\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u5BA0\u7269\u3002",
  emptyPets: "\u6682\u65E0\u5BA0\u7269\uFF0C\u70B9\u51FB\u300C\u6DFB\u52A0\u5BA0\u7269\u300D\u521B\u5EFA\u3002",
  sizeLabel: "\u5927\u5C0F\uFF08\u5BBD\u5EA6 px\uFF09",
  sizeHint: "\u9AD8\u5EA6\u81EA\u52A8 = \u5BBD\u5EA6 \xD7 9/16\u3002",
  cornerLabel: "\u4F4D\u7F6E",
  "corner.top-left": "\u5DE6\u4E0A\u89D2",
  "corner.top-right": "\u53F3\u4E0A\u89D2",
  "corner.bottom-left": "\u5DE6\u4E0B\u89D2",
  "corner.bottom-right": "\u53F3\u4E0B\u89D2",
  marginX: "\u6C34\u5E73\u504F\u79FB",
  marginY: "\u5782\u76F4\u504F\u79FB",
  save: "\u4FDD\u5B58",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  confirmReset: "\u786E\u5B9A\u6062\u590D\u9ED8\u8BA4\u5417\uFF1F\u5C06\u5220\u9664\u6574\u4E2A\u7528\u6237\u914D\u7F6E\uFF08\u542B\u81EA\u5B9A\u4E49\u7684\u52A8\u753B\u6C60\u4E0E\u64AD\u653E\u6743\u91CD\uFF09\u3002",
  resetHint: "\u300C\u91CD\u7F6E\u300D\u4F1A\u5220\u9664\u6574\u4E2A\u7528\u6237\u914D\u7F6E\uFF08\u542B\u81EA\u5B9A\u4E49\u7684\u52A8\u753B\u6C60\u4E0E\u64AD\u653E\u6743\u91CD\uFF09\uFF0C\u4E0D\u53EA\u662F\u5BA0\u7269\u5217\u8868\u3002",
  configMeta: "\u9AD8\u7EA7\u914D\u7F6E\uFF08\u6587\u4EF6\uFF09",
  configMetaHint: "\u7528\u6237\u914D\u7F6E\u53EF\u8986\u76D6\u5BA0\u7269\u5217\u8868 / \u52A8\u753B\u6C60 / \u64AD\u653E\u6743\u91CD\uFF0C\u4FEE\u6539\u540E\u5237\u65B0\u6216\u91CD\u542F\u751F\u6548\uFF1B\u9ED8\u8BA4\u914D\u7F6E\u4E3A\u5B8C\u6574\u53C2\u8003\u3002",
  defaultConfig: "\u9ED8\u8BA4\u914D\u7F6E\uFF08\u53EA\u8BFB\uFF0C\u5B8C\u6574\u53C2\u8003\uFF09",
  userConfig: "\u7528\u6237\u914D\u7F6E\uFF08\u81EA\u5B9A\u4E49\u8986\u76D6\uFF09",
  animationDir: "\u52A8\u753B\u7D20\u6750\u76EE\u5F55\uFF08\u53EF\u81EA\u5B9A\u4E49/\u6269\u5145\u52A8\u753B\uFF09",
  saved: "\u5DF2\u4FDD\u5B58\uFF0C\u684C\u5BA0\u5373\u65F6\u751F\u6548\u3002",
  loadError: "\u52A0\u8F7D\u914D\u7F6E\u5931\u8D25",
  invalid: "\u8BF7\u68C0\u67E5\u8F93\u5165\uFF1A\u5927\u5C0F\u9700\u4E3A\u6B63\u6570\uFF0C\u8FB9\u8DDD\u53EF\u4E3A\u4EFB\u610F\u6570\u5B57\u3002",
  busy: "\u4FDD\u5B58\u4E2D\u2026"
};
var en = {
  nav: "Pet Config",
  intro: "Manage multiple pets: each pet has its own size and position (applies instantly after saving).",
  petsLabel: "Pets",
  add: "Add pet",
  remove: "Remove",
  confirmRemove: 'Delete pet "{id}"?',
  confirmTitle: "Confirm action",
  cancel: "Cancel",
  atLeastOne: "Keep at least one pet.",
  emptyPets: 'No pets yet \u2014 click "Add pet" to create one.',
  sizeLabel: "Size (width px)",
  sizeHint: "Height is automatic = width \xD7 9/16.",
  cornerLabel: "Position",
  "corner.top-left": "Top-left",
  "corner.top-right": "Top-right",
  "corner.bottom-left": "Bottom-left",
  "corner.bottom-right": "Bottom-right",
  marginX: "Horizontal offset",
  marginY: "Vertical offset",
  save: "Save",
  reset: "Reset to default",
  confirmReset: "Reset to default? This deletes the whole user config (including custom animation pools & weights).",
  resetHint: '"Reset" deletes the whole user config (including custom animation pools & weights), not just the pet list.',
  configMeta: "Advanced (files)",
  configMetaHint: "User config may override pets / animation pools / weights \u2014 refresh or restart to apply. The default config is the complete reference.",
  defaultConfig: "Default config (read-only, complete reference)",
  userConfig: "User config (custom overrides)",
  animationDir: "Animation assets dir (add/customize animations here)",
  saved: "Saved \u2014 the pets updated instantly.",
  loadError: "Failed to load config",
  invalid: "Check your input: size must be positive; margins can be any number.",
  busy: "Saving\u2026"
};
function makePetConfigSection(rt) {
  const { h, useState, useEffect, t } = rt;
  const CORNERS2 = ["top-left", "top-right", "bottom-left", "bottom-right"];
  const cornerLabel = (c) => t("corner." + c);
  const inputStyle = {
    boxSizing: "border-box",
    border: "1px solid var(--dsw-alias-border-l2)",
    borderRadius: "8px",
    background: "var(--dsw-alias-bg-layer-1)",
    color: "var(--dsw-alias-label-primary)",
    padding: "5px 10px",
    fontSize: "13px",
    minHeight: "28px",
    outline: "none"
  };
  const nextId = (list) => {
    let n = 2;
    for (; ; n++) {
      const id = "pet-" + n;
      if (!list.some((p) => p.id === id)) return id;
    }
  };
  return function PetConfigSection() {
    const initPets = petBridge.current;
    const [pets, setPets] = useState(initPets.map((p) => ({ ...p, position: { ...p.position } })));
    const [selId, setSelId] = useState(initPets[0]?.id ?? "");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState({ kind: "", text: "" });
    const [confirm, setConfirm] = useState(null);
    const [paths, setPaths] = useState(null);
    useEffect(() => {
      fetch("/miku-pet/config/meta").then((r) => r.ok ? r.json() : null).then((p) => setPaths(p)).catch(() => console.warn("[miku-pet] \u8BFB\u53D6\u914D\u7F6E\u6587\u4EF6\u8DEF\u5F84\u5931\u8D25"));
    }, []);
    const cur = pets.find((p) => p.id === selId) ?? null;
    const updateSel = (patch) => setPets(
      (list) => list.map((p) => {
        if (p.id !== selId) return p;
        const { position: posPatch, ...rest } = patch;
        return { ...p, ...rest, position: posPatch ? { ...p.position, ...posPatch } : p.position };
      })
    );
    const validated = () => {
      for (const p of pets) {
        if (!Number.isFinite(p.size) || p.size <= 0 || !Number.isFinite(p.position.marginX) || !Number.isFinite(p.position.marginY)) {
          setMsg({ kind: "err", text: t("invalid") });
          return false;
        }
      }
      return true;
    };
    const save = async () => {
      const isOk = validated();
      if (!isOk) return;
      setBusy(true);
      setMsg({ kind: "", text: "" });
      try {
        const res = await fetch("/miku-pet/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pets })
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        petBridge.current = pets;
        petBridge.sync(pets);
        setMsg({ kind: "ok", text: t("saved") });
      } catch {
        setMsg({ kind: "err", text: t("loadError") });
      } finally {
        setBusy(false);
      }
    };
    const reset = () => setConfirm("reset");
    const doReset = async () => {
      setBusy(true);
      setMsg({ kind: "", text: "" });
      try {
        await fetch("/miku-pet/config", { method: "DELETE" });
        const defRes = await fetch("/miku-pet/config.jsonc?v=" + Date.now());
        const defs = assertClientConfig(JSON.parse(stripJsonc(await defRes.text()))).pets;
        setPets(defs.map((p) => ({ ...p, position: { ...p.position } })));
        setSelId(defs[0]?.id ?? "");
        petBridge.current = defs;
        petBridge.sync(defs);
        setMsg({ kind: "ok", text: t("saved") });
      } catch {
        setMsg({ kind: "err", text: t("loadError") });
      } finally {
        setBusy(false);
      }
    };
    const addPet = () => {
      const tpl = petBridge.template;
      if (!tpl) return;
      const id = nextId(pets);
      setPets((list) => [...list, { id, size: tpl.size, position: { ...tpl.position } }]);
      setSelId(id);
    };
    const removeSel = () => {
      if (pets.length <= 1) {
        setMsg({ kind: "err", text: t("atLeastOne") });
        return;
      }
      setConfirm("remove");
    };
    const doRemove = () => {
      const list = pets.filter((p) => p.id !== selId);
      setPets(list);
      setSelId(list[0].id);
    };
    const field = (key, value, setter, width) => h("input", {
      type: "number",
      step: key === "size" ? "10" : "1",
      min: key === "size" ? "120" : "",
      value: String(value),
      disabled: busy,
      onChange: (e) => setter(Number(e.target.value)),
      style: { width, ...inputStyle }
    });
    return h("section", {
      style: {
        maxWidth: "720px",
        color: "var(--dsw-alias-label-primary)",
        display: "flex",
        flexDirection: "column",
        gap: "6px"
      },
      children: [
        h("h2", {
          style: { margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px" },
          children: t("nav")
        }),
        h("p", {
          style: {
            margin: 0,
            fontSize: "14px",
            color: "var(--dsw-alias-label-tertiary)",
            lineHeight: "22px"
          },
          children: t("intro")
        }),
        // 宠物列表 + 添加
        h("div", {
          style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" },
          children: [
            h("span", {
              style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
              children: t("petsLabel")
            }),
            ...pets.map(
              (p) => h("button", {
                key: p.id,
                type: "button",
                onClick: () => setSelId(p.id),
                style: {
                  border: "1px solid " + (p.id === selId ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-border-l2)"),
                  background: p.id === selId ? "var(--dsw-alias-interactive-bg-active)" : "transparent",
                  color: "var(--dsw-alias-label-primary)",
                  borderRadius: "8px",
                  padding: "4px 12px",
                  fontSize: "13px",
                  cursor: "pointer"
                },
                children: p.id + " (" + p.size + "px)"
              })
            ),
            h("button", {
              type: "button",
              onClick: addPet,
              disabled: busy,
              style: {
                border: "1px dashed var(--dsw-alias-border-l2)",
                background: "transparent",
                color: "var(--dsw-alias-label-secondary)",
                borderRadius: "8px",
                padding: "4px 12px",
                fontSize: "13px",
                cursor: "pointer"
              },
              children: "+ " + t("add")
            })
          ]
        }),
        // 选中宠物表单
        cur ? h("div", {
          style: {
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            marginTop: "8px",
            padding: "12px 14px",
            border: "1px solid var(--dsw-alias-border-l2)",
            borderRadius: "12px"
          },
          children: [
            h("label", {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                fontSize: "12px",
                color: "var(--dsw-alias-label-secondary)"
              },
              children: [
                t("sizeLabel"),
                field("size", cur.size, (v) => updateSel({ size: v }), "150px"),
                h("span", {
                  style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
                  children: t("sizeHint")
                })
              ]
            }),
            h("label", {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                fontSize: "12px",
                color: "var(--dsw-alias-label-secondary)"
              },
              children: [
                t("cornerLabel"),
                h("select", {
                  value: cur.position.corner,
                  disabled: busy,
                  onChange: (e) => updateSel({ position: { corner: e.target.value } }),
                  style: { width: "160px", ...inputStyle },
                  children: CORNERS2.map(
                    (c) => h("option", {
                      key: c,
                      value: c,
                      children: cornerLabel(c)
                    })
                  )
                })
              ]
            }),
            h("label", {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                fontSize: "12px",
                color: "var(--dsw-alias-label-secondary)"
              },
              children: [
                t("marginX"),
                field("marginX", cur.position.marginX, (v) => updateSel({ position: { marginX: v } }), "120px")
              ]
            }),
            h("label", {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                fontSize: "12px",
                color: "var(--dsw-alias-label-secondary)"
              },
              children: [
                t("marginY"),
                field("marginY", cur.position.marginY, (v) => updateSel({ position: { marginY: v } }), "120px")
              ]
            }),
            h("button", {
              type: "button",
              onClick: removeSel,
              disabled: busy,
              title: t("remove"),
              style: {
                alignSelf: "flex-end",
                border: "1px solid var(--dsw-alias-state-error-secondary)",
                background: "transparent",
                color: "var(--dsw-alias-state-error-primary)",
                borderRadius: "8px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: "pointer"
              },
              children: t("remove")
            })
          ]
        }) : h("p", {
          style: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-tertiary)" },
          children: t("emptyPets")
        }),
        // 操作区
        h("div", {
          style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" },
          children: [
            h("button", {
              type: "button",
              disabled: busy,
              onClick: save,
              style: {
                border: "1px solid var(--dsw-alias-button-info-fill)",
                background: "var(--dsw-alias-button-info-fill)",
                color: "#fff",
                borderRadius: "8px",
                padding: "4px 14px",
                fontSize: "12px",
                cursor: "pointer",
                opacity: busy ? 0.5 : 1
              },
              children: t("save")
            }),
            h("button", {
              type: "button",
              disabled: busy,
              onClick: reset,
              style: {
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "transparent",
                color: "var(--dsw-alias-label-primary)",
                borderRadius: "8px",
                padding: "4px 14px",
                fontSize: "12px",
                cursor: "pointer",
                opacity: busy ? 0.5 : 1
              },
              children: t("reset")
            }),
            msg.text ? h("span", {
              style: {
                fontSize: "12px",
                color: msg.kind === "err" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-ok-primary)",
                marginLeft: "4px"
              },
              children: msg.text
            }) : null
          ]
        }),
        // 重置的副作用提示（DELETE 会清掉整个用户配置，含高级自定义）
        h("p", {
          style: { margin: 0, fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", lineHeight: "16px" },
          children: t("resetHint")
        }),
        // 高级配置（文件地址）：供高级用户直接编辑配置文件自定义
        paths ? h("div", {
          style: {
            marginTop: "12px",
            padding: "10px 14px",
            border: "1px solid var(--dsw-alias-border-l2)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "12px",
            color: "var(--dsw-alias-label-secondary)"
          },
          children: [
            h("div", {
              style: { fontSize: "12px", color: "var(--dsw-alias-label-primary)", fontWeight: 500 },
              children: t("configMeta")
            }),
            h("div", { style: { fontSize: "12px", lineHeight: "20px" }, children: t("configMetaHint") }),
            h("div", {
              style: { fontSize: "12px", lineHeight: "18px", wordBreak: "break-all" },
              children: t("defaultConfig") + "\uFF1A" + paths.default
            }),
            h("div", {
              style: { fontSize: "12px", lineHeight: "18px", wordBreak: "break-all" },
              children: t("userConfig") + "\uFF1A" + paths.user
            }),
            h("div", {
              style: { fontSize: "12px", lineHeight: "18px", wordBreak: "break-all" },
              children: t("animationDir") + "\uFF1A" + paths.animations
            })
          ]
        }) : null,
        // 确认弹窗（仿官方弹窗视觉：遮罩 + 居中卡片 + 双按钮）
        confirm ? h("div", {
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.45)"
          },
          onClick: () => setConfirm(null),
          children: h("div", {
            style: {
              width: "340px",
              maxWidth: "calc(100vw - 40px)",
              background: "var(--dsw-alias-bg-layer-1)",
              border: "1px solid var(--dsw-alias-border-l2)",
              borderRadius: "12px",
              padding: "16px 18px",
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
              display: "flex",
              flexDirection: "column",
              gap: "12px"
            },
            onClick: (e) => e.stopPropagation(),
            children: [
              h("div", {
                style: { fontSize: "14px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
                children: t("confirmTitle")
              }),
              h("div", {
                style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
                children: confirm === "remove" ? t("confirmRemove").replace("{id}", selId) : t("confirmReset")
              }),
              h("div", {
                style: { display: "flex", gap: "8px", justifyContent: "flex-end" },
                children: [
                  h("button", {
                    type: "button",
                    onClick: () => setConfirm(null),
                    style: {
                      border: "1px solid var(--dsw-alias-border-l2)",
                      background: "transparent",
                      color: "var(--dsw-alias-label-primary)",
                      borderRadius: "8px",
                      padding: "4px 14px",
                      fontSize: "12px",
                      cursor: "pointer"
                    },
                    children: t("cancel")
                  }),
                  h("button", {
                    type: "button",
                    onClick: () => {
                      const k = confirm;
                      setConfirm(null);
                      if (k === "remove") doRemove();
                      else void doReset();
                    },
                    style: confirm === "remove" ? {
                      border: "1px solid var(--dsw-alias-state-error-secondary)",
                      background: "transparent",
                      color: "var(--dsw-alias-state-error-primary)",
                      borderRadius: "8px",
                      padding: "4px 14px",
                      fontSize: "12px",
                      cursor: "pointer"
                    } : {
                      border: "1px solid var(--dsw-alias-button-info-fill)",
                      background: "var(--dsw-alias-button-info-fill)",
                      color: "#fff",
                      borderRadius: "8px",
                      padding: "4px 14px",
                      fontSize: "12px",
                      cursor: "pointer"
                    },
                    children: confirm === "remove" ? t("remove") : t("reset")
                  })
                ]
              })
            ]
          })
        }) : null
      ]
    });
  };
}

// src/client/pet.ts
var config = EMPTY_CONF;
var css = [
  ".miku-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}",
  '.miku-pet-root[data-corner="bottom-right"]{right:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="bottom-left"]{left:var(--miku-pet-mx,24px);bottom:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-right"]{right:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  '.miku-pet-root[data-corner="top-left"]{left:var(--miku-pet-mx,24px);top:var(--miku-pet-my,0)}',
  ".miku-pet-stage{position:relative;width:var(--miku-pet-size,240px);height:var(--miku-pet-size,240px);pointer-events:none}",
  ".miku-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}",
  ".miku-pet-video.is-front{opacity:1}",
  ".miku-pet-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}",
  ".miku-pet-hit.dragging{cursor:grabbing}",
  // 悬停菜单(宠物下方小卡片;悬停出现,可改名)
  ".miku-pet-menu{position:absolute;z-index:6;left:50%;transform:translateX(-50%);top:calc(100% + 6px);pointer-events:auto;display:flex;flex-direction:column;gap:4px;min-width:120px;max-width:200px;background:rgba(22,25,34,.94);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;color:#e9ecf4;box-shadow:0 6px 18px rgba(0,0,0,.4)}",
  ".miku-pet-menu b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".miku-pet-menu-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
  ".miku-pet-menu input{margin:0;flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:5px;color:#e9ecf4;font-size:12px;padding:2px 6px;outline:none}",
  ".miku-pet-menu input:focus{border-color:#4c8dff}",
  ".miku-pet-menu button{appearance:none;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);color:#e9ecf4;border-radius:5px;font-size:12px;padding:2px 8px;cursor:pointer}",
  ".miku-pet-menu button:hover{background:rgba(255,255,255,.2)}",
  ".miku-pet-menu button.primary{background:#2f6bff;border-color:#2f6bff}",
  ".miku-pet-menu button.primary:hover{background:#3d76ff}",
  ".miku-pet-menu button:disabled{opacity:.55;cursor:default}",
  // 对话气泡(点击/随机动作按动作弹出对应台词;贴近头顶上方)
  ".miku-pet-bubble{position:absolute;z-index:5;left:50%;transform:translateX(-50%);bottom:calc(100% + 4px);max-width:180px;background:rgba(255,255,255,.96);border:1.5px solid #17a8c9;border-radius:12px 12px 12px 3px;color:#0b5c6d;font-size:12px;line-height:1.4;padding:5px 9px;pointer-events:none;box-shadow:0 2px 10px rgba(23,168,201,.3);animation:miku-bubble-in .18s ease-out;text-align:center;white-space:normal}",
  "@keyframes miku-bubble-in{from{transform:translateX(-50%) scale(.6);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}",
  // 左侧属性彩条(饥饿/心情/活力 0-100;悬停时与菜单一起显示)
  ".miku-pet-stats{position:absolute;z-index:4;right:calc(100% + 6px);top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:3px;pointer-events:none;background:rgba(22,25,34,.55);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 6px;min-width:88px}",
  ".miku-pet-stat{display:flex;align-items:center;gap:4px;font-size:10px;line-height:12px;color:#dfe3ec;white-space:nowrap}",
  ".miku-pet-stat-label{text-align:left;color:#cdd3e0}",
  ".miku-pet-stat-track{flex:1;height:5px;min-width:34px;background:rgba(255,255,255,.16);border-radius:3px;overflow:hidden}",
  ".miku-pet-stat-fill{display:block;height:100%;border-radius:3px;transition:width .25s ease}",
  ".miku-pet-stat-num{width:22px;text-align:right;color:#8b93a5;font-variant-numeric:tabular-nums}",
  // 商店物品卡片(整体放大:面板/图/文字/按钮)
  ".miku-pet-shop-row{display:flex;gap:10px;align-items:center;min-width:0}",
  ".miku-pet-shop-img{width:58px;height:58px;object-fit:contain;border-radius:8px;background:rgba(0,0,0,.06);flex:none}",
  ".miku-pet-shop-info{flex:1;min-width:0;font-size:15px;line-height:21px;color:#e9ecf4}",
  ".miku-pet-shop-info b{display:block;font-size:13px;color:#b45309;font-weight:600}",
  ".miku-pet-shop-panel .miku-pet-menu-row b{font-size:17px}",
  ".miku-pet-shop-panel button{font-size:14px;padding:5px 14px}",
  // 商店独立窗口(网页中央模态)
  ".miku-pet-shop-overlay{position:fixed;inset:0;z-index:60;background:rgba(8,10,16,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}",
  ".miku-pet-shop-panel{pointer-events:auto;background:rgba(22,25,34,.98);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:22px 26px;min-width:380px;max-width:500px;display:flex;flex-direction:column;gap:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);animation:miku-shop-in .16s ease-out}",
  "@keyframes miku-shop-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}",
  // 明亮主题适配:面板白底黑字。
  // 前缀 html body .miku-pet-root[data-miku-lit][data-miku-root] 特异性 (0,4,2)+,
  // 且各面板自身带 [data-miku-lit]((0,5,2)+),稳压皮肤 patches 的
  // html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu](0,3,2) !important 深蓝渐变;
  // 同时写 background + background-color 双属性。
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit]{background:#fff!important;background-color:#fff!important;background-image:none!important;border:1px solid rgba(0,0,0,.14)!important;border-color:rgba(0,0,0,.14)!important;color:#1f2329!important;box-shadow:0 6px 18px rgba(0,0,0,.18)}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row{background:transparent!important;background-color:transparent!important;background-image:none!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-menu-row{background:transparent!important;background-color:transparent!important;background-image:none!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] .miku-pet-menu-row b{color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] input{background:#fff!important;background-color:#fff!important;border:1px solid rgba(0,0,0,.2)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button{background:rgba(0,0,0,.05)!important;background-color:rgba(0,0,0,.05)!important;border:1px solid rgba(0,0,0,.16)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:hover{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary{background:rgba(0,0,0,.12)!important;background-color:rgba(0,0,0,.12)!important;border-color:rgba(0,0,0,.2)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button.primary:hover{background:rgba(0,0,0,.18)!important;background-color:rgba(0,0,0,.18)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-menu[data-miku-lit] button:disabled{opacity:.55!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button{background:rgba(0,0,0,.05)!important;background-color:rgba(0,0,0,.05)!important;border:1px solid rgba(0,0,0,.16)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button:hover{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button.primary{background:rgba(0,0,0,.12)!important;background-color:rgba(0,0,0,.12)!important;border-color:rgba(0,0,0,.2)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] button.primary:hover{background:rgba(0,0,0,.18)!important;background-color:rgba(0,0,0,.18)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit]{background:rgba(255,255,255,.92)!important;background-color:rgba(255,255,255,.92)!important;border:1px solid rgba(0,0,0,.12)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat{color:#2a2f38!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-label{color:#4a5261!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-track{background:rgba(0,0,0,.1)!important;background-color:rgba(0,0,0,.1)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-stats[data-miku-lit] .miku-pet-stat-num{color:#6b7280!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-overlay{background:rgba(8,10,16,.55)!important;background-color:rgba(8,10,16,.55)!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit]{background:#fff!important;background-color:#fff!important;background-image:none!important;border:1px solid rgba(0,0,0,.14)!important;border-color:rgba(0,0,0,.14)!important;color:#1f2329!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-info{color:#2a2f38!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-info b{color:#b45309!important}",
  "html body .miku-pet-root[data-miku-lit][data-miku-root] .miku-pet-shop-panel[data-miku-lit] .miku-pet-shop-img{background:rgba(0,0,0,.06)!important;background-color:rgba(0,0,0,.06)!important}",
  "@media (prefers-reduced-motion: reduce){.miku-pet-video{transition:none}}"
].join("\n");
var cssTag = "miku-pet/style.css";
function injectCss() {
  if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "miku-pet";
    tag.dataset.pluginCss = cssTag;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
}
var ROLL_INTERVAL_MS = 5e3;
var MAX_MISS = 2;
var FRAME_V = Date.now();
var STAT_DEFS = [
  { key: "hunger", label: "\u9965\u997F\u503C", color: "#ff9f43" },
  { key: "mood", label: "\u5FC3\u60C5\u503C", color: "#ff6b81" },
  { key: "energy", label: "\u6D3B\u529B\u503C", color: "#2ed573" }
];
var SHOP_ITEMS = [
  { id: "food1", img: "/miku-pet/thumb/shop/miku-pet-shop1.png", price: 5, hunger: 40, label: "\u9999\u6D53\u53EF\u53E3\u7684\u8D85\u7EA7\u65E0\u654C\u9EC4\u6CB9\u9762\u5305" },
  { id: "food2", img: "/miku-pet/thumb/shop/miku-pet-shop2.png", price: 10, hunger: 80, label: "\u95EA\u95EA\u53D1\u4EAE\u65B0\u9C9C\u51FA\u7089\u7684\u7EA2\u8C46\u6C99\u5305" }
];
var clampStat = (v) => Math.min(100, Math.max(0, Math.round(v)));
function makePetUI(rt) {
  const { h, useState, useEffect, useRef } = rt;
  injectCss();
  function PetCard({ cfg }) {
    const [size, setSize] = useState(cfg.size);
    const halfW = size / 2;
    const halfH = size / 2;
    const [anim, setAnim] = useState(config.animations.idle[0] ?? "");
    const [once, setOnce] = useState(false);
    const [facing, setFacing] = useState("left");
    const [dragging, setDragging] = useState(false);
    const [customPos, setCustomPos] = useState(null);
    const [corner, setCorner] = useState(cfg.position.corner);
    const [margin, setMargin] = useState({ x: cfg.position.marginX, y: cfg.position.marginY });
    useEffect(() => {
      setSize(cfg.size);
      setCorner(cfg.position.corner);
      setMargin({ x: cfg.position.marginX, y: cfg.position.marginY });
    }, [cfg.size, cfg.position.corner, cfg.position.marginX, cfg.position.marginY]);
    const [seq, setSeq] = useState(0);
    const STATS_KEY = "miku-pet:stats";
    const [stats, setStats] = useState(() => {
      const clamp = (v) => typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100;
      try {
        const raw = JSON.parse(window.localStorage.getItem(STATS_KEY) ?? '{"hunger":100,"mood":100,"energy":100}');
        return { hunger: clamp(raw?.hunger), mood: clamp(raw?.mood), energy: clamp(raw?.energy) };
      } catch {
        return { hunger: 100, mood: 100, energy: 100 };
      }
    });
    useEffect(() => {
      try {
        window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      } catch {
      }
    }, [stats]);
    const HUNGER_DECAY_MS = 6e4;
    const HUNGER_DECAY_NORMAL = 1;
    const HUNGER_DECAY_WORKING = 5;
    useEffect(() => {
      const timer = window.setInterval(() => {
        setStats((prev) => {
          const decay = workingRef.current ? HUNGER_DECAY_WORKING : HUNGER_DECAY_NORMAL;
          if (prev.hunger <= 0) return prev;
          return { ...prev, hunger: Math.max(0, prev.hunger - decay) };
        });
      }, HUNGER_DECAY_MS);
      return () => window.clearInterval(timer);
    }, []);
    const nameKey = "miku-pet:name:" + cfg.id;
    const [petName, setPetName] = useState(() => {
      try {
        return window.localStorage.getItem(nameKey) ?? cfg.name ?? "";
      } catch {
        return cfg.name ?? "";
      }
    });
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuView, setMenuView] = useState("root");
    const [shopOpen, setShopOpen] = useState(false);
    const menuOpenRef = useRef(false);
    const [nameDraft, setNameDraft] = useState("");
    const menuTimerRef = useRef(null);
    useEffect(() => {
      try {
        const saved = window.localStorage.getItem(nameKey);
        setPetName(saved ?? cfg.name ?? "");
      } catch {
        setPetName(cfg.name ?? "");
      }
    }, [nameKey, cfg.name]);
    const [bubble, setBubble] = useState("");
    const bubbleTimerRef = useRef(null);
    const showBubble = (action) => {
      const pool = config.phrases?.[action];
      if (!pool || !pool.length) return;
      const text = pool[Math.floor(Math.random() * pool.length)];
      setBubble(text);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = window.setTimeout(() => setBubble(""), 2600);
    };
    const COINS_KEY = "miku-pet:coins";
    const WORK_DURATION_MS = 1e4;
    const coinsRef = useRef(0);
    const [coins, setCoins] = useState(() => {
      try {
        const v = Number(window.localStorage.getItem(COINS_KEY));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      } catch {
        return 0;
      }
    });
    coinsRef.current = coins;
    const [working, setWorking] = useState(false);
    const workingRef = useRef(false);
    const workTimerRef = useRef(null);
    const workPlay = (next, once2) => {
      setAnim(next);
      setOnce(once2);
      setSeq((s) => s + 1);
    };
    const workCycle = () => {
      if (!workingRef.current) return;
      workPlay(config.animations.work?.[0] ?? "work", false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      workTimerRef.current = window.setTimeout(() => {
        if (!workingRef.current) return;
        const ok = Math.random() < 0.5;
        const result = ok ? "success" : "fail";
        workPlay(config.animations[result]?.[0] ?? result, true);
        const nextCoins = Math.max(0, coinsRef.current + (ok ? 3 : -1));
        coinsRef.current = nextCoins;
        setCoins(nextCoins);
        try {
          window.localStorage.setItem(COINS_KEY, String(nextCoins));
        } catch {
        }
        showBubble(result);
        if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
        workTimerRef.current = window.setTimeout(() => {
          workCycle();
        }, ok ? 1300 : 1900);
      }, WORK_DURATION_MS);
    };
    const doWork = () => {
      if (workingRef.current || dragRef.current.active) return;
      workingRef.current = true;
      setWorking(true);
      closeMenuNow();
      workCycle();
    };
    const stopWork = () => {
      if (!workingRef.current) return;
      workingRef.current = false;
      setWorking(false);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
      backToIdle();
    };
    const buyItem = (item) => {
      if (coinsRef.current < item.price) {
        showBubble("\u91D1\u5E01\u4E0D\u8DB3\u2026");
        return;
      }
      const next = coinsRef.current - item.price;
      coinsRef.current = next;
      setCoins(next);
      try {
        window.localStorage.setItem(COINS_KEY, String(next));
      } catch {
      }
      setStats((s) => ({ ...s, hunger: clampStat(s.hunger + item.hunger) }));
      showBubble(item.hunger >= 80 ? "\u5927\u4EFD\u4E0B\u809A,\u7CBE\u795E\u6EE1\u6EE1~" : "\u5403\u9971\u9971\u5566~");
    };
    const openMenu = () => {
      if (dragRef.current.active || justDraggedRef.current) return;
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (!menuOpenRef.current) setMenuView("root");
      menuOpenRef.current = true;
      setMenuOpen(true);
    };
    const closeMenuNow = () => {
      menuOpenRef.current = false;
      setMenuView("root");
      setMenuOpen(false);
    };
    const closeMenu = () => {
      if (menuView === "rename") return;
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      menuTimerRef.current = window.setTimeout(() => {
        closeMenuNow();
      }, 260);
    };
    const startRename = () => {
      setNameDraft(petName);
      setMenuView("rename");
    };
    const saveName = () => {
      const v = (nameDraft || "").trim().slice(0, 32);
      if (v) {
        try {
          window.localStorage.setItem(nameKey, v);
        } catch {
        }
        setPetName(v);
      }
      closeMenuNow();
    };
    const rootRef = useRef(null);
    const stageRef = useRef(null);
    const imgRef = useRef(null);
    const frameListRef = useRef([]);
    const frameIdxRef = useRef(0);
    const frameTimerRef = useRef(null);
    const onceRef = useRef(true);
    const curActionRef = useRef("");
    const genRef = useRef(0);
    const dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 });
    const justDraggedRef = useRef(false);
    const idleMissRef = useRef(0);
    const animRef = useRef(anim);
    animRef.current = anim;
    const playFrame = (gen) => {
      const list = frameListRef.current;
      if (!list.length) return;
      if (frameIdxRef.current >= list.length) {
        if (onceRef.current) {
          handleEnded();
          return;
        }
        frameIdxRef.current = 0;
      }
      const f = list[frameIdxRef.current];
      frameIdxRef.current += 1;
      const img = imgRef.current;
      if (img) img.src = "/miku-pet/thumb/" + encodeURIComponent(curActionRef.current) + "/" + encodeURIComponent(f.name) + "?v=" + FRAME_V;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = window.setTimeout(() => playFrame(gen), f.ms);
    };
    const switchTo = (next, nextOnce) => {
      if (!next) return;
      const gen = ++genRef.current;
      curActionRef.current = next;
      onceRef.current = nextOnce;
      if (frameTimerRef.current !== null) window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
      void fetch("/miku-pet/frames/" + encodeURIComponent(next) + "?v=" + FRAME_V).then((r) => r.ok ? r.json() : { frames: [] }).then((data) => {
        if (gen !== genRef.current) return;
        frameListRef.current = data.frames || [];
        frameIdxRef.current = 0;
        playFrame(gen);
      }).catch(() => {
      });
    };
    useEffect(() => {
      switchTo(anim, once);
    }, [anim, once, seq]);
    useEffect(() => () => {
      stopMove();
      if (menuTimerRef.current !== null) window.clearTimeout(menuTimerRef.current);
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
    }, []);
    useEffect(() => {
      const onResize = () => setCustomPos((prev) => prev ? { ...prev } : prev);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);
    const backToIdle = () => {
      idleMissRef.current = 0;
      if (config.animations.idle.length) {
        setAnim(pick(config.animations.idle, animRef.current));
        setOnce(false);
        setSeq((s) => s + 1);
      }
    };
    const handleEnded = () => {
      const { animations } = config;
      if (dragRef.current.active) return;
      if (animations.turn.includes(animRef.current)) {
        const next = facing === "left" ? "right" : "left";
        setFacing(next);
        facingRef.current = next;
        backToIdle();
        return;
      }
      backToIdle();
    };
    const moveRef = useRef(null);
    const moveTokenRef = useRef(0);
    const pendingMoveRef = useRef(null);
    const customPosRef = useRef(customPos);
    customPosRef.current = customPos;
    const currentCenterX = () => {
      const cp = customPosRef.current;
      if (cp) return cp.rx * window.innerWidth;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
      return window.innerWidth - 24 - halfW;
    };
    const currentCenterY = () => {
      const cp = customPosRef.current;
      if (cp) return cp.ry * window.innerHeight;
      const rootEl = rootRef.current;
      if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
      return window.innerHeight - 20 - halfH;
    };
    const startMoveDrive = (el) => {
      const pm = pendingMoveRef.current;
      if (!pm || moveRef.current !== null) return;
      pendingMoveRef.current = null;
      const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
      const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
      const token = ++moveTokenRef.current;
      const step = () => {
        if (moveTokenRef.current !== token) return;
        const t = el.currentTime || 0;
        const rootEl = rootRef.current;
        if (rootEl) {
          const W = window.innerWidth;
          const H = window.innerHeight;
          let ratioX;
          if (t <= leadSec) ratioX = startRatio;
          else if (t >= duration - tailSec) ratioX = targetRatio;
          else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
          const px = ratioX * W;
          const py = startYRatio * H;
          rootEl.style.left = px - halfW + "px";
          rootEl.style.top = py - halfH + "px";
          rootEl.style.right = "auto";
          rootEl.style.bottom = "auto";
        }
        if (t < duration - tailSec) moveRef.current = requestAnimationFrame(step);
        else {
          moveRef.current = null;
          setCustomPos({ rx: targetRatio, ry: startYRatio });
        }
      };
      moveRef.current = requestAnimationFrame(step);
    };
    const tryMove = () => {
      if (moveRef.current !== null || pendingMoveRef.current) return true;
      const moves = config.animations.moves;
      const actions = moves.actions;
      if (!actions.length) return false;
      const chosen = actions[Math.floor(Math.random() * actions.length)];
      const mp = Object.assign({}, moves.default, chosen.params || {});
      const dir = facingRef.current === "right" !== config.animations.turn.includes(animRef.current) ? 1 : -1;
      const W = window.innerWidth;
      const plan = planMove({
        cx: currentCenterX(),
        cy: currentCenterY(),
        W,
        H: window.innerHeight,
        dir,
        minDist: mp.minDist,
        maxDist: mp.maxDist,
        margin: mp.margin,
        halfW
      });
      if (!plan) return false;
      pendingMoveRef.current = {
        ...plan,
        dir,
        leadSec: mp.leadSec,
        tailSec: mp.tailSec
      };
      setOnce(true);
      setAnim(chosen.name);
      return true;
    };
    const stopMove = () => {
      pendingMoveRef.current = null;
      moveTokenRef.current++;
      if (moveRef.current !== null) {
        cancelAnimationFrame(moveRef.current);
        moveRef.current = null;
      }
    };
    const facingRef = useRef(facing);
    facingRef.current = facing;
    const tryMoveRef = useRef(tryMove);
    tryMoveRef.current = tryMove;
    useEffect(() => {
      const timer = window.setInterval(() => {
        const { animations, animationWeights } = config;
        if (dragRef.current.active || moveRef.current !== null || pendingMoveRef.current) return;
        const cur = animRef.current;
        if (!cur || !animations.idle.includes(cur)) return;
        const force = idleMissRef.current >= MAX_MISS;
        const roll = Math.random();
        const k = rollKind(roll, animationWeights);
        if (!force && k === "idle") {
          idleMissRef.current += 1;
          return;
        }
        idleMissRef.current = 0;
        let kind;
        let next;
        if (k === "turn" && animations.turn.length) {
          kind = "TURN";
          next = pick(animations.turn, cur);
        } else if (k === "move" && tryMoveRef.current()) {
          return;
        } else {
          const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, cur);
          kind = act.id;
          next = act.name;
        }
        console.log(
          "[miku-pet] " + (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8) + " pet=" + cfg.id + " facing=" + facingRef.current + " roll=" + roll.toFixed(4) + " -> [" + kind + "] " + next
        );
        setAnim(next);
        setOnce(true);
        setSeq((s) => s + 1);
        showBubble(next);
      }, ROLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
    }, []);
    const handlePointerDown = (e) => {
      if (workingRef.current) stopWork();
      e.currentTarget.classList.add("dragging");
      stopMove();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rootEl = rootRef.current;
      let offX = 0;
      let offY = 0;
      if (rootEl) {
        const rr = rootEl.getBoundingClientRect();
        offX = e.clientX - (rr.left + rr.width / 2);
        offY = e.clientY - (rr.top + rr.height / 2);
      }
      dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
    };
    const handlePointerMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.dragging = true;
        setDragging(true);
        setOnce(false);
        if (config.animations.drag.length) setAnim(pick(config.animations.drag));
      }
      const rootEl = rootRef.current;
      if (rootEl) {
        rootEl.style.left = e.clientX - d.offX - halfW + "px";
        rootEl.style.top = e.clientY - d.offY - halfH + "px";
        rootEl.style.right = "auto";
        rootEl.style.bottom = "auto";
      }
      const stageEl = stageRef.current;
      if (stageEl) stageEl.style.transform = "none";
    };
    const handlePointerUp = (e) => {
      const d = dragRef.current;
      const wasDragging = d.dragging;
      d.active = false;
      d.dragging = false;
      e.currentTarget.classList.remove("dragging");
      if (wasDragging) {
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 100);
        setDragging(false);
        setCustomPos({ rx: (e.clientX - d.offX) / window.innerWidth, ry: (e.clientY - d.offY) / window.innerHeight });
        const stageEl = stageRef.current;
        if (stageEl) stageEl.style.transform = "translateY(" + bottomPad + "px)";
        const standupPool = config.animations.standup;
        if (standupPool && standupPool.length) {
          console.log(
            "[miku-pet] " + (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8) + " pet=" + cfg.id + " drag-end -> standup: " + standupPool.join(",")
          );
          setAnim(pick(standupPool, animRef.current));
          setOnce(true);
        } else {
          console.log("[miku-pet] " + (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8) + " pet=" + cfg.id + " drag-end -> idle (no standup pool)");
          if (config.animations.idle.length) {
            setAnim(pick(config.animations.idle, animRef.current));
            setOnce(false);
          }
        }
      }
    };
    const handleClick = () => {
      const d = dragRef.current;
      if (d.active || d.dragging || justDraggedRef.current) return;
      if (once && !config.animations.idle.includes(animRef.current)) return;
      stopMove();
      setOnce(true);
      if (config.animations.clicks.length) {
        const n = pick(config.animations.clicks);
        setAnim(n);
        showBubble(n);
      }
    };
    const bottomPad = size * (CANVAS_H - FEET_Y) / CANVAS_H;
    const stageStyle = dragging ? { transform: "none" } : { transform: "translateY(" + bottomPad + "px)" };
    const rootStyle = customPos ? (() => {
      const rx = customPos.rx;
      const ry = customPos.ry;
      const left = Math.min(Math.max(rx * window.innerWidth - halfW, 0), window.innerWidth - size);
      const top = Math.min(Math.max(ry * window.innerHeight - halfH, 0), window.innerHeight - size);
      return { left: left + "px", top: top + "px", right: "auto", bottom: "auto" };
    })() : {};
    const hitProps = {
      className: "miku-pet-hit",
      style: {
        left: HIT_BOX.x0 / 640 * 100 + "%",
        top: HIT_BOX.y0 / 360 * 100 + "%",
        width: (HIT_BOX.x1 - HIT_BOX.x0) / 640 * 100 + "%",
        height: (HIT_BOX.y1 - HIT_BOX.y0) / 360 * 100 + "%"
      },
      onMouseEnter: (e) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = "grab";
      },
      onMouseLeave: (e) => {
        if (!dragRef.current.active) e.currentTarget.style.cursor = "default";
      },
      // 悬停菜单：进入显示、离开 260ms 后收起（留时间把鼠标挪进菜单）
      onPointerEnter: openMenu,
      onPointerLeave: closeMenu,
      onClick: handleClick,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      title: "miku-pet"
    };
    const menuNode = menuOpen ? h("div", {
      className: "miku-pet-menu",
      "data-miku-lit": "1",
      onPointerEnter: openMenu,
      onPointerLeave: closeMenu,
      children: menuView === "rename" ? [
        h("div", { className: "miku-pet-menu-row", children: [h("input", {
          value: nameDraft,
          maxLength: 32,
          onInput: (e) => setNameDraft(e.currentTarget.value),
          onKeyDown: (e) => {
            const native = e.nativeEvent;
            if (native.isComposing || native.keyCode === 229) return;
            if (e.key === "Enter") void saveName();
            if (e.key === "Escape") {
              closeMenuNow();
            }
          }
        })] }),
        h("div", { className: "miku-pet-menu-row", children: [
          h("button", { className: "primary", onClick: (e) => {
            e.stopPropagation();
            void saveName();
          }, children: "\u4FDD\u5B58" }),
          h("button", { onClick: (e) => {
            e.stopPropagation();
            setMenuView("root");
          }, children: "\u53D6\u6D88" })
        ] })
      ] : menuView === "wallet" ? [
        h("div", { className: "miku-pet-menu-row", children: [h("b", { children: "\u91D1\u5E01: " + coins })] }),
        h("div", { className: "miku-pet-menu-row", children: [
          h("button", { className: "primary", onClick: (e) => {
            e.stopPropagation();
            setMenuView("root");
          }, children: "\u8FD4\u56DE" })
        ] })
      ] : [
        h("div", { className: "miku-pet-menu-row", children: [h("b", { children: petName || "\u672A\u547D\u540D" })] }),
        h("div", { className: "miku-pet-menu-row", children: [
          h("button", { onClick: (e) => {
            e.stopPropagation();
            startRename();
          }, children: "\u6539\u540D" }),
          h("button", {
            onClick: (e) => {
              e.stopPropagation();
              setMenuView("wallet");
            },
            children: "\u94B1\u5305"
          }),
          h("button", {
            onClick: (e) => {
              e.stopPropagation();
              closeMenuNow();
              setShopOpen(true);
            },
            children: "\u5546\u5E97"
          }),
          h("button", {
            className: "primary",
            disabled: working,
            onClick: (e) => {
              e.stopPropagation();
              doWork();
            },
            children: working ? "\u5DE5\u4F5C\u4E2D\u2026" : "\u5DE5\u4F5C"
          })
        ] })
      ]
    }) : null;
    return h("div", {
      ref: rootRef,
      className: "miku-pet-root",
      "data-corner": corner,
      "data-facing": facing,
      // 高特异性钩子:供覆盖规则压过 GUI 皮肤 patches(html[data-dsh-skin] body[data-ds-dark-theme] [class*=menu] !important)
      "data-miku-lit": "1",
      "data-miku-root": "1",
      style: Object.assign(
        { "--miku-pet-size": size + "px", "--miku-pet-mx": margin.x + "px", "--miku-pet-my": margin.y + "px" },
        rootStyle,
        // 商店打开时把整个根提到最顶层,遮罩可覆盖页面全部(含应用自身浮层)
        shopOpen ? { zIndex: 99999 } : {}
      ),
      children: [
        h("div", {
          ref: stageRef,
          className: "miku-pet-stage",
          style: stageStyle,
          children: [
            h("img", {
              ref: imgRef,
              className: "miku-pet-video is-front",
              style: { transform: facing === "right" ? "scaleX(-1)" : "scaleX(1)" },
              alt: "miku-pet"
            }),
            h("div", hitProps)
          ]
        }),
        // 名字不再常驻显示(悬停菜单里就能看到,见 menuNode 首行)
        null,
        // 左侧属性彩条(饥饿/心情/活力 0-100;与菜单同显隐)
        menuOpen ? h("div", {
          className: "miku-pet-stats",
          "data-miku-lit": "1",
          children: STAT_DEFS.map(
            (d) => h("div", { className: "miku-pet-stat", children: [
              h("span", { className: "miku-pet-stat-label", children: d.label }),
              h("span", { className: "miku-pet-stat-track", children: [
                h("span", { className: "miku-pet-stat-fill", style: { width: stats[d.key] + "%", background: d.color } })
              ] }),
              h("span", { className: "miku-pet-stat-num", children: String(stats[d.key]) })
            ] })
          )
        }) : null,
        // 对话气泡（按动作弹台词；自动隐藏）
        bubble ? h("div", { className: "miku-pet-bubble", children: bubble }) : null,
        // 悬停菜单
        menuNode,
        // 商店独立窗口（网页中央模态；点遮罩或「关闭」收起）
        shopOpen ? h("div", {
          className: "miku-pet-shop-overlay",
          onClick: () => setShopOpen(false),
          children: h("div", {
            className: "miku-pet-shop-panel",
            "data-miku-lit": "1",
            onClick: (e) => e.stopPropagation(),
            children: [
              h("div", { className: "miku-pet-menu-row", children: [h("b", { children: "\u5546\u5E97 \xB7 \u91D1\u5E01: " + coins })] }),
              ...SHOP_ITEMS.map(
                (it) => h("div", { className: "miku-pet-shop-row", children: [
                  h("img", { className: "miku-pet-shop-img", src: it.img, alt: it.id }),
                  h("div", { className: "miku-pet-shop-info", children: [
                    it.label,
                    h("b", { children: it.price + " \u91D1\u5E01 / \u6062\u590D " + it.hunger + " \u9965\u997F" })
                  ] }),
                  h("button", {
                    className: "primary",
                    onClick: (e) => {
                      e.stopPropagation();
                      buyItem(it);
                    },
                    children: "\u8D2D\u4E70"
                  })
                ] })
              ),
              h("div", { className: "miku-pet-menu-row", children: [
                h("button", { className: "primary", onClick: (e) => {
                  e.stopPropagation();
                  setShopOpen(false);
                }, children: "\u5173\u95ED" })
              ] })
            ]
          })
        }) : null
      ]
    });
  }
  function PetMulti() {
    const [pets, setPets] = useState([]);
    const [ready, setReady] = useState(false);
    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const r1 = await fetch("/miku-pet/config.jsonc?v=" + Date.now());
          if (!r1.ok) throw new Error("config.jsonc HTTP " + r1.status);
          config = assertClientConfig(JSON.parse(stripJsonc(await r1.text())));
          const defaults = config.pets;
          let user = {};
          try {
            const r2 = await fetch("/miku-pet/config");
            if (r2.ok && r2.status !== 204) user = await r2.json().catch(() => ({}));
          } catch {
          }
          config = applyUserOverrides(config, user);
          const merged = config.pets;
          if (!alive) return;
          petBridge.current = merged;
          petBridge.template = defaults.length ? defaults[0] : void 0;
          petBridge.sync = (list) => {
            setPets(list);
            petBridge.current = list;
          };
          setPets(merged);
          setReady(true);
        } catch (e) {
          console.error("[miku-pet] \u914D\u7F6E\u52A0\u8F7D\u5931\u8D25", e);
        }
      })();
      return () => {
        alive = false;
        petBridge.sync = () => {
        };
      };
    }, []);
    return ready ? pets.map((p) => h(PetCard, { key: p.id, cfg: p })) : null;
  }
  return PetMulti;
}

// src/client/app.ts
function makeFactory() {
  return (require2) => {
    const module = { exports: {} };
    const react = require2("react");
    const { useEffect, useRef, useState } = react;
    const { jsx: h } = require2("react/jsx-runtime");
    const PetMulti = makePetUI({ h, useState, useEffect, useRef });
    const name = "miku-pet";
    const inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "miku-pet: dictionaries");
      const t = ctx.locale.bind(NS);
      ctx.slots.inject("shell.overlay", function* () {
        yield ctx.slots.register({ name: "shell.overlay", id: "miku-pet", order: 1e3 }, () => h(PetMulti, {}));
      });
      const PetConfigSection = makePetConfigSection({ h, useState, useEffect, t });
      ctx.slots.inject("settings.section", function* () {
        yield ctx.slots.register(
          { name: "settings.section", id: "miku-pet-config", order: 30, label: () => t("nav"), inject: () => ({ t }) },
          PetConfigSection
        );
      });
    }
    module.exports = { apply, inject, name };
    return module.exports;
  };
}

// src/client/index.ts
window.__ModuleLoader__.load({
  id: "miku-pet",
  factory: makeFactory()
});
console.log("[miku-pet] client build b10-2026-08-23 (all buttons neutral, no blue)");
