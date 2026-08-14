"use strict";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var import_cosmokit = require("cosmokit");
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) {
      if (typeof segment === "string") {
        prefix += "." + segment;
      } else if (typeof segment === "number") {
        prefix += "[" + segment + "]";
      } else if (typeof segment === "symbol") {
        prefix += `[Symbol(${segment.toString()})]`;
      }
    }
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static {
    __name(this, "ValidationError");
  }
  name = "ValidationError";
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, {
  value: true
});
var Schema = /* @__PURE__ */ __name(function(options) {
  const schema = /* @__PURE__ */ __name(function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  }, "schema");
  if (options.refs) {
    const refs = (0, import_cosmokit.valueMap)(options.refs, (options2) => new Schema(options2));
    const getRef = /* @__PURE__ */ __name((uid) => refs[uid], "getRef");
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && (0, import_cosmokit.valueMap)(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") {
    try {
      schema.callback = new Function("return " + schema.callback)();
    } catch {
    }
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
}, "Schema");
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", {
  get() {
    return {
      version: 1,
      vendor: "schemastery",
      validate: /* @__PURE__ */ __name((value) => {
        try {
          return { value: Schema.resolve(value, this, {})[0] };
        } catch (error) {
          if (ValidationError.is(error)) {
            return { issues: [{ message: error.message, path: error.options.path }] };
          }
          throw error;
        }
      }, "validate")
    };
  }
});
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = /* @__PURE__ */ __name(function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = { uid: this.uid, refs: globalThis.__schemastery_refs__ };
  globalThis.__schemastery_refs__ = void 0;
  return result;
}, "toJSON");
Schema.prototype.set = /* @__PURE__ */ __name(function set(key, value) {
  this.dict[key] = value;
  return this;
}, "set");
Schema.prototype.push = /* @__PURE__ */ __name(function push(value) {
  this.list.push(value);
  return this;
}, "push");
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) {
      result[locale] = value.$description || value.$desc;
    } else if (typeof value === "string") {
      result[locale] = value;
    }
  }
  return result;
}
__name(mergeDesc, "mergeDesc");
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
__name(getInner, "getInner");
function extractKeys(data) {
  return (0, import_cosmokit.filterKeys)(data ?? {}, (key) => !key.startsWith("$"));
}
__name(extractKeys, "extractKeys");
Schema.prototype.i18n = /* @__PURE__ */ __name(function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) {
    schema.dict = (0, import_cosmokit.valueMap)(schema.dict, (inner, key) => {
      return inner.i18n((0, import_cosmokit.valueMap)(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
    });
  }
  if (schema.list) {
    schema.list = schema.list.map((inner, index) => {
      return inner.i18n((0, import_cosmokit.valueMap)(messages, (data = {}) => {
        if (Array.isArray(getInner(data))) return getInner(data)[index];
        if (Array.isArray(data)) return data[index];
        return extractKeys(data);
      }));
    });
  }
  if (schema.inner) {
    schema.inner = schema.inner.i18n((0, import_cosmokit.valueMap)(messages, (data) => {
      if (getInner(data)) return getInner(data);
      return extractKeys(data);
    }));
  }
  if (schema.sKey) {
    schema.sKey = schema.sKey.i18n((0, import_cosmokit.valueMap)(messages, (data) => data?.$key));
  }
  return schema;
}, "i18n");
Schema.prototype.extra = /* @__PURE__ */ __name(function extra(key, value) {
  const schema = Schema(this);
  schema.meta = { ...schema.meta, [key]: value };
  return schema;
}, "extra");
for (const key of ["required", "disabled", "collapse", "hidden", "loose"]) {
  Object.assign(Schema.prototype, {
    [key](value = true) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }
  });
}
Schema.prototype.deprecated = /* @__PURE__ */ __name(function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({ text: "deprecated", type: "danger" });
  return schema;
}, "deprecated");
Schema.prototype.experimental = /* @__PURE__ */ __name(function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({ text: "experimental", type: "warning" });
  return schema;
}, "experimental");
Schema.prototype.pattern = /* @__PURE__ */ __name(function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = (0, import_cosmokit.pick)(regexp, ["source", "flags"]);
  schema.meta = { ...schema.meta, pattern: pattern2 };
  return schema;
}, "pattern");
Schema.prototype.simplify = /* @__PURE__ */ __name(function simplify(value) {
  if ((0, import_cosmokit.deepEqual)(value, this.meta.default, this.type === "dict")) return null;
  if ((0, import_cosmokit.isNullable)(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const schema = this.type === "object" ? this.dict[key] : this.inner;
      const item = schema?.simplify(value[key]);
      if (this.type === "dict" || !(0, import_cosmokit.isNullable)(item)) result[key] = item;
    }
    if ((0, import_cosmokit.deepEqual)(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) {
      Object.assign(result, item.simplify(value));
    }
    return result;
  } else if (this.type === "union") {
    for (const schema of this.list) {
      try {
        Schema.resolve(value, schema, {});
        return schema.simplify(value);
      } catch {
      }
    }
  }
  return value;
}, "simplify");
Schema.prototype.toString = /* @__PURE__ */ __name(function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
}, "toString");
Schema.prototype.role = /* @__PURE__ */ __name(function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = { ...schema.meta, role, extra: extra2 };
  return schema;
}, "role");
for (const key of ["default", "link", "comment", "description", "max", "min", "step"]) {
  Object.assign(Schema.prototype, {
    [key](value) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }
  });
}
var resolvers = {};
Schema.extend = /* @__PURE__ */ __name(function extend(type, resolve2) {
  resolvers[type] = resolve2;
}, "extend");
Schema.resolve = /* @__PURE__ */ __name(function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if ((0, import_cosmokit.isNullable)(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && (0, import_cosmokit.isNullable)(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if ((0, import_cosmokit.isNullable)(fallback)) return [data];
    data = (0, import_cosmokit.clone)(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
}, "resolve");
Schema.from = /* @__PURE__ */ __name(function from(source) {
  if ((0, import_cosmokit.isNullable)(source)) {
    return Schema.any();
  } else if (["string", "number", "boolean"].includes(typeof source)) {
    return Schema.const(source).required();
  } else if (source[kSchema]) {
    return source;
  } else if (typeof source === "function") {
    switch (source) {
      case String:
        return Schema.string().required();
      case Number:
        return Schema.number().required();
      case Boolean:
        return Schema.boolean().required();
      case Function:
        return Schema.function().required();
      default:
        return Schema.is(source).required();
    }
  } else {
    throw new TypeError(`cannot infer schema from ${source}`);
  }
}, "from");
Schema.lazy = /* @__PURE__ */ __name(function lazy(builder) {
  const toJSON2 = /* @__PURE__ */ __name(() => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
    }
    return schema.inner.toJSON();
  }, "toJSON");
  const schema = new Schema({ type: "lazy", builder, inner: { toJSON: toJSON2 } });
  return schema;
}, "lazy");
Schema.natural = /* @__PURE__ */ __name(function natural() {
  return Schema.number().step(1).min(0);
}, "natural");
Schema.percent = /* @__PURE__ */ __name(function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
}, "percent");
Schema.date = /* @__PURE__ */ __name(function date() {
  return Schema.union([
    Schema.is(Date),
    Schema.transform(Schema.string().role("datetime"), (value, options) => {
      const date2 = new Date(value);
      if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
      return date2;
    }, true)
  ]);
}, "date");
Schema.regExp = /* @__PURE__ */ __name(function regExp(flag = "") {
  return Schema.union([
    Schema.is(RegExp),
    Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
      try {
        return new RegExp(value, flag);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)
  ]);
}, "regExp");
Schema.arrayBuffer = /* @__PURE__ */ __name(function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (import_cosmokit.Binary.isSource(value)) return import_cosmokit.Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? import_cosmokit.Binary.fromBase64(value) : import_cosmokit.Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
}, "arrayBuffer");
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if ((0, import_cosmokit.deepEqual)(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
__name(checkWithinRange, "checkWithinRange");
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
__name(decimalShift, "decimalShift");
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) {
    return (data - min) % step === 0;
  }
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
__name(isMultipleOf, "isMultipleOf");
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) {
    throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  }
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) {
      if (data & bits[key]) {
        keys.push(key);
      }
    }
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else {
    throw new ValidationError(`expected number or array but got ${data}`, options);
  }
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if ((0, import_cosmokit.isNullable)(data)) {
      throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    }
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
__name(property, "property");
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !(0, import_cosmokit.isNullable)(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!(0, import_cosmokit.isPlainObject)(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
__name(merge, "merge");
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!(0, import_cosmokit.isPlainObject)(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!(0, import_cosmokit.isNullable)(value) || key in data) {
      result[key] = value;
    }
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) {
    try {
      return Schema.resolve(data, inner, options, strict);
    } catch (error) {
      messages.push(error);
    }
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if ((0, import_cosmokit.isNullable)(value)) continue;
    if ((0, import_cosmokit.isNullable)(result)) {
      result = value;
    } else if (typeof result !== typeof value) {
      throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    } else if (typeof value === "object") {
      merge(result ??= {}, value);
    } else if (result !== value) {
      throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    }
  }
  if (!strict && (0, import_cosmokit.isPlainObject)(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) {
    return [callback(result)];
  } else {
    return [callback(result), callback(adapted)];
  }
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, {
    [name](...args) {
      const schema = new Schema({ type: name });
      keys.forEach((key, index) => {
        switch (key) {
          case "sKey":
            schema.sKey = args[index] ?? Schema.string();
            break;
          case "inner":
            schema.inner = Schema.from(args[index]);
            break;
          case "list":
            schema.list = args[index].map(Schema.from);
            break;
          case "dict":
            schema.dict = (0, import_cosmokit.valueMap)(args[index], Schema.from);
            break;
          case "bits": {
            schema.bits = {};
            for (const key2 in args[index]) {
              if (typeof args[index][key2] !== "number") continue;
              schema.bits[key2] = args[index][key2];
            }
            break;
          }
          case "callback": {
            const callback = schema.callback = args[index];
            callback["toJSON"] ||= () => callback.toString();
            break;
          }
          case "constructor": {
            const constructor = schema.constructor = args[index];
            if (typeof constructor === "function") {
              ;
              constructor["toJSON"] ||= () => constructor["name"];
            }
            break;
          }
          default:
            schema[key] = args[index];
        }
      });
      if (name === "object" || name === "dict") {
        schema.meta.default = {};
      } else if (name === "array" || name === "tuple") {
        schema.meta.default = [];
      } else if (name === "bitset") {
        schema.meta.default = 0;
      }
      return schema;
    }
  });
}
__name(defineMethod, "defineMethod");
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") {
    return constructor.name;
  } else {
    return constructor;
  }
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", ["inner", "callback", "preserve"], ({ inner }, isInner) => inner.toString(isInner));
module.exports = Schema;
//# sourceMappingURL=index.cjs.map
