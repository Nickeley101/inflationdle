// A small stand-in for Cloudflare D1 backed by Node's built-in SQLite, so the Worker's real SQL runs in tests.
// Only the calls worker/index.js uses are here: prepare().bind().run()/first() and batch().
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {ROOT} from "./paths.mjs";

export function createD1({failWith} = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(`${ROOT}/worker/schema.sql`, "utf8"));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    async run() {
      if (failWith) throw failWith;
      const r = db.prepare(sql).run(...args);
      return {success: true, meta: {changes: Number(r.changes)}};
    },
    async first() {
      if (failWith) throw failWith;
      const row = db.prepare(sql).get(...args);
      return row ? {...row} : null;
    },
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    async batch(list) {
      if (failWith) throw failWith;
      db.exec("BEGIN");
      try {
        const out = list.map(s => ({meta: {changes: Number(db.prepare(s.sql).run(...s.args).changes)}}));
        db.exec("COMMIT");
        return out;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}
