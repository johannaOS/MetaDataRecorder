/**
 * In-memory expo-sqlite mock for Jest.
 * Supports the specific SQL patterns used in lib/db.ts.
 */

function createDb() {
  const tables = {};   // tableName → row[]
  const counters = {}; // tableName → nextId

  function ensureTable(name) {
    if (!tables[name]) { tables[name] = []; counters[name] = 1; }
  }
  function getRows(name) { ensureTable(name); return tables[name]; }
  function takeId(name)  { const id = counters[name]; counters[name]++; return id; }

  // ── WHERE evaluation ────────────────────────────────────────────────────────

  function evalWhere(expr, row) {
    expr = expr.trim();
    // Strip matching outer parens
    if (expr.startsWith('(') && expr.endsWith(')') && isBalanced(expr.slice(1, -1))) {
      expr = expr.slice(1, -1).trim();
    }

    const andParts = splitTop(expr, 'AND');
    if (andParts.length > 1) return andParts.every(p => evalWhere(p, row));

    const orParts = splitTop(expr, 'OR');
    if (orParts.length > 1) return orParts.some(p => evalWhere(p, row));

    // col LIKE 'pattern'
    let m = expr.match(/^(\w+)\s+LIKE\s+'([^']*)'/i);
    if (m) {
      const pat = m[2].replace(/%/g, '.*').replace(/(?<!\.)\b_\b(?!\.)/g, '.');
      // simpler: just replace % with .* for contains-style search
      const reStr = '^' + m[2].split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
      return new RegExp(reStr, 'i').test(String(row[m[1]] ?? ''));
    }
    // col != 'val'
    m = expr.match(/^(\w+)\s*(?:!=|<>)\s*'([^']*)'/i);
    if (m) return String(row[m[1]] ?? '') !== m[2];
    // col = 'val'
    m = expr.match(/^(\w+)\s*=\s*'([^']*)'/i);
    if (m) return String(row[m[1]] ?? '') === m[2];
    // col = number
    m = expr.match(/^(\w+)\s*=\s*(-?\d+)$/);
    if (m) return String(row[m[1]]) === m[2];

    return true;
  }

  function isBalanced(str) {
    let d = 0;
    for (const ch of str) {
      if (ch === '(') d++;
      else if (ch === ')') { d--; if (d < 0) return false; }
    }
    return d === 0;
  }

  function splitTop(str, keyword) {
    const kw = ' ' + keyword.toUpperCase() + ' ';
    const result = [];
    let depth = 0, start = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      else if (depth === 0 && str.slice(i, i + kw.length).toUpperCase() === kw) {
        result.push(str.slice(start, i).trim());
        start = i + kw.length;
        i += kw.length - 1;
      }
    }
    result.push(str.slice(start).trim());
    return result.filter(Boolean);
  }

  function resolveWhere(whereStr, params) {
    let pi = 0;
    return whereStr.replace(/\?/g, () => {
      const v = params[pi++];
      return typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v ?? '');
    });
  }

  function sortRows(rows, orderStr) {
    if (!orderStr) return rows;
    const parts = orderStr.trim().split(/\s+/);
    const col = parts[0];
    const desc = (parts[1] || '').toUpperCase() === 'DESC';
    return [...rows].sort((a, b) => {
      const cmp = String(a[col] ?? '').localeCompare(String(b[col] ?? ''));
      return desc ? -cmp : cmp;
    });
  }

  // Parse VALUES clause: returns array of raw token strings (may be '?', '0', '1', subquery)
  function parseValueTokens(valuesClause) {
    // strip outer parens
    const inner = valuesClause.trim().replace(/^\(/, '').replace(/\)$/, '');
    const tokens = [];
    let depth = 0, cur = '';
    for (const ch of inner) {
      if (ch === '(') { depth++; cur += ch; }
      else if (ch === ')') { depth--; cur += ch; }
      else if (ch === ',' && depth === 0) { tokens.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) tokens.push(cur.trim());
    return tokens;
  }

  // ── Mock db object ─────────────────────────────────────────────────────────

  return {
    execSync(sql) {
      const s = sql.trim();
      const ct = s.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
      if (ct) { ensureTable(ct[1]); return; }
      if (/ALTER TABLE/i.test(s)) throw new Error('mock: column already exists');
    },

    runSync(sql, ...params) {
      const s = sql.trim().replace(/\s+/g, ' ');
      const isIgnore = /INSERT OR IGNORE INTO/i.test(s);

      // INSERT [OR IGNORE] INTO
      if (/INSERT(?:\s+OR\s+IGNORE)?\s+INTO/i.test(s)) {
        const m = s.match(/INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*(.+)/is);
        if (!m) return { lastInsertRowId: 0, changes: 0 };
        const table = m[1];
        const cols = m[2].split(',').map(c => c.trim());
        const rows = getRows(table);

        // Parse value tokens first so we can check uniqueness
        const valueTokens = parseValueTokens(m[3]);
        let paramIdx = 0;
        const id = takeId(table);
        const row = { id };

        cols.forEach((col, i) => {
          const tok = valueTokens[i] || '?';
          if (tok === '?') {
            row[col] = params[paramIdx++];
          } else if (/^-?\d+$/.test(tok)) {
            row[col] = parseInt(tok, 10);
          } else if (/^\(SELECT/i.test(tok)) {
            const maxSort = rows.reduce((mx, r) => Math.max(mx, r.sortOrder ?? -1), -1);
            row[col] = maxSort + 1;
          } else {
            row[col] = tok;
          }
        });

        // Unique check for OR IGNORE (check 'key' and 'label' as known unique columns)
        if (isIgnore) {
          for (const uniqueCol of ['key', 'label']) {
            if (uniqueCol in row && row[uniqueCol] !== undefined) {
              if (rows.some(r => r[uniqueCol] === row[uniqueCol])) {
                return { lastInsertRowId: 0, changes: 0 };
              }
            }
          }
        }

        rows.push(row);
        return { lastInsertRowId: id, changes: 1 };
      }

      // UPDATE table SET col=?,... WHERE col=?
      if (/^UPDATE/i.test(s)) {
        const m = s.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?/i);
        if (!m) return { changes: 0 };
        const [, table, setStr, whereCol] = m;
        const setCols = setStr.split(',').map(part => part.trim().match(/^(\w+)/)[1]);
        const whereVal = params[setCols.length];
        const rows = getRows(table);
        rows.forEach(row => {
          if (String(row[whereCol]) === String(whereVal)) {
            setCols.forEach((col, i) => { row[col] = params[i]; });
          }
        });
        return { changes: 1 };
      }

      // DELETE FROM table [WHERE ...]
      if (/^DELETE/i.test(s)) {
        // No WHERE clause → delete all rows in table
        const mAll = s.match(/^DELETE FROM\s+(\w+)\s*$/i);
        if (mAll) { tables[mAll[1]] = []; return { changes: 1 }; }
        const m = s.match(/FROM\s+(\w+)\s+WHERE\s+(.+)/i);
        if (!m) return { changes: 0 };
        const [, table, whereStr] = m;
        const rows = getRows(table);
        const resolved = resolveWhere(whereStr, params);
        const after = rows.filter(row => !evalWhere(resolved, row));
        tables[table] = after;
        return { changes: rows.length - after.length };
      }

      return { lastInsertRowId: 0, changes: 0 };
    },

    getAllSync(sql, ...params) {
      const s = sql.trim().replace(/\s+/g, ' ');
      const up = s.toUpperCase();

      // Aggregate: SELECT MAX(col) AS alias FROM table
      const aggMatch = s.match(/SELECT\s+MAX\((\w+)\)\s+AS\s+(\w+)\s+FROM\s+(\w+)/i);
      if (aggMatch) {
        const [, col, alias, table] = aggMatch;
        const rows = getRows(table);
        const max = rows.reduce((mx, r) => Math.max(mx, r[col] ?? -1), -1);
        return [{ [alias]: rows.length === 0 ? null : max }];
      }

      // Extract table name
      const fromMatch = s.match(/FROM\s+(\w+)/i);
      if (!fromMatch) return [];
      const table = fromMatch[1];

      // Extract WHERE and ORDER BY using string positions (avoids regex ambiguity)
      const wherePos   = up.indexOf(' WHERE ');
      const orderByPos = up.indexOf(' ORDER BY ');

      let whereStr = null;
      let orderStr = null;

      if (wherePos >= 0) {
        const start = wherePos + 7;
        const end   = orderByPos > wherePos ? orderByPos : s.length;
        whereStr = s.slice(start, end).trim();
      }
      if (orderByPos >= 0) {
        orderStr = s.slice(orderByPos + 10).trim();
      }

      let rows = [...getRows(table)];

      if (whereStr) {
        const resolved = resolveWhere(whereStr, params);
        rows = rows.filter(r => evalWhere(resolved, r));
      }

      // DISTINCT
      if (/SELECT DISTINCT\s+(\w+)/i.test(s)) {
        const distCol = s.match(/SELECT DISTINCT\s+(\w+)/i)[1];
        const seen = new Set();
        const result = [];
        for (const row of rows) {
          const v = row[distCol];
          if (!seen.has(v)) { seen.add(v); result.push({ [distCol]: v }); }
        }
        return sortRows(result, orderStr);
      }

      return sortRows(rows, orderStr);
    },

    getFirstSync(sql, ...params) {
      return this.getAllSync(sql, ...params)[0] ?? null;
    },
  };
}

module.exports = {
  openDatabaseSync: () => createDb(),
};
