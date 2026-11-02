// Admin Console overview. Sections a role can't open are left out of the response.

import { can } from '../adminRoles';
import { applicationCounts } from './applications';
import { customerApprovalCounts } from './customerApprovals';
import { codSummary } from './cod';
import { getDb } from './db';
import { csvResponse, equals, isoDate, listQuery, search } from './lists';
import { listPartners } from './logistics';
import { flaggedListings, moderationCounts } from './moderation';

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 14;
const dayKey = (ms) => new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function daily(rows) {
  const counts = Object.fromEntries(rows.map((row) => [row.day, row.value]));
  return Array.from({ length: DAYS }, (_, i) => {
    const day = dayKey(Date.now() - (DAYS - 1 - i) * DAY);
    return { day, value: counts[day] || 0 };
  });
}

export const dayColumn = (column) => `strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch', '+8 hours')`;

function logistics() {
  const db = getDb();
  const since = Date.now() - DAYS * DAY;
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS c FROM shipments GROUP BY status').all().map((row) => [row.status, row.c]));
  const active = ['booking_confirmed', 'ready_for_pickup', 'picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'failed_delivery'].reduce((sum, status) => sum + (counts[status] || 0), 0);
  const pickups = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS c FROM pickups GROUP BY status').all().map((row) => [row.status, row.c]));
  const partners = listPartners();
  return {
    partners: partners.length,
    activeIntegrations: partners.filter((p) => p.status === 'active' && p.integration?.status === 'connected').length,
    pendingPickups: (pickups.pending || 0) + (pickups.approved || 0) + (pickups.scheduled || 0) + (pickups.confirmed || 0),
    activeShipments: active,
    delivered: counts.delivered || 0,
    failedDeliveries: (counts.failed_delivery || 0) + (counts.return_to_sender || 0),
    shipmentStatus: counts,
    pickupStatus: pickups,
    courierPerformance: partners.map((p) => ({ name: p.name, environment: p.environment, ...p.stats })),
    bookedPerDay: daily(db.prepare(`SELECT ${dayColumn('created_at')} AS day, COUNT(*) AS value FROM shipments WHERE created_at >= ? GROUP BY day`).all(since)),
    deliveredPerDay: daily(db.prepare(`SELECT ${dayColumn('at')} AS day, COUNT(*) AS value FROM shipment_events WHERE status = 'delivered' AND source = 'webhook' AND note NOT LIKE 'Ignored%' AND at >= ? GROUP BY day`).all(since)),
  };
}

function finance() {
  const db = getDb();
  const since = Date.now() - DAYS * DAY;
  return {
    ...codSummary(),
    collectedPerDay: daily(db.prepare(`SELECT ${dayColumn('collected_at')} AS day, SUM(collected) AS value FROM cod_records WHERE collected_at >= ? GROUP BY day`).all(since)),
    remittedPerDay: daily(db.prepare(`SELECT ${dayColumn('at')} AS day, SUM(received) AS value FROM cod_remittances WHERE at >= ? GROUP BY day`).all(since)),
  };
}

function alerts(admin) {
  const db = getDb();
  const list = [];
  const add = (level, text, count, href) => {
    if (count) list.push({ level, text: `${count} ${text}`, href });
  };
  if (can(admin, 'pickups')) {
    add('warning', 'pickup requests waiting for approval', db.prepare("SELECT COUNT(*) AS c FROM pickups WHERE status = 'pending'").get().c, '/admin/pickups?status=pending');
    add('critical', 'approved pickups the courier has not confirmed', db.prepare("SELECT COUNT(*) AS c FROM pickups WHERE status = 'approved' AND booking_error <> ''").get().c, '/admin/pickups?status=approved');
    add('critical', 'failed pickups', db.prepare("SELECT COUNT(*) AS c FROM pickups WHERE status = 'failed'").get().c, '/admin/pickups?status=failed');
  }
  if (can(admin, 'shipments')) {
    add('warning', 'delayed shipments', db.prepare("SELECT COUNT(*) AS c FROM shipments WHERE eta < ? AND status IN ('booking_confirmed', 'ready_for_pickup', 'picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'failed_delivery')").get(Date.now()).c, '/admin/shipments?delayed=1');
    add('critical', 'failed deliveries', db.prepare("SELECT COUNT(*) AS c FROM shipments WHERE status = 'failed_delivery'").get().c, '/admin/shipments?status=failed_delivery');
    add('warning', 'bookings waiting on a courier', db.prepare("SELECT COUNT(*) AS c FROM shipments WHERE status = 'pending' AND last_error <> ''").get().c, '/admin/shipments?status=pending');
  }
  if (can(admin, 'api')) add('critical', 'API errors in the last 24 hours', db.prepare("SELECT COUNT(*) AS c FROM api_logs WHERE outcome = 'failed' AND at >= ?").get(Date.now() - DAY).c, '/admin/api');
  if (can(admin, 'products')) add('warning', 'products flagged for a restricted term', flaggedListings(), '/admin/products?tab=live');
  if (can(admin, 'sellers')) add('warning', 'seller applications waiting for review', applicationCounts().pending, '/admin/sellers?tab=pending');
  if (can(admin, 'customers')) add('warning', 'customer registrations waiting for approval', customerApprovalCounts().pending, '/admin/customers?tab=pending');
  if (can(admin, 'cod')) {
    const { overdue, discrepancies } = codSummary();
    add('warning', 'COD remittances overdue', overdue, '/admin/cod?status=collected');
    add('critical', 'COD discrepancies', discrepancies, '/admin/cod');
  }
  return list;
}

export function adminOverview(admin) {
  const canLogistics = can(admin, 'shipments') || can(admin, 'logistics');
  return {
    logistics: canLogistics ? logistics() : null,
    finance: can(admin, 'cod') ? finance() : null,
    moderation: can(admin, 'products') ? moderationCounts() : null,
    alerts: alerts(admin),
    activity: can(admin, 'audit') ? getDb().prepare('SELECT admin, action, target_id, at FROM admin_audit ORDER BY id DESC LIMIT 8').all() : [],
  };
}

export function listAudit(params) {
  const where = [...search(params, ['admin', 'action', 'target_id']), ...equals(params, 'admin', 'admin')];
  const { rows, ...page } = listQuery(getDb(), { from: 'admin_audit', where, sorts: { at: 'id', admin: 'admin', action: 'action' }, defaultSort: 'at' }, params);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-audit.csv', [['When', (r) => isoDate(r.at)], ['Administrator', (r) => r.admin], ['Role', (r) => r.role], ['Action', (r) => r.action], ['Target', (r) => `${r.target_type}:${r.target_id}`], ['Detail', (r) => r.detail]], rows);
  }
  return Response.json({ ...page, rows });
}

export function listApiLogs(params) {
  const where = [...search(params, ['reference', 'operation', 'error']), ...equals(params, 'partner', 'partner_id'), ...equals(params, 'outcome', 'outcome')];
  const { rows, ...page } = listQuery(getDb(), { from: 'api_logs', where, sorts: { at: 'id', duration: 'duration_ms' }, defaultSort: 'at' }, params);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-api-logs.csv', [['When', (r) => isoDate(r.at)], ['Partner', (r) => r.partner_id], ['Environment', (r) => r.environment], ['Operation', (r) => r.operation], ['Reference', (r) => r.reference], ['Attempt', (r) => r.attempt], ['Outcome', (r) => r.outcome], ['Duration ms', (r) => r.duration_ms], ['Error', (r) => r.error]], rows);
  }
  return Response.json({ ...page, rows, webhooks: getDb().prepare('SELECT partner_id, outcome, tracking, status, error, at FROM webhook_events ORDER BY at DESC LIMIT 20').all() });
}
