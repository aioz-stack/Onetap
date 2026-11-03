// Cash riders collect on delivery, and handing it to their courier. A COD parcel a rider
// delivers is cash that rider holds. They hand over everything they hold in one remittance,
// stating what they're handing over, and the partner confirms what arrived or rejects it, which
// puts the cash back on the rider. Onetap's own remittance from the courier stays in cod.js.

import { randomBytes, randomUUID } from 'node:crypto';
import { audit } from './admin';
import { riderTransactions } from './collections';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, equals, isoDate, listQuery, search } from './lists';
import { notifyCourier, notifyRider } from './notifications';
import { transaction } from './shipments';

const DAY = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 7;
// A rider holds cash from collection until a remittance covering it is submitted.
const HELD = "rider_id = ? AND status IN ('collected', 'remitted') AND rider_remittance_id = ''";

const db = () => getDb();
const now = () => Date.now();
const money = (value) => Math.round(value * 100) / 100;
const fullName = (row) => [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ');
const peso = (amount) => `₱${Number(amount).toLocaleString('en-PH')}`;
const riderActor = (rider) => ({ username: rider.username, adminRole: `rider:${rider.partnerId}` });
const partnerActor = (account) => ({ username: account.username, adminRole: `courier:${account.partnerId}` });

// Days run midnight to midnight in the Philippines.
const manilaDay = (ms) => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dayStart = (day) => Date.parse(`${day}T00:00:00+08:00`);

const toParcel = (row) => ({ orderId: row.order_id, customer: row.customer, seller: row.shop_name, expected: row.expected, collected: row.collected, collectedAt: row.collected_at, remittanceId: row.rider_remittance_id });

export function cashHeld(riderId) {
  const rows = db().prepare(`SELECT * FROM cod_records WHERE ${HELD} ORDER BY collected_at`).all(riderId);
  return { amount: money(rows.reduce((sum, row) => sum + row.collected, 0)), parcels: rows.length, rows: rows.map(toParcel) };
}

// Cash held and handovers waiting, per rider, for the partner's rider list.
export function cashByRider(partnerId) {
  const held = db().prepare(`SELECT c.rider_id, COALESCE(SUM(c.collected), 0) AS amount FROM cod_records c JOIN riders r ON r.id = c.rider_id WHERE r.partner_id = ? AND c.status IN ('collected', 'remitted') AND c.rider_remittance_id = '' GROUP BY c.rider_id`).all(partnerId);
  const waiting = db().prepare("SELECT rider_id, declared FROM rider_remittances WHERE partner_id = ? AND status = 'submitted'").all(partnerId);
  const result = {};
  held.forEach((row) => { result[row.rider_id] = { held: money(row.amount), waiting: 0 }; });
  waiting.forEach((row) => { result[row.rider_id] = { held: result[row.rider_id]?.held || 0, waiting: row.declared }; });
  return result;
}

const toRemittance = (row) => ({
  id: row.id, reference: row.reference, riderId: row.rider_id, rider: row.first_name ? fullName(row) : undefined, phone: row.phone, parcels: row.parcels, expected: row.expected, declared: row.declared, received: row.received,
  difference: row.received === null ? null : money(row.received - row.expected), status: row.status, note: row.note, reviewNote: row.review_note, reviewedBy: row.reviewed_by, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at,
});

// The rider's day: their COD collections, the tasks they finished, and the cash they hold.
export function riderCollections(rider, params) {
  const asked = String(params.get('date') || '');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && dayStart(asked) ? asked : manilaDay(now());
  const from = dayStart(day);
  const to = from + DAY;
  const rows = db().prepare('SELECT * FROM cod_records WHERE rider_id = ? AND collected_at >= ? AND collected_at < ? ORDER BY collected_at').all(rider.riderId, from, to);
  const tasks = Object.fromEntries(db().prepare('SELECT kind, status, COUNT(*) AS c FROM rider_assignments WHERE rider_id = ? AND finished_at >= ? AND finished_at < ? GROUP BY kind, status').all(rider.riderId, from, to).map((row) => [`${row.kind}:${row.status}`, row.c]));
  const handover = Object.fromEntries(db().prepare('SELECT id, status FROM rider_remittances WHERE rider_id = ?').all(rider.riderId).map((row) => [row.id, row.status]));
  const recentFrom = dayStart(manilaDay(now())) - (RECENT_DAYS - 1) * DAY;
  const recent = db().prepare('SELECT collected_at, collected FROM cod_records WHERE rider_id = ? AND collected_at >= ?').all(rider.riderId, recentFrom);
  const days = Array.from({ length: RECENT_DAYS }, (_, i) => {
    const date = manilaDay(recentFrom + i * DAY);
    const own = recent.filter((row) => manilaDay(row.collected_at) === date);
    return { date, parcels: own.length, collected: money(own.reduce((sum, row) => sum + row.collected, 0)) };
  }).reverse();
  return {
    date: day,
    today: manilaDay(now()),
    summary: {
      deliveries: tasks['delivery:completed'] || 0,
      failedDeliveries: tasks['delivery:failed'] || 0,
      pickups: tasks['pickup:completed'] || 0,
      codParcels: rows.length,
      expected: money(rows.reduce((sum, row) => sum + row.expected, 0)),
      collected: money(rows.reduce((sum, row) => sum + row.collected, 0)),
    },
    rows: rows.map((row) => ({ ...toParcel(row), handover: row.rider_remittance_id ? handover[row.rider_remittance_id] : 'held' })),
    days,
    held: (({ amount, parcels }) => ({ amount, parcels }))(cashHeld(rider.riderId)),
    transactions: riderTransactions(rider.riderId, from, to),
  };
}

export function riderRemittances(rider) {
  const pending = db().prepare("SELECT 1 FROM rider_remittances WHERE rider_id = ? AND status = 'submitted'").get(rider.riderId);
  return {
    held: cashHeld(rider.riderId),
    pending: Boolean(pending),
    rows: db().prepare('SELECT * FROM rider_remittances WHERE rider_id = ? ORDER BY submitted_at DESC LIMIT 50').all(rider.riderId).map(toRemittance),
  };
}

// Hands over all the cash the rider holds. The amount is what they say they're handing over.
export function submitRiderRemittance(rider, { amount, note }) {
  const declared = Number(amount);
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(declared) || declared < 0) throw new ApiError(422, 'Enter the amount you are handing over.', { amount: 'Enter the amount you are handing over.' });
  return transaction(() => {
    if (db().prepare("SELECT 1 FROM rider_remittances WHERE rider_id = ? AND status = 'submitted'").get(rider.riderId)) {
      throw new ApiError(409, 'Your last handover is still waiting for your courier to confirm it.');
    }
    const held = cashHeld(rider.riderId);
    if (!held.parcels) throw new ApiError(409, "You aren't holding any COD cash.");
    const id = randomUUID();
    const reference = `RR-${randomBytes(4).toString('hex').toUpperCase()}`;
    const time = now();
    db().prepare("INSERT INTO rider_remittances (id, reference, partner_id, rider_id, parcels, expected, declared, status, note, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)")
      .run(id, reference, rider.partnerId, rider.riderId, held.parcels, held.amount, money(declared), String(note ?? '').trim().slice(0, 200), time);
    db().prepare(`UPDATE cod_records SET rider_remittance_id = ? WHERE ${HELD}`).run(id, rider.riderId);
    const gap = money(declared - held.amount);
    notifyCourier(rider.partnerId, 'Rider cash handed over', `${rider.name} handed over ${peso(declared)} for ${held.parcels} COD parcel${held.parcels === 1 ? '' : 's'} (${reference})${gap ? `, ${gap < 0 ? 'short' : 'over'} by ${peso(Math.abs(gap))}` : ''}. Confirm what you received.`, '/courier/finance/remittances/riders');
    audit(riderActor(rider), 'rider_remittance.submitted', 'rider_remittance', reference, { expected: held.amount, declared: money(declared), parcels: held.parcels });
    return { reference, expected: held.amount, declared: money(declared) };
  });
}

const REMITTANCE_LIST = {
  select: 'rr.*, r.first_name, r.middle_name, r.last_name, r.phone',
  from: 'rider_remittances rr JOIN riders r ON r.id = rr.rider_id',
  sorts: { submitted: 'rr.submitted_at', reviewed: 'rr.reviewed_at', amount: 'rr.declared', status: 'rr.status' },
  defaultSort: 'submitted',
};

export function listPartnerRemittances(params, partnerId) {
  const where = [
    ['rr.partner_id = ?', partnerId],
    ...search(params, ['rr.reference', 'r.first_name', 'r.last_name', 'r.username', 'r.phone']),
    ...equals(params, 'status', 'rr.status'),
    ...equals(params, 'rider', 'rr.rider_id'),
  ];
  const { rows, ...page } = listQuery(db(), { ...REMITTANCE_LIST, where }, params);
  const remittances = rows.map(toRemittance);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-rider-remittances.csv', [
      ['Reference', (r) => r.reference], ['Rider', (r) => r.rider], ['Parcels', (r) => r.parcels], ['Collected', (r) => r.expected], ['Handed over', (r) => r.declared], ['Received', (r) => r.received ?? ''],
      ['Difference', (r) => r.difference ?? ''], ['Status', (r) => r.status], ['Rider note', (r) => r.note], ['Review note', (r) => r.reviewNote], ['Submitted', (r) => isoDate(r.submittedAt)], ['Reviewed', (r) => isoDate(r.reviewedAt)], ['Reviewed by', (r) => r.reviewedBy],
    ], remittances);
  }
  const sum = (sql) => db().prepare(sql).get(partnerId).v;
  return Response.json({
    ...page,
    rows: remittances,
    summary: {
      held: money(sum("SELECT COALESCE(SUM(c.collected), 0) AS v FROM cod_records c JOIN riders r ON r.id = c.rider_id WHERE r.partner_id = ? AND c.status IN ('collected', 'remitted') AND c.rider_remittance_id = ''")),
      waiting: money(sum("SELECT COALESCE(SUM(declared), 0) AS v FROM rider_remittances WHERE partner_id = ? AND status = 'submitted'")),
      waitingCount: sum("SELECT COUNT(*) AS v FROM rider_remittances WHERE partner_id = ? AND status = 'submitted'"),
      received: money(sum("SELECT COALESCE(SUM(received), 0) AS v FROM rider_remittances WHERE partner_id = ? AND status = 'confirmed'")),
      shortages: sum("SELECT COUNT(*) AS v FROM rider_remittances WHERE partner_id = ? AND status = 'confirmed' AND received < expected"),
    },
    riders: db().prepare('SELECT id, first_name, middle_name, last_name FROM riders WHERE partner_id = ? ORDER BY first_name').all(partnerId).map((row) => ({ id: row.id, name: fullName(row) })),
  });
}

function loadRemittance(partnerId, id) {
  const row = db().prepare(`SELECT ${REMITTANCE_LIST.select} FROM ${REMITTANCE_LIST.from} WHERE rr.id = ? AND rr.partner_id = ?`).get(String(id), partnerId);
  if (!row) throw new ApiError(404, 'We could not find that remittance.');
  return row;
}

export function partnerRemittance(partnerId, id) {
  const row = loadRemittance(partnerId, id);
  return { ...toRemittance(row), orders: db().prepare('SELECT * FROM cod_records WHERE rider_remittance_id = ? ORDER BY collected_at').all(row.id).map(toParcel) };
}

// The partner counts the cash and confirms it, recording any shortage, or rejects the handover.
export function reviewRemittance(account, id, { action, received, note }) {
  const text = String(note ?? '').trim().slice(0, 200);
  return transaction(() => {
    const row = loadRemittance(account.partnerId, id);
    if (row.status !== 'submitted') throw new ApiError(409, 'This remittance has already been reviewed. Refresh to see it.');
    const time = now();
    if (action === 'confirm') {
      const amount = Number(received);
      if (received === '' || received === null || received === undefined || !Number.isFinite(amount) || amount < 0) throw new ApiError(422, 'Enter the amount you received.', { received: 'Enter the amount you received.' });
      const gap = money(amount - row.expected);
      if (gap < 0 && text.length < 3) throw new ApiError(422, 'Note what happened to the shortage.', { note: 'Note what happened to the shortage.' });
      db().prepare("UPDATE rider_remittances SET status = 'confirmed', received = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(money(amount), text, account.name, time, row.id);
      notifyRider(row.rider_id, 'Cash handover confirmed', `${account.name} confirmed ${peso(amount)} for ${row.reference}${gap ? `, ${gap < 0 ? 'short' : 'over'} by ${peso(Math.abs(gap))}` : ''}.`, '/rider/remittances');
      audit(partnerActor(account), 'rider_remittance.confirmed', 'rider_remittance', row.reference, { rider: row.rider_id, expected: row.expected, declared: row.declared, received: money(amount) });
      return { status: 'confirmed', difference: gap };
    }
    if (action === 'reject') {
      if (text.length < 3) throw new ApiError(422, 'Enter the reason.', { note: 'Enter the reason.' });
      db().prepare("UPDATE rider_remittances SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(text, account.name, time, row.id);
      // The cash goes back on the rider, who hands it over again.
      db().prepare("UPDATE cod_records SET rider_remittance_id = '' WHERE rider_remittance_id = ?").run(row.id);
      notifyRider(row.rider_id, 'Cash handover rejected', `${row.reference}: ${text}. You still hold this cash, so hand it over again.`, '/rider/remittances');
      audit(partnerActor(account), 'rider_remittance.rejected', 'rider_remittance', row.reference, { rider: row.rider_id, reason: text });
      return { status: 'rejected' };
    }
    throw new ApiError(400, 'Unknown action.');
  });
}
