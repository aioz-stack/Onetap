// The Logistics Partner Panel. Every query here is limited to the signed-in user's own partner,
// and a courier only sees a pickup once it is approved and booked. In Sandbox, a status update is
// signed and sent through the same webhook check a real courier's would. A live partner reports
// through its API, so the panel can't mark its parcels picked up or delivered.

import { redirect } from 'next/navigation';
import { audit, checkOrigin } from './admin';
import { checkPassword, currentAccount, hashPassword, loginAccount } from './auth';
import { COD_SELECT, toRecord } from './cod';
import { checkProofPhotos } from './proofs';
import { loadPartner } from './couriers';
import { panelAccess } from './courierUsers';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';
import { daily, dayColumn } from './overview';
import { route } from './route';
import { checkedAddress, isCurrentAddress } from './streets';
import { formatAddress } from '../address';
import { sendSandboxEvent, shipmentDetail } from './shipments';

const DAY = 24 * 60 * 60 * 1000;
const TREND_DAYS = 14;
const REPORT_PERIODS = [7, 30, 90];
const NEEDS_REASON = ['pickup_failed', 'pickup_rejected', 'failed_delivery', 'return_to_sender'];
// Facility movements name the facility, so the tracking history shows where the parcel is.
const NEEDS_LOCATION = { at_sorting_facility: 'Enter the sorting facility.', sorting_completed: 'Enter the sorting facility.', departed_sorting_facility: 'Enter the sorting facility.', arrived_delivery_hub: 'Enter the delivery hub.' };

const db = () => getDb();
const actorFor = (account) => ({ username: account.username, adminRole: `courier:${account.partnerId}` });

// The signed-in user, or null once their partner's panel is closed.
export async function currentCourier() {
  const account = await currentAccount('courier');
  return account && panelAccess(account.partnerId).open ? account : null;
}

export async function pageCourier() {
  const account = await currentCourier();
  if (!account) redirect('/courier/login');
  return { ...account, partnerName: loadPartner(account.partnerId).name };
}

export function courierRoute(handler) {
  return route(async (request, context) => {
    if (request.method !== 'GET') checkOrigin(request);
    const account = await currentCourier();
    if (!account) throw new ApiError(401, 'Log in to the Logistics Partner Panel first.');
    return handler(request, account, context);
  });
}

export const courierLogin = (request, identifier, password) => loginAccount('courier', request, identifier, password, ({ partnerId }) => {
  if (!panelAccess(partnerId).open) throw new ApiError(403, `${loadPartner(partnerId).name} isn't active on Onetap, so this panel is closed. Contact Onetap for help.`);
});

// The partner's details as Onetap holds them. The only copy is in the database, so an edit shows here straight away.
export function courierPartner(partnerId) {
  const { name, environment, status, contact, services, zones, pickupLocations, deliveryLocations, base, perHalfKg, remittanceDays, hubAddress } = loadPartner(partnerId);
  return {
    name, environment, status, contact, services, zones, pickupLocations, deliveryLocations, base, perHalfKg, remittanceDays, openParcels: panelAccess(partnerId).openParcels,
    hubAddress: hubAddress || null, hubCurrent: isCurrentAddress(hubAddress),
  };
}

export function courierOverview(partnerId) {
  const countBy = (table) => Object.fromEntries(db().prepare(`SELECT status, COUNT(*) AS c FROM ${table} WHERE partner_id = ? GROUP BY status`).all(partnerId).map((row) => [row.status, row.c]));
  const pickups = countBy('pickups');
  const shipments = countBy('shipments');
  const cod = db().prepare("SELECT COALESCE(SUM(collected), 0) AS collected, COUNT(*) AS c FROM cod_records WHERE partner_id = ? AND status IN ('collected', 'remitted')").get(partnerId);
  const pending = db().prepare("SELECT COALESCE(SUM(collected), 0) AS v FROM cod_records WHERE partner_id = ? AND status = 'collected'").get(partnerId).v;
  return {
    partner: courierPartner(partnerId),
    metrics: {
      assigned: ['scheduled', 'confirmed', 'picked_up', 'failed'].reduce((sum, status) => sum + (pickups[status] || 0), 0),
      pending: pickups.scheduled || 0,
      scheduled: pickups.confirmed || 0,
      failedPickups: pickups.failed || 0,
      pickedUp: pickups.picked_up || 0,
      active: ['picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery'].reduce((sum, status) => sum + (shipments[status] || 0), 0) + (shipments.out_for_delivery || 0),
      outForDelivery: shipments.out_for_delivery || 0,
      delivered: shipments.delivered || 0,
      failed: shipments.failed_delivery || 0,
      returned: shipments.return_to_sender || 0,
      codCollected: cod.collected,
      codCount: cod.c,
      codPending: pending,
    },
  };
}

export function reportActions(detail) {
  if (!detail.sandbox) return [];
  const pickupStatus = detail.pickup?.status;
  return detail.nextEvents.filter((status) => {
    if (status === 'pickup_confirmed') return ['scheduled', 'failed'].includes(pickupStatus);
    if (status === 'pickup_rejected') return pickupStatus === 'scheduled';
    if (status === 'pickup_failed') return ['scheduled', 'confirmed'].includes(pickupStatus);
    // In the panel a parcel is only collected once the courier has approved the pickup.
    if (status === 'picked_up' && detail.pickup) return pickupStatus === 'confirmed';
    return status !== 'booking_confirmed';
  });
}

export function ownShipment(id, partnerId) {
  const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(String(id));
  if (!row || row.partner_id !== partnerId || ['pending', 'cancelled'].includes(row.status)) throw new ApiError(404, 'We could not find that shipment.');
  return row;
}

// Leaves out Onetap's internal notes and the buyer's other shipments.
export function courierShipment(id, partnerId) {
  ownShipment(id, partnerId);
  const { notes, investigating, lastError, siblings, sellerUsername, customerUsername, checkoutId, ...detail } = shipmentDetail(id);
  return { ...detail, actions: reportActions(detail) };
}

export function courierReport(account, id, input) {
  const row = ownShipment(id, account.partnerId);
  return reportStatus(row, courierShipment(id, account.partnerId), input, account.name, actorFor(account));
}

// Checks and sends one Sandbox status report, from the partner's staff or one of its riders.
// `allowed` narrows what this reporter may send.
export function reportStatus(row, detail, input, reporter, actor, allowed = detail.actions, { requirePhoto = false, deliveredBy = reporter, riderId = '' } = {}) {
  if (!detail.sandbox) throw new ApiError(409, `${detail.courier} reports through its own API, so this can't be set here. Use Sync with Courier.`);
  const { status } = input;
  if (!allowed.includes(status)) throw new ApiError(409, 'This shipment has changed. Refresh and try again.');
  const text = (value, max) => String(value || '').trim().slice(0, max);
  const reason = text(input.reason, 200);
  const location = text(input.location, 100);
  if (NEEDS_REASON.includes(status) && reason.length < 3) throw new ApiError(422, 'Enter the reason.', { reason: 'Enter the reason.' });
  if (NEEDS_LOCATION[status] && location.length < 2) throw new ApiError(422, NEEDS_LOCATION[status], { location: NEEDS_LOCATION[status] });
  const fields = { status, reason, location, note: [reason, `Reported by ${reporter}`].filter(Boolean).join('. ') };
  if (status === 'delivered') {
    // Received By is one of this partner's active riders, required from the Rider Panel. The
    // recipient's own name is optional.
    const receivedBy = deliveryRider(row.partner_id, input.receivedBy, riderId);
    // Partner staff without a rider name the person at the door instead, so every delivery names someone.
    if (!receivedBy && !text(input.receiver, 100)) throw new ApiError(422, 'Choose who received the parcel, or enter the recipient name.', { receivedBy: 'Choose who received the parcel, or enter the recipient name.' });
    const photos = checkProofPhotos(input.photos ?? (input.photo ? [input.photo] : []), row.partner_id, { required: requirePhoto, riderId });
    fields.proof = { receiver: text(input.receiver, 100), relationship: text(input.relationship, 100), photo: photos[0]?.url || '', photos, receivedBy, deliveredBy };
    if (detail.cod) {
      const amount = Number(input.codCollected);
      if (input.codCollected === '' || !Number.isFinite(amount) || amount < 0) throw new ApiError(422, 'Enter the amount collected.', { codCollected: 'Enter the amount collected.' });
      fields.codCollected = amount;
    }
  }
  const result = sendSandboxEvent(row, fields);
  audit(actor, 'courier.status_reported', 'shipment', row.tracking, { status, outcome: result.outcome, environment: row.environment });
  if (result.outcome !== 'applied') throw new ApiError(409, 'This shipment has changed. Refresh and try again.');
  return result;
}

function deliveryRider(partnerId, id, riderId) {
  if (!id) {
    if (riderId) throw new ApiError(422, 'Choose who received the parcel.', { receivedBy: 'Choose who received the parcel.' });
    return null;
  }
  const rider = db().prepare('SELECT * FROM riders WHERE id = ? AND partner_id = ? AND active = 1').get(String(id), partnerId);
  if (!rider) throw new ApiError(422, 'Choose one of your active riders.', { receivedBy: 'Choose one of your active riders.' });
  return { id: rider.id, name: [rider.first_name, rider.middle_name, rider.last_name].filter(Boolean).join(' '), phone: rider.phone };
}

export function listCourierCod(params, partnerId) {
  const where = [
    ['partner_id = ?', partnerId],
    ["status <> 'void'"],
    ...search(params, ['order_id', 'shop_name', 'remittance_id']),
    ...equals(params, 'status', 'status'),
    ...dateRange(params, 'collected_at'),
  ];
  const { rows, ...page } = listQuery(db(), { select: COD_SELECT, from: 'cod_records', where, sorts: { created: 'created_at', collected: 'collected_at', due: 'due_at', amount: 'expected' }, defaultSort: 'created' }, params);
  const records = rows.map(toRecord);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-cod-collections.csv', [['Order', (r) => r.orderId], ['Seller', (r) => r.seller], ['Rider', (r) => r.rider], ['Rider handover', (r) => r.riderHandover], ['Expected', (r) => r.expected], ['Collected', (r) => r.collected], ['Status', (r) => r.status], ['Collected at', (r) => isoDate(r.collectedAt)], ['Remit by', (r) => isoDate(r.dueAt)], ['Remitted at', (r) => isoDate(r.remittedAt)]], records);
  }
  return Response.json({ ...page, rows: records });
}

// Finance > Remittances > Logistics Remittance: the partner's money with Onetap. COD cash it
// collected and remits to Onetap (each remittance Onetap records against its parcels), and the
// delivery fee on every delivered parcel, split into Onetap's logistics fee and the partner's share.
const REMITTANCE_STATE = (row) => (row.received === row.expected ? 'matched' : row.received < row.expected ? 'short' : 'over');

export function courierLogisticsRemittances(params, partnerId) {
  const view = params.get('view') === 'deliveries' ? 'deliveries' : 'remittances';
  const sum = (sql, ...args) => db().prepare(sql).get(partnerId, ...args).v;
  const summary = {
    awaiting: sum("SELECT COALESCE(SUM(collected), 0) AS v FROM cod_records WHERE partner_id = ? AND status = 'collected'"),
    awaitingParcels: sum("SELECT COUNT(*) AS v FROM cod_records WHERE partner_id = ? AND status = 'collected'"),
    overdue: sum("SELECT COALESCE(SUM(collected), 0) AS v FROM cod_records WHERE partner_id = ? AND status = 'collected' AND due_at < ?", Date.now()),
    remitted: sum('SELECT COALESCE(SUM(received), 0) AS v FROM cod_remittances WHERE partner_id = ?'),
    remittances: sum('SELECT COUNT(*) AS v FROM cod_remittances WHERE partner_id = ?'),
    discrepancies: sum('SELECT COUNT(*) AS v FROM cod_remittances WHERE partner_id = ? AND received <> expected'),
    deliveryFees: sum('SELECT COALESCE(SUM(rider_fee), 0) AS v FROM collection_records WHERE partner_id = ?'),
    logisticsFees: sum('SELECT COALESCE(SUM(logistics_fee), 0) AS v FROM collection_records WHERE partner_id = ?'),
    courierShare: sum('SELECT COALESCE(SUM(courier_share), 0) AS v FROM collection_records WHERE partner_id = ?'),
  };
  if (view === 'remittances') {
    const where = [['r.partner_id = ?', partnerId], ...search(params, ['r.reference', 'r.note']), ...dateRange(params, 'r.at')];
    const { rows, ...page } = listQuery(db(), {
      select: 'r.*, (SELECT COUNT(*) FROM cod_records c WHERE c.remittance_id = r.id) AS parcels',
      from: 'cod_remittances r', where, sorts: { at: 'r.at', received: 'r.received' }, defaultSort: 'at',
    }, params);
    const records = rows.map((row) => ({
      id: row.id, reference: row.reference, parcels: row.parcels, expected: row.expected, received: row.received, difference: row.received - row.expected,
      status: REMITTANCE_STATE(row), note: row.note, at: row.at,
    }));
    if (params.get('format') === 'csv') {
      return csvResponse('onetap-cod-remittances.csv', [['Reference', (r) => r.reference], ['Parcels', (r) => r.parcels], ['Expected', (r) => r.expected], ['Received', (r) => r.received], ['Difference', (r) => r.difference], ['Status', (r) => r.status], ['Note', (r) => r.note], ['Recorded', (r) => isoDate(r.at)]], records);
    }
    return Response.json({ view, summary, ...page, rows: records });
  }
  const where = [['cr.partner_id = ?', partnerId], ...search(params, ['cr.order_id', 'cr.shop_name', 'cr.customer_name']), ...dateRange(params, 'cr.collected_at')];
  const { rows, ...page } = listQuery(db(), {
    select: 'cr.*, c.status AS cod_status, c.remitted_at, r.reference AS remittance_reference',
    from: 'collection_records cr LEFT JOIN cod_records c ON c.order_id = cr.order_id LEFT JOIN cod_remittances r ON r.id = c.remittance_id',
    where, sorts: { delivered: 'cr.collected_at', fee: 'cr.rider_fee' }, defaultSort: 'delivered',
  }, params);
  // How the parcel's money stands: prepaid is with Onetap already, COD is with the partner until remitted.
  const records = rows.map((row) => ({
    orderId: row.order_id, seller: row.shop_name, paymentMethod: row.payment_method, deliveredAt: row.collected_at, orderTotal: row.total,
    deliveryFee: row.rider_fee, logisticsFee: row.logistics_fee, courierShare: row.courier_share ?? row.rider_fee,
    paymentStatus: row.payment_method !== 'Cash on Delivery' ? 'prepaid' : row.cod_status === 'remitted' ? 'remitted' : 'awaiting',
    remittanceReference: row.remittance_reference || '', remittedAt: row.remitted_at,
  }));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-delivery-fees.csv', [['Order', (r) => r.orderId], ['Seller', (r) => r.seller], ['Payment', (r) => r.paymentMethod], ['Delivered', (r) => isoDate(r.deliveredAt)], ['Order total', (r) => r.orderTotal],
      ['Delivery fee', (r) => r.deliveryFee], ['Onetap logistics fee', (r) => r.logisticsFee], ['Your share', (r) => r.courierShare], ['Payment status', (r) => r.paymentStatus], ['Remittance', (r) => r.remittanceReference]], records);
  }
  return Response.json({ view, summary, ...page, rows: records });
}

const rate = (part, whole) => (whole ? part / whole : null);

export function courierReports(params, partnerId) {
  const asked = Number(params.get('days'));
  const days = REPORT_PERIODS.includes(asked) ? asked : 30;
  const since = Date.now() - days * DAY;
  const rows = db().prepare("SELECT status, eta, picked_up_at, delivered_at FROM shipments WHERE partner_id = ? AND created_at >= ? AND status NOT IN ('pending', 'cancelled')").all(partnerId, since);
  const count = (status) => rows.filter((row) => row.status === status).length;
  const delivered = rows.filter((row) => row.status === 'delivered');
  const onTime = delivered.filter((row) => row.eta && row.delivered_at <= row.eta).length;
  const timed = delivered.filter((row) => row.picked_up_at && row.delivered_at);
  const hours = timed.length ? timed.reduce((sum, row) => sum + row.delivered_at - row.picked_up_at, 0) / timed.length / (60 * 60 * 1000) : null;
  const pickups = Object.fromEntries(db().prepare("SELECT status, COUNT(*) AS c FROM pickups WHERE partner_id = ? AND created_at >= ? GROUP BY status").all(partnerId, since).map((row) => [row.status, row.c]));
  const failed = count('failed_delivery');
  const returned = count('return_to_sender');
  const trendSince = Date.now() - TREND_DAYS * DAY;
  return {
    days,
    shipments: rows.length,
    delivered: delivered.length,
    failed,
    returned,
    successRate: rate(delivered.length, delivered.length + failed + returned),
    onTimeRate: rate(onTime, delivered.length),
    averageHours: hours,
    pickupRate: rate(pickups.picked_up || 0, (pickups.picked_up || 0) + (pickups.failed || 0)),
    collectedPerDay: daily(db().prepare(`SELECT ${dayColumn('picked_up_at')} AS day, COUNT(*) AS value FROM shipments WHERE partner_id = ? AND picked_up_at >= ? GROUP BY day`).all(partnerId, trendSince)),
    deliveredPerDay: daily(db().prepare(`SELECT ${dayColumn('delivered_at')} AS day, COUNT(*) AS value FROM shipments WHERE partner_id = ? AND delivered_at >= ? GROUP BY day`).all(partnerId, trendSince)),
  };
}

export async function changeCourierPassword(account, current, next) {
  const row = db().prepare('SELECT * FROM courier_users WHERE username = ?').get(account.username);
  if (typeof current !== 'string' || !await checkPassword(current, row.password)) throw new ApiError(422, 'Your current password is not right.', { current: 'Your current password is not right.' });
  if (typeof next !== 'string' || next.length < 12 || next.length > 128) throw new ApiError(422, 'Use at least 12 characters.', { next: 'Use at least 12 characters.' });
  db().prepare('UPDATE courier_users SET password = ? WHERE username = ?').run(await hashPassword(next), row.username);
  audit(actorFor(account), 'courier_user.password_changed', 'partner', account.partnerId, { username: row.username });
}

// The partner's hub or branch address, in the standard format, set from its Company Profile.
export function savePartnerHub(account, input) {
  const hub = checkedAddress(input);
  const row = db().prepare('SELECT data FROM logistics_partners WHERE id = ?').get(account.partnerId);
  db().prepare('UPDATE logistics_partners SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.data), hubAddress: hub }), Date.now(), account.partnerId);
  audit({ username: account.username, adminRole: `courier:${account.partnerId}` }, 'partner.hub_changed', 'logistics_partner', account.partnerId, { address: formatAddress(hub) });
  return courierPartner(account.partnerId);
}
