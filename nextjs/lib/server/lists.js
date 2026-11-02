// Server-side search, filter, sort, paging and CSV export for admin tables.

const PAGE_SIZE = 20;
const MAX_EXPORT = 10000;

// from is a trusted SQL fragment. where entries are [sql, ...params]. sort columns are an allowlist.
export function listQuery(db, { select = '*', from, where = [], sorts, defaultSort }, params) {
  const clause = where.length ? `WHERE ${where.map(([sql]) => sql).join(' AND ')}` : '';
  const values = where.flatMap(([, ...args]) => args);
  const column = sorts[params.get('sort')] || sorts[defaultSort];
  const direction = params.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ${from} ${clause}`).get(...values).c;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const size = params.get('format') === 'csv' ? MAX_EXPORT : PAGE_SIZE;
  const rows = db.prepare(`SELECT ${select} FROM ${from} ${clause} ORDER BY ${column} ${direction} LIMIT ? OFFSET ?`)
    .all(...values, size, params.get('format') === 'csv' ? 0 : (page - 1) * PAGE_SIZE);
  return { rows, total, page, pageSize: PAGE_SIZE };
}

export const search = (params, columns) => {
  const text = params.get('q')?.trim();
  if (!text) return [];
  const like = `%${text.replace(/[%_\\]/g, '\\$&')}%`;
  return [[`(${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`, ...columns.map(() => like)]];
};

export const equals = (params, name, column) => {
  const value = params.get(name);
  return value ? [[`${column} = ?`, value]] : [];
};

export const dateRange = (params, column) => {
  const clauses = [];
  const from = Date.parse(params.get('from') || '');
  const to = Date.parse(params.get('to') || '');
  if (from) clauses.push([`${column} >= ?`, from]);
  if (to) clauses.push([`${column} < ?`, to + 24 * 60 * 60 * 1000]);
  return clauses;
};

// A leading = + - or @ would run as a formula when the file opens in a spreadsheet.
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvResponse(filename, columns, rows) {
  const lines = [columns.map(([label]) => cell(label)).join(',')];
  rows.forEach((row) => lines.push(columns.map(([, read]) => cell(read(row))).join(',')));
  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  });
}

export const isoDate = (ms) => (ms ? new Date(ms).toISOString() : '');
