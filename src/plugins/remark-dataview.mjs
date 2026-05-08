import { visit } from 'unist-util-visit';

// ── tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }

    // string literal
    if (input[i] === '"') {
      let j = i + 1;
      while (j < input.length && input[j] !== '"') { if (input[j] === '\\') j++; j++; }
      tokens.push({ type: 'string', value: input.slice(i + 1, j) });
      i = j + 1; continue;
    }

    // number
    if (/\d/.test(input[i])) {
      let j = i;
      while (j < input.length && /[\d.]/.test(input[j])) j++;
      tokens.push({ type: 'number', value: parseFloat(input.slice(i, j)) });
      i = j; continue;
    }

    // two-char operators
    const two = input.slice(i, i + 2);
    if (['!=', '<=', '>='].includes(two)) { tokens.push({ type: 'op', value: two }); i += 2; continue; }

    // single-char operators / punctuation
    if ('=<>!(),'.includes(input[i])) {
      const t = input[i] === '!' ? 'op' : input[i] === '(' ? 'lparen' : input[i] === ')' ? 'rparen' : input[i] === ',' ? 'comma' : 'op';
      tokens.push({ type: t, value: input[i] }); i++; continue;
    }

    // identifier / keyword (allow dots and hyphens for file.name, #tag)
    if (/[a-zA-Z_#"]/.test(input[i])) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_.#\-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const up = word.toUpperCase();
      if (['AND', 'OR', 'NOT'].includes(up)) tokens.push({ type: 'op', value: up });
      else if (up === 'TRUE')  tokens.push({ type: 'bool', value: true });
      else if (up === 'FALSE') tokens.push({ type: 'bool', value: false });
      else if (up === 'NULL')  tokens.push({ type: 'null' });
      else tokens.push({ type: 'ident', value: word });
      i = j; continue;
    }

    i++;
  }
  return tokens;
}

// ── expression parser ─────────────────────────────────────────────────────────

class Expr {
  constructor(tokens, row) { this.t = tokens; this.i = 0; this.row = row; }

  peek()    { return this.t[this.i]; }
  consume() { return this.t[this.i++]; }

  // OR > AND > NOT > compare > value
  parse()   { return this.or(); }

  or() {
    let v = this.and();
    while (this.peek()?.value === 'OR') { this.consume(); v = this.and() || v; }
    return v;
  }

  and() {
    let v = this.not();
    while (this.peek()?.value === 'AND') { this.consume(); v = this.not() && v; }
    return v;
  }

  not() {
    if (this.peek()?.value === 'NOT' || this.peek()?.value === '!') { this.consume(); return !this.not(); }
    return this.compare();
  }

  compare() {
    const left = this.value();
    const op = this.peek();
    if (op?.type === 'op' && ['=', '!=', '<', '>', '<=', '>='].includes(op.value)) {
      this.consume();
      const right = this.value();
      if (op.value === '=')  return left == right;  // loose: handles null/string coercion
      if (op.value === '!=') return left != right;
      if (op.value === '<')  return left < right;
      if (op.value === '>')  return left > right;
      if (op.value === '<=') return left <= right;
      if (op.value === '>=') return left >= right;
    }
    return Boolean(left);
  }

  value() {
    const tok = this.peek();
    if (!tok) return null;

    if (tok.type === 'string') { this.consume(); return tok.value; }
    if (tok.type === 'number') { this.consume(); return tok.value; }
    if (tok.type === 'bool')   { this.consume(); return tok.value; }
    if (tok.type === 'null')   { this.consume(); return null; }

    if (tok.type === 'lparen') {
      this.consume();
      const v = this.or();
      if (this.peek()?.type === 'rparen') this.consume();
      return v;
    }

    if (tok.type === 'ident') {
      this.consume();
      if (this.peek()?.type === 'lparen') {
        // function call
        this.consume();
        const args = [];
        while (this.peek() && this.peek().type !== 'rparen') {
          args.push(this.value());
          if (this.peek()?.type === 'comma') this.consume();
        }
        if (this.peek()?.type === 'rparen') this.consume();
        return this.fn(tok.value, args);
      }
      return this.field(tok.value);
    }

    return null;
  }

  field(name) {
    if (name === 'file.name')  return this.row.title;
    if (name === 'file.tags')  return this.row.tags;
    if (name === 'file.mtime') return this.row.mtime ?? null;
    if (name.startsWith('file.')) return null;
    const val = this.row.data[name];
    return val ?? null;
  }

  fn(name, args) {
    switch (name.toLowerCase()) {
      case 'lower':    return typeof args[0] === 'string' ? args[0].toLowerCase() : args[0];
      case 'upper':    return typeof args[0] === 'string' ? args[0].toUpperCase() : args[0];
      case 'string':   return args[0] == null ? '' : String(args[0]);
      case 'number':   return Number(args[0]);
      case 'contains': {
        const [hay, needle] = args;
        if (Array.isArray(hay)) return hay.some(h => String(h).includes(String(needle ?? '')));
        if (typeof hay === 'string') return hay.includes(String(needle ?? ''));
        return false;
      }
      case 'choice':   return args[0] ? args[1] : args[2];
      case 'date': {
        if (args[0] === 'today') return new Date().toISOString().slice(0, 10);
        return args[0] ?? null;
      }
      default: return null;
    }
  }
}

function evalExpr(exprStr, row) {
  try {
    return new Expr(tokenize(exprStr), row).parse();
  } catch {
    return false;
  }
}

// ── query parser ──────────────────────────────────────────────────────────────

function parseQuery(raw) {
  // Split into lines, strip comments (#...)
  const lines = raw.split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);

  const firstLine = lines[0] ?? '';
  const typeMatch = firstLine.match(/^(LIST|TABLE|TASK)\b/i);
  const queryType = typeMatch ? typeMatch[1].toUpperCase() : null;

  // The part after LIST/TABLE on the first line is the field expression
  const fieldExpr = firstLine.slice(queryType?.length ?? 0).trim() || null;

  // Parse columns for TABLE: "expr AS alias, ..."
  const columns = [];
  if (queryType === 'TABLE' && fieldExpr) {
    for (const col of fieldExpr.split(',')) {
      const m = col.trim().match(/^(.+?)\s+as\s+"?([^"]+)"?\s*$/i);
      if (m) columns.push({ expr: m[1].trim(), label: m[2].trim() });
      else    columns.push({ expr: col.trim(), label: col.trim() });
    }
  }

  let from = null, where = null, sort = null, sortDir = 'ASC', limit = null;

  for (const line of lines.slice(1)) {
    if (/^FROM\s+/i.test(line))  from  = line.replace(/^FROM\s+/i, '').trim();
    if (/^WHERE\s+/i.test(line)) where = line.replace(/^WHERE\s+/i, '').trim();
    if (/^SORT\s+/i.test(line)) {
      const m = line.replace(/^SORT\s+/i, '').trim().match(/^(.+?)\s+(ASC|DESC)$/i);
      if (m) { sort = m[1].trim(); sortDir = m[2].toUpperCase(); }
      else    { sort = line.replace(/^SORT\s+/i, '').trim(); }
    }
    if (/^LIMIT\s+/i.test(line)) limit = parseInt(line.replace(/^LIMIT\s+/i, '').trim(), 10);
  }

  return { queryType, fieldExpr, columns, from, where, sort, sortDir, limit };
}

// ── executor ──────────────────────────────────────────────────────────────────

function executeQuery(raw, vaultData) {
  const { queryType, fieldExpr, columns, from, where, sort, sortDir, limit } = parseQuery(raw);

  if (!queryType || queryType === 'TASK') return null;

  let rows = [...vaultData];

  // FROM filter
  if (from) {
    if (from.startsWith('#')) {
      const tag = from.slice(1).toLowerCase();
      rows = rows.filter(r => r.tags.some(t => t.replace(/^#/, '').toLowerCase() === tag));
    } else if (from.startsWith('"')) {
      const folder = from.replace(/"/g, '').toLowerCase();
      rows = rows.filter(r => r.folder?.toLowerCase() === folder);
    }
  }

  // WHERE filter
  if (where) {
    rows = rows.filter(r => evalExpr(where, r));
  }

  // SORT
  if (sort) {
    rows.sort((a, b) => {
      const av = evalExpr(sort, a) ?? '';
      const bv = evalExpr(sort, b) ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'DESC' ? -cmp : cmp;
    });
  }

  // LIMIT
  if (limit != null && !isNaN(limit)) rows = rows.slice(0, limit);

  return { queryType, rows, fieldExpr, columns };
}

// ── renderers ─────────────────────────────────────────────────────────────────

function renderRow(row, exprStr) {
  const url   = row.url;
  const label = exprStr ? String(evalExpr(exprStr, row) ?? row.title) : row.title;
  return url ? `<a href="${url}">${label}</a>` : label;
}

function renderList(rows, fieldExpr) {
  if (rows.length === 0) return '<ul class="dv-list"><li class="dv-empty">No results.</li></ul>';
  const items = rows.map(r => `<li>${renderRow(r, fieldExpr)}</li>`).join('');
  return `<ul class="dv-list">${items}</ul>`;
}

function renderTable(rows, columns) {
  if (rows.length === 0) return '<p class="dv-empty">No results.</p>';
  const head = columns.map(c => `<th>${c.label}</th>`).join('');
  const body = rows.map(r => {
    const cells = columns.map(c => `<td>${evalExpr(c.expr, r) ?? ''}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="dv-table"><thead><tr><th>${rows[0] ? `<a href="${rows[0].url ?? '#'}">${rows[0].title}</a>` : 'File'}</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── remark plugin ─────────────────────────────────────────────────────────────

// vaultData: Array<{ title, data, tags, url, folder }>
export function remarkDataview({ vaultData = [] } = {}) {
  return (tree) => {
    const targets = [];

    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'dataview' && node.lang !== 'dataviewjs') return;
      targets.push({ node, index, parent });
    });

    for (const { node, index, parent } of targets.reverse()) {
      if (node.lang === 'dataviewjs') {
        // strip — can't execute arbitrary JS at build time
        parent.children.splice(index, 1);
        continue;
      }

      let html;
      try {
        const result = executeQuery(node.value, vaultData);
        if (!result) {
          parent.children.splice(index, 1);
          continue;
        }
        const { queryType, rows, fieldExpr, columns } = result;
        html = queryType === 'TABLE'
          ? renderTable(rows, columns)
          : renderList(rows, fieldExpr);
      } catch (e) {
        html = `<p class="dv-error">Query error: ${String(e.message)}</p>`;
      }

      parent.children.splice(index, 1, { type: 'html', value: html });
    }
  };
}
