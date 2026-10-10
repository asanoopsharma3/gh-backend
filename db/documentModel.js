import { getPool } from "../config/db.js";

const definitions = new Map();
const models = new Map();

const columnSpec = (spec) => (typeof spec === "string" ? { column: spec, type: "text" } : spec);

const isOperatorObject = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  !(value instanceof Date) &&
  !(value instanceof RegExp) &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => key.startsWith("$"));

const assertIdentifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Invalid identifier ${value}`);
};

const addParam = (params, value) => {
  params.push(value);
  return `$${params.length}`;
};

const resolveField = (definition, key) => {
  if (key === "_id" || key === "id") return { expr: "id", kind: "id" };
  if (key === "createdAt") return { expr: "created_at", kind: "date" };
  if (key === "updatedAt") return { expr: "updated_at", kind: "date" };
  const [head, ...rest] = String(key).split(".");
  const spec = definition.columns?.[head] ? columnSpec(definition.columns[head]) : null;
  if (!spec) throw new Error(`Unknown field ${key}`);
  assertIdentifier(spec.column);
  if (rest.length && spec.type === "jsonb") {
    rest.forEach(assertIdentifier);
    return { expr: `${spec.column} #>> '{${rest.join(",")}}'`, kind: "text" };
  }
  return { expr: spec.column, kind: spec.type || "text" };
};

const operatorSql = (field, value, params) => {
  const parts = [];
  const numeric = field.kind === "number";
  const date = field.kind === "date";
  const expr = numeric ? `${field.expr}::numeric` : field.expr;
  const cast = date ? "::timestamp" : "";
  for (const [name, sql] of [["$gte", ">="], ["$gt", ">"], ["$lte", "<="], ["$lt", "<"]]) {
    if (value[name] !== undefined) parts.push(`${expr} ${sql} ${addParam(params, value[name])}${cast}`);
  }
  if (value.$in) {
    parts.push(`${field.expr}::text = ANY(${addParam(params, value.$in.map((item) => String(item)))}::text[])`);
  }
  if (!parts.length) throw new Error(`Unsupported filter on ${field.expr}`);
  return parts.join(" AND ");
};

const predicate = (definition, key, value, params) => {
  const field = resolveField(definition, key);
  if (value instanceof RegExp) return `${field.expr}::text ~* ${addParam(params, value.source)}`;
  if (isOperatorObject(value)) return operatorSql(field, value, params);
  if (value == null) return `${field.expr} IS NULL`;
  if (field.kind === "id") return `${field.expr} = ${addParam(params, value)}::bigint`;
  if (field.kind === "date") {
    const date = value instanceof Date ? value : new Date(value);
    return `${field.expr} = ${addParam(params, date)}::timestamp`;
  }
  if (field.kind === "boolean") return `${field.expr} = ${addParam(params, Boolean(value))}`;
  if (field.kind === "number") return `${field.expr} = ${addParam(params, Number(value))}`;
  return `${field.expr} = ${addParam(params, String(value))}`;
};

const compileFilter = (definition, filter = {}, params = []) => {
  const parts = [];
  for (const [key, value] of Object.entries(filter || {})) {
    if (key === "$or" || key === "$and") {
      const joiner = key === "$or" ? " OR " : " AND ";
      const inner = (value || []).map((item) => `(${compileFilter(definition, item, params)})`).join(joiner);
      parts.push(`(${inner || (key === "$or" ? "FALSE" : "TRUE")})`);
      continue;
    }
    parts.push(`(${predicate(definition, key, value, params)})`);
  }
  return parts.join(" AND ") || "TRUE";
};

const orderBy = (definition, sort) => {
  if (!sort) return "";
  const parts = Object.entries(sort).map(([key, direction]) => {
    const field = resolveField(definition, key);
    return `${field.expr} ${Number(direction) < 0 ? "DESC" : "ASC"}`;
  });
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
};

const limitSql = (limit) => {
  if (limit == null) return "";
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid limit");
  return `LIMIT ${value}`;
};

const snapshot = (doc) => {
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith("_") && key !== "_id") continue;
    if (typeof value === "function") continue;
    out[key] = value;
  }
  return out;
};

const applyDefaults = (definition, data) => {
  const next = { ...(data || {}) };
  for (const [key, spec] of Object.entries(definition.columns || {})) {
    const column = columnSpec(spec);
    if (next[key] === undefined && column.default !== undefined) {
      next[key] = typeof column.default === "function" ? column.default() : column.default;
    }
  }
  for (const [key, relation] of Object.entries(definition.relations || {})) {
    if (next[key] === undefined) next[key] = typeof relation.default === "function" ? relation.default() : [];
  }
  return next;
};

const bindValue = (spec, value) => {
  const column = columnSpec(spec);
  if (value == null || value === "") return null;
  if (column.type === "date") return value instanceof Date ? value : new Date(value);
  if (column.type === "jsonb") return JSON.stringify(value);
  if (column.type === "number") return Number(value);
  if (column.type === "boolean") return Boolean(value);
  if (column.type === "text[]") return Array.isArray(value) ? value.map(String) : [];
  return value;
};

const readValue = (spec, value) => {
  const column = columnSpec(spec);
  if (value == null) return value;
  if (column.type === "number") return Number(value);
  if (column.type === "jsonb" && typeof value === "string") return JSON.parse(value);
  return value;
};

const hydrate = (Model, definition, row, { lean }) => {
  const data = { _id: row.id };
  for (const [field, spec] of Object.entries(definition.columns || {})) {
    data[field] = readValue(spec, row[columnSpec(spec).column]);
  }
  for (const field of Object.keys(definition.relations || {})) {
    data[field] = [];
  }
  data.createdAt = row.created_at;
  data.updatedAt = row.updated_at;
  if (lean) return data;
  const doc = Object.create(Model.prototype);
  Object.assign(doc, data);
  doc._isNew = false;
  return doc;
};

const hydrateRelation = (relation, row) => {
  const item = { _id: row.id };
  for (const [field, spec] of Object.entries(relation.columns)) {
    item[field] = readValue(spec, row[columnSpec(spec).column]);
  }
  return item;
};

const loadRelations = async (definition, docs, db = getPool()) => {
  const list = docs.filter(Boolean);
  if (!list.length) return;
  for (const [field, relation] of Object.entries(definition.relations || {})) {
    const ids = list.map((doc) => doc._id).filter(Boolean);
    if (!ids.length) continue;
    assertIdentifier(relation.table);
    assertIdentifier(relation.foreignKey);
    const result = await db.query(
      `SELECT * FROM ${relation.table} WHERE ${relation.foreignKey} = ANY($1::bigint[]) ORDER BY ${relation.order || "id"}`,
      [ids]
    );
    const grouped = new Map();
    for (const row of result.rows) {
      const key = String(row[relation.foreignKey]);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(hydrateRelation(relation, row));
    }
    for (const doc of list) doc[field] = grouped.get(String(doc._id)) || [];
  }
};

const syncRelations = async (client, definition, doc) => {
  for (const [field, relation] of Object.entries(definition.relations || {})) {
    if (!Array.isArray(doc[field])) continue;
    assertIdentifier(relation.table);
    assertIdentifier(relation.foreignKey);
    const items = doc[field];
    const keptIds = items.map((item) => item?._id).filter((id) => id != null && id !== "");
    if (keptIds.length) {
      await client.query(
        `DELETE FROM ${relation.table} WHERE ${relation.foreignKey} = $1 AND id <> ALL($2::bigint[])`,
        [doc._id, keptIds]
      );
    } else {
      await client.query(`DELETE FROM ${relation.table} WHERE ${relation.foreignKey} = $1`, [doc._id]);
    }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      const columns = [relation.foreignKey];
      const values = [doc._id];
      const placeholders = ["$1"];
      let param = 2;
      if (relation.position) {
        columns.push(relation.position);
        values.push(index);
        placeholders.push(`$${param}`);
        param += 1;
      }
      for (const [itemField, spec] of Object.entries(relation.columns)) {
        const column = columnSpec(spec);
        columns.push(column.column);
        values.push(bindValue(column, item[itemField]));
        placeholders.push(column.type === "jsonb" ? `$${param}::jsonb` : column.type === "text[]" ? `$${param}::text[]` : `$${param}`);
        param += 1;
      }
      if (item._id) {
        const assignments = columns.slice(1).map((column, assignmentIndex) => `${column} = ${placeholders[assignmentIndex + 1]}`);
        await client.query(
          `UPDATE ${relation.table} SET ${assignments.join(", ")} WHERE id = $${param} AND ${relation.foreignKey} = $1`,
          [...values, item._id]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO ${relation.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
          values
        );
        item._id = inserted.rows[0].id;
      }
    }
  }
};

const parentColumns = (definition, data, { insert }) => {
  const columns = [];
  const values = [];
  const placeholders = [];
  let param = 1;
  const push = (column, value, cast = "") => {
    columns.push(column);
    values.push(value);
    placeholders.push(`$${param}${cast}`);
    param += 1;
  };
  for (const [field, spec] of Object.entries(definition.columns || {})) {
    if (data[field] === undefined) continue;
    const column = columnSpec(spec);
    const cast = column.type === "jsonb" ? "::jsonb" : column.type === "text[]" ? "::text[]" : "";
    push(column.column, bindValue(column, data[field]), cast);
  }
  const now = data.updatedAt || new Date();
  if (insert) push("created_at", data.createdAt || now);
  push("updated_at", now);
  return { columns, values, placeholders };
};

const insertParent = async (client, definition, doc) => {
  const { columns, values, placeholders } = parentColumns(definition, doc, { insert: true });
  const result = await client.query(
    `INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id, created_at, updated_at`,
    values
  );
  doc._id = result.rows[0].id;
  doc.createdAt = result.rows[0].created_at;
  doc.updatedAt = result.rows[0].updated_at;
};

const updateParent = async (client, definition, doc) => {
  const { columns, values, placeholders } = parentColumns(definition, doc, { insert: false });
  const assignments = columns.map((column, index) => `${column} = ${placeholders[index]}`);
  const result = await client.query(
    `UPDATE ${definition.table} SET ${assignments.join(", ")} WHERE id = $${values.length + 1}::bigint RETURNING updated_at`,
    [...values, doc._id]
  );
  if (!result.rowCount) throw new Error(`${definition.table} row ${doc._id} was not found`);
  doc.updatedAt = result.rows[0].updated_at;
};

const validate = (definition, doc) => {
  for (const field of definition.required || []) {
    if (doc[field] === undefined || doc[field] === null || doc[field] === "") {
      throw new Error(`${field} is required`);
    }
  }
  for (const [field, allowed] of Object.entries(definition.enums || {})) {
    if (doc[field] === undefined || doc[field] === null || doc[field] === "") continue;
    if (!allowed.includes(doc[field])) throw new Error(`${field} must be one of ${allowed.join(", ")}`);
  }
};

const persist = async (doc, definition, client = getPool()) => {
  if (typeof definition.beforeSave === "function") definition.beforeSave(doc);
  validate(definition, doc);
  const run = async (db) => {
    if (doc._isNew !== false) await insertParent(db, definition, doc);
    else await updateParent(db, definition, doc);
    await syncRelations(db, definition, doc);
  };
  try {
    if (client === getPool()) {
      const held = await getPool().connect();
      try {
        await held.query("BEGIN");
        await run(held);
        await held.query("COMMIT");
      } catch (error) {
        await held.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        held.release();
      }
    } else {
      await run(client);
    }
  } catch (error) {
    if (error.code === "23505") throw new Error(`Duplicate value in ${definition.table}`);
    throw error;
  }
  doc._isNew = false;
  return doc;
};

const applySelect = (doc, select) => {
  if (!select) return doc;
  const tokens = String(select).split(/\s+/).filter(Boolean);
  const excluding = tokens.length > 0 && tokens.every((token) => token.startsWith("-"));
  if (excluding) {
    for (const token of tokens) delete doc[token.slice(1)];
    return doc;
  }
  const source = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const picked = { _id: source._id };
  for (const token of tokens) {
    if (!token.startsWith("-")) picked[token] = source[token];
  }
  return picked;
};

const collectIds = (node, parts, ids) => {
  if (!node || !parts.length) return;
  const [head, ...rest] = parts;
  if (!rest.length) {
    const value = node[head];
    if (value != null && value !== "" && (typeof value !== "object" || value?._id)) {
      ids.add(String(value?._id || value));
    }
    return;
  }
  const next = node[head];
  if (Array.isArray(next)) next.forEach((item) => collectIds(item, rest, ids));
  else collectIds(next, rest, ids);
};

const assignPopulated = (node, parts, map) => {
  if (!node || !parts.length) return;
  const [head, ...rest] = parts;
  if (!rest.length) {
    const value = node[head];
    const id = value?._id ? String(value._id) : value != null ? String(value) : "";
    if (!id) return;
    node[head] = map.get(id) || null;
    return;
  }
  const next = node[head];
  if (Array.isArray(next)) next.forEach((item) => assignPopulated(item, rest, map));
  else assignPopulated(next, rest, map);
};

const applyPopulate = async (docs, populates, definition) => {
  for (const pop of populates) {
    const refTable = definition.refs?.[pop.path];
    const refDefinition = definitions.get(refTable);
    const RefModel = models.get(refTable);
    if (!refTable || !refDefinition || !RefModel) continue;
    const parts = pop.path.split(".");
    const ids = new Set();
    docs.forEach((doc) => collectIds(doc, parts, ids));
    if (!ids.size) continue;
    const result = await getPool().query(`SELECT * FROM ${refTable} WHERE id = ANY($1::bigint[])`, [[...ids]]);
    const fields = String(pop.fields || "").split(/\s+/).filter(Boolean);
    const map = new Map();
    for (const row of result.rows) {
      const full = hydrate(RefModel, refDefinition, row, { lean: true });
      const picked = fields.length ? { _id: full._id } : full;
      for (const field of fields) picked[field] = full[field];
      map.set(String(full._id), picked);
    }
    docs.forEach((doc) => assignPopulated(doc, parts, map));
  }
};

const withTimeout = async (timeout, fn) => {
  if (!timeout) return fn(getPool());
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeout)]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const plainFilterData = (filter) => {
  const data = {};
  for (const [key, value] of Object.entries(filter || {})) {
    if (key.startsWith("$") || isOperatorObject(value)) continue;
    data[key] = value;
  }
  return data;
};

const applyUpdate = (doc, update) => {
  if (!update || typeof update !== "object") return;
  const hasOperator = Object.keys(update).some((key) => key.startsWith("$"));
  if (!hasOperator) {
    Object.assign(doc, update);
    return;
  }
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      doc[key] = Number(doc[key] || 0) + Number(amount);
    }
  }
};

const getPath = (obj, path) => path.split(".").reduce((current, key) => current?.[key], obj);

const projectDoc = (doc, spec) => {
  const out = {};
  for (const [key, value] of Object.entries(spec)) {
    if (key === "_id") continue;
    if (value === 1) out[key] = doc[key];
    else if (typeof value === "string" && value.startsWith("$")) out[key] = getPath(doc, value.slice(1));
  }
  if (spec._id !== 0) out._id = doc._id;
  return out;
};

const shouldLoadRelations = (definition, select) => {
  if (!definition.relations || !Object.keys(definition.relations).length) return false;
  if (!select) return true;
  const tokens = String(select).split(/\s+/).filter(Boolean);
  const excluding = tokens.every((token) => token.startsWith("-"));
  if (excluding) return tokens.every((token) => !Object.prototype.hasOwnProperty.call(definition.relations, token.slice(1)));
  return tokens.some((token) => Object.prototype.hasOwnProperty.call(definition.relations, token));
};

class Query {
  constructor(Model, definition, filter, { one = false } = {}) {
    this.Model = Model;
    this.definition = definition;
    this.filter = filter || {};
    this.one = one;
    this._limit = one ? 1 : null;
    this._sort = null;
    this._select = null;
    this._timeout = null;
    this._lean = false;
    this._populates = [];
  }

  select(value) { this._select = value; return this; }
  limit(value) { this._limit = value; return this; }
  sort(value) { this._sort = value; return this; }
  maxTimeMS(value) { this._timeout = value; return this; }
  lean() { this._lean = true; return this; }
  populate(path, fields) { this._populates.push({ path, fields }); return this; }

  async exec() {
    const params = [];
    const where = compileFilter(this.definition, this.filter, params);
    const sql = `SELECT * FROM ${this.definition.table} WHERE ${where} ${orderBy(this.definition, this._sort)} ${limitSql(this._limit)}`;
    const result = await withTimeout(this._timeout, (db) => db.query(sql, params));
    const tokens = String(this._select || "").split(/\s+/).filter(Boolean);
    const inclusion = tokens.some((token) => token && !token.startsWith("-"));
    let docs = result.rows.map((row) => hydrate(this.Model, this.definition, row, { lean: this._lean || inclusion }));
    if (shouldLoadRelations(this.definition, this._select)) await loadRelations(this.definition, docs);
    docs = docs.map((doc) => applySelect(doc, this._select));
    if (this._populates.length) await applyPopulate(docs, this._populates, this.definition);
    return this.one ? docs[0] || null : docs;
  }

  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}

const countDocuments = (definition, filter = {}) => {
  let timeout = 0;
  let pending = null;
  const run = () => {
    if (!pending) {
      const params = [];
      const where = compileFilter(definition, filter, params);
      pending = withTimeout(timeout, (db) =>
        db.query(`SELECT COUNT(*)::int AS count FROM ${definition.table} WHERE ${where}`, params)
      ).then((result) => result.rows[0]?.count || 0);
    }
    return pending;
  };
  const thenable = {
    maxTimeMS(value) { timeout = value; pending = null; return thenable; },
    then(onFulfilled, onRejected) { return run().then(onFulfilled, onRejected); },
    catch(onRejected) { return run().catch(onRejected); },
  };
  return thenable;
};

const findOneAndUpdate = async (Model, definition, filter, update, options = {}) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const params = [];
    const where = compileFilter(definition, filter, params);
    const existing = await client.query(
      `SELECT * FROM ${definition.table} WHERE ${where} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      params
    );
    if (existing.rows[0]) {
      const doc = hydrate(Model, definition, existing.rows[0], { lean: false });
      await loadRelations(definition, [doc], client);
      const previous = doc.toObject();
      applyUpdate(doc, update);
      doc._isNew = false;
      await persist(doc, definition, client);
      await client.query("COMMIT");
      if (options.new) return doc;
      const old = Object.assign(Object.create(Model.prototype), previous, { _isNew: false });
      return old;
    }
    if (!options.upsert) {
      await client.query("COMMIT");
      return null;
    }
    const doc = new Model({ ...plainFilterData(filter) });
    applyUpdate(doc, update);
    await persist(doc, definition, client);
    await client.query("COMMIT");
    return doc;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw new Error(`Duplicate value in ${definition.table}`);
    throw error;
  } finally {
    client.release();
  }
};

export function createModel(definition) {
  assertIdentifier(definition.table);
  definitions.set(definition.table, definition);

  class Model {
    constructor(data = {}) {
      Object.assign(this, applyDefaults(definition, data));
      this._isNew = true;
    }

    async save() { return persist(this, definition); }
    toObject() { return snapshot(this); }
    toJSON() { return this.toObject(); }
  }

  Model.table = definition.table;
  Model.create = async (data) => {
    const doc = new Model(data);
    await doc.save();
    return doc;
  };
  Model.find = (filter = {}) => new Query(Model, definition, filter);
  Model.findOne = (filter = {}) => new Query(Model, definition, filter, { one: true });
  Model.findById = (id) => {
    if (id == null || id === "") return Promise.resolve(null);
    return new Query(Model, definition, { _id: id }, { one: true });
  };
  Model.findByIdAndDelete = async (id) => {
    if (id == null || id === "") return null;
    const existing = await Model.findById(id);
    await getPool().query(`DELETE FROM ${definition.table} WHERE id = $1::bigint`, [id]);
    return existing;
  };
  Model.findOneAndUpdate = (filter, update, options) => findOneAndUpdate(Model, definition, filter, update, options);
  Model.updateMany = async (filter, update) => {
    const docs = await Model.find(filter);
    let modifiedCount = 0;
    for (const doc of docs) {
      applyUpdate(doc, update);
      await doc.save();
      modifiedCount += 1;
    }
    return { matchedCount: docs.length, modifiedCount };
  };
  Model.countDocuments = (filter) => countDocuments(definition, filter);
  Model.aggregate = async (pipeline) => {
    let docs = [];
    for (const stage of pipeline) {
      if (stage.$match) docs = await Model.find(stage.$match).lean();
      else if (stage.$lookup) {
        const foreign = models.get(stage.$lookup.from);
        const foreignDefinition = definitions.get(stage.$lookup.from);
        const ids = [...new Set(docs.map((doc) => doc[stage.$lookup.localField]).filter((id) => id != null).map(String))];
        const related = new Map();
        if (foreign && ids.length) {
          const result = await getPool().query(`SELECT * FROM ${stage.$lookup.from} WHERE id = ANY($1::bigint[])`, [ids]);
          for (const row of result.rows) {
            const item = hydrate(foreign, foreignDefinition, row, { lean: true });
            related.set(String(item._id), item);
          }
        }
        docs = docs.map((doc) => ({
          ...doc,
          [stage.$lookup.as]: related.get(String(doc[stage.$lookup.localField])) ? [related.get(String(doc[stage.$lookup.localField]))] : [],
        }));
      } else if (stage.$unwind) {
        const field = String(stage.$unwind).replace(/^\$/, "");
        docs = docs.flatMap((doc) => {
          const value = doc[field];
          if (!Array.isArray(value) || !value.length) return [];
          return value.map((item) => ({ ...doc, [field]: item }));
        });
      } else if (stage.$project) docs = docs.map((doc) => projectDoc(doc, stage.$project));
      else if (stage.$sort) {
        const entries = Object.entries(stage.$sort);
        docs = [...docs].sort((left, right) => {
          for (const [key, direction] of entries) {
            const delta = Number(left[key] || 0) - Number(right[key] || 0);
            if (delta !== 0) return direction < 0 ? -delta : delta;
          }
          return 0;
        });
      } else if (stage.$limit != null) docs = docs.slice(0, Number(stage.$limit));
    }
    return docs;
  };

  models.set(definition.table, Model);
  return Model;
}
