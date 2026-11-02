// Cash on Delivery money trail: expected at checkout, collected on the courier's delivery
// confirmation, remitted when an admin records the courier's transfer.

import { randomUUID } from 'node:crypto';
import { audit } from './admin';
import { loadPartner } from './couriers';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';

const DAY = 24 * 60 * 60 * 1000;

export const createCodRecord = (order) => getDb().prepare(`
  INSERT INTO cod_records (order_id, seller, shop_name, customer, expected, status, created_at) VALUES (?, ?, ?, ?, ?, 'awaiting_delivery', ?)
`).run(order.id, order.seller, order.shopName, order.customer, order.total, Date.now());

export function assignCodPartner(orderId, partner) {
  getDb().prepare('UPDATE cod_records SET partner_id = ?, partner_name = ? WHERE order_id = ?').run(partner.id, partner.name, orderId);
}

// amount comes from the courier's report, which may differ from what was due.
export function markCodCollected(orderId, partner, amount, at) {
  const due = at + (partner.remittanceDays || 0) * DAY;
  getDb().prepare("UPDATE cod_records SET status = 'collected', collected = ?, collected_at = ?, due_at = ? WHERE order_id = ? AND status = 'awaiting_delivery'")
    .run(amount, at, due, orderId);
}

export function voidCodRecord(orderId) {
  getDb().prepare("UPDATE cod_records SET status = 'void' WHERE order_id = ? AND status = 'awaiting_delivery'").run(orderId);
}

export function codSummary() {
  const db = getDb();
  const sum = (where, column = 'collected') => db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS v FROM cod_records WHERE ${where}`).get().v;
  const received = db.prepare('SELECT COALESCE(SUM(received), 0) AS v FROM cod_remittances').get().v;
  const totalCollected = sum("status IN ('collected', 'remitted')");
  const pending = sum("status = 'collected'");
  return {
    totalCollected,
    pendingRemittance: pending,
    completedRemittance: received,
    outstanding: totalCollected - received,
    awaitingDelivery: sum("status = 'awaiting_delivery'", 'expected'),
    overdue: db.prepare("SELECT COUNT(*) AS c FROM cod_records WHERE status = 'collected' AND due_at < ?").get(Date.now()).c,
    discrepancies: db.prepare('SELECT COUNT(*) AS c FROM cod_records WHERE collected <> expected AND status IN (\'collected\', \'remitted\')').get().c
      + db.prepare('SELECT COUNT(*) AS c FROM cod_remittances WHERE received <> expected').get().c,
  };
}

// Who holds a parcel's cash: the rider who collected it, and whether they've handed it to their courier.
export const COD_SELECT = "cod_records.*, (SELECT first_name || ' ' || last_name FROM riders WHERE id = cod_records.rider_id) AS rider_name, (SELECT status FROM rider_remittances WHERE id = cod_records.rider_remittance_id) AS rider_handover";

const COD_LIST = {
  select: COD_SELECT,
  from: 'cod_records',
  sorts: { created: 'created_at', collected: 'collected_at', due: 'due_at', amount: 'expected', seller: 'shop_name' },
  defaultSort: 'created',
};

export const toRecord = (row) => ({
  orderId: row.order_id, seller: row.shop_name, customer: row.customer, courier: row.partner_name, partnerId: row.partner_id, expected: row.expected, collected: row.collected,
  status: row.status, remittanceId: row.remittance_id, collectedAt: row.collected_at, remittedAt: row.remitted_at, dueAt: row.due_at, createdAt: row.created_at,
  discrepancy: ['collected', 'remitted'].includes(row.status) ? row.collected - row.expected : 0,
  rider: row.rider_name || '', riderHandover: row.rider_id ? row.rider_handover || 'held' : '',
});

export function listCod(params) {
  const where = [...search(params, ['order_id', 'shop_name', 'customer', 'partner_name']), ...equals(params, 'status', 'status'), ...equals(params, 'partner', 'partner_id'), ...dateRange(params, 'created_at')];
  const { rows, ...page } = listQuery(getDb(), { ...COD_LIST, where }, params);
  const records = rows.map(toRecord);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-cod.csv', [
      ['Order', (r) => r.orderId], ['Seller', (r) => r.seller], ['Customer', (r) => r.customer], ['Courier', (r) => r.courier], ['Rider', (r) => r.rider], ['Rider handover', (r) => r.riderHandover], ['Expected', (r) => r.expected], ['Collected', (r) => r.collected],
      ['Discrepancy', (r) => r.discrepancy], ['Status', (r) => r.status], ['Collected at', (r) => isoDate(r.collectedAt)], ['Remittance due', (r) => isoDate(r.dueAt)], ['Remitted at', (r) => isoDate(r.remittedAt)], ['Remittance', (r) => r.remittanceId],
    ], records);
  }
  return Response.json({ ...page, rows: records, summary: codSummary() });
}

export function listRemittances(params) {
  const where = [...search(params, ['reference', 'partner_name']), ...equals(params, 'partner', 'partner_id')];
  const { rows, ...page } = listQuery(getDb(), { from: 'cod_remittances', where, sorts: { at: 'at', received: 'received' }, defaultSort: 'at' }, params);
  return { ...page, rows: rows.map((r) => ({ id: r.id, courier: r.partner_name, reference: r.reference, expected: r.expected, received: r.received, difference: r.received - r.expected, note: r.note, admin: r.admin, at: r.at })) };
}

// Reconciles one courier transfer against the collected orders it covers.
export function recordRemittance(admin, { partnerId, orderIds, reference, received, note }) {
  const partner = loadPartner(partnerId);
  const amount = Number(received);
  const ref = String(reference || '').trim();
  if (!ref) throw new ApiError(422, 'Enter the transaction reference.', { reference: 'Enter the transaction reference.' });
  if (!Number.isFinite(amount) || amount < 0) throw new ApiError(422, 'Enter the amount received.', { received: 'Enter the amount received.' });
  if (!Array.isArray(orderIds) || !orderIds.length) throw new ApiError(422, 'Choose at least one collection.');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM cod_remittances WHERE reference = ?').get(ref)) throw new ApiError(409, 'That reference has already been recorded.', { reference: 'That reference has already been recorded.' });

  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = orderIds.map((id) => db.prepare("SELECT * FROM cod_records WHERE order_id = ? AND partner_id = ? AND status = 'collected'").get(String(id), partner.id));
    if (rows.some((row) => !row)) throw new ApiError(409, 'A selected collection has changed. Refresh and try again.');
    const expected = rows.reduce((sum, row) => sum + row.collected, 0);
    const id = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO cod_remittances (id, partner_id, partner_name, reference, expected, received, note, admin, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, partner.id, partner.name, ref, expected, amount, String(note || '').slice(0, 300), admin.username, now);
    rows.forEach((row) => db.prepare("UPDATE cod_records SET status = 'remitted', remitted_at = ?, remittance_id = ? WHERE order_id = ?").run(now, id, row.order_id));
    audit(admin, 'cod.remittance_recorded', 'remittance', ref, { partner: partner.name, expected, received: amount, orders: rows.length });
    db.exec('COMMIT');
    return { id, expected, received: amount, difference: amount - expected };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const BUCKETS = {
  daily: "strftime('%Y-%m-%d', collected_at / 1000, 'unixepoch', '+8 hours')",
  weekly: "strftime('%Y-W%W', collected_at / 1000, 'unixepoch', '+8 hours')",
  monthly: "strftime('%Y-%m', collected_at / 1000, 'unixepoch', '+8 hours')",
};

export function codReport(period, format) {
  const bucket = BUCKETS[period];
  if (!bucket) throw new ApiError(422, 'Choose daily, weekly or monthly.');
  const rows = getDb().prepare(`
    SELECT ${bucket} AS period, partner_name AS courier, COUNT(*) AS orders, SUM(expected) AS expected, SUM(collected) AS collected,
      SUM(CASE WHEN status = 'remitted' THEN collected ELSE 0 END) AS remitted, SUM(CASE WHEN status = 'collected' THEN collected ELSE 0 END) AS pending
    FROM cod_records WHERE collected_at IS NOT NULL GROUP BY period, courier ORDER BY period DESC, courier LIMIT 400
  `).all();
  if (format === 'csv') {
    return csvResponse(`onetap-cod-${period}.csv`, [['Period', (r) => r.period], ['Courier', (r) => r.courier], ['Orders', (r) => r.orders], ['Expected', (r) => r.expected], ['Collected', (r) => r.collected], ['Remitted', (r) => r.remitted], ['Pending', (r) => r.pending]], rows);
  }
  return Response.json({ rows });
}
