// Shipments. Nothing here is marked booked, picked up or delivered without the courier saying
// so: bookings wait for a confirmed response, and movement comes from verified webhooks. Each
// change also updates the order and COD record in one transaction. Pickup requests and courier
// assignment are in pickups.js.

import { randomUUID } from 'node:crypto';
import { reviewFailure } from './orderLink';
import { callCourier, loadIntegration, loadPartner, secretsFor } from './couriers';
import { hmac, safeEqual } from './crypto';
import { assignCodPartner, markCodCollected, voidCodRecord } from './cod';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';
import { notifyCourier, notifyCustomer, notifySeller } from './notifications';
import { audit } from './admin';
import { recordCollection } from './collections';
import { linkProofPhoto } from './proofs';
import { currentRiders, riderTasksFollow, shipmentTasks } from './riderTasks';

export const SHIPMENT_STATUSES = ['pending', 'booking_confirmed', 'ready_for_pickup', 'picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'failed_delivery', 'return_to_sender', 'cancelled'];

const NEXT = {
  pending: ['booking_confirmed', 'cancelled'],
  // A parcel can only be collected once its pickup has been approved and booked.
  booking_confirmed: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['picked_up', 'booking_confirmed', 'cancelled'],
  picked_up: ['in_transit', 'at_sorting_facility', 'arrived_delivery_hub', 'out_for_delivery', 'delivered', 'failed_delivery'],
  in_transit: ['at_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'failed_delivery', 'return_to_sender'],
  at_sorting_facility: ['sorting_completed', 'departed_sorting_facility', 'in_transit', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'failed_delivery', 'return_to_sender'],
  sorting_completed: ['departed_sorting_facility', 'in_transit', 'arrived_delivery_hub', 'out_for_delivery', 'failed_delivery', 'return_to_sender'],
  departed_sorting_facility: ['in_transit', 'at_sorting_facility', 'arrived_delivery_hub', 'out_for_delivery', 'failed_delivery', 'return_to_sender'],
  arrived_delivery_hub: ['ready_for_delivery', 'out_for_delivery', 'in_transit', 'at_sorting_facility', 'failed_delivery', 'return_to_sender'],
  // Ready for Delivery: all three steps are done and the parcel waits for its rider to set off.
  ready_for_delivery: ['out_for_delivery', 'in_transit', 'at_sorting_facility', 'failed_delivery', 'return_to_sender'],
  out_for_delivery: ['in_transit', 'arrived_delivery_hub', 'delivered', 'failed_delivery'],
  failed_delivery: ['in_transit', 'arrived_delivery_hub', 'out_for_delivery', 'delivered', 'return_to_sender'],
  return_to_sender: [],
  delivered: [],
  cancelled: [],
};

const LABELS = {
  picked_up: 'Parcel picked up', in_transit: 'Parcel in transit', at_sorting_facility: 'Arrived at sorting facility', sorting_completed: 'Sorting completed', departed_sorting_facility: 'Departed sorting facility', arrived_delivery_hub: 'Arrived at delivery hub', ready_for_delivery: 'Ready for delivery', out_for_delivery: 'Out for delivery', delivered: 'Delivered to buyer', return_to_sender: 'Parcel returning to seller',
};

const NOTICES = {
  picked_up: 'Parcel picked up', in_transit: 'Parcel on the way', at_sorting_facility: 'Parcel at sorting facility', sorting_completed: 'Parcel sorted', departed_sorting_facility: 'Parcel left sorting facility', arrived_delivery_hub: 'Parcel at delivery hub', out_for_delivery: 'Parcel out for delivery', delivered: 'Parcel delivered',
  failed_delivery: 'Delivery not completed', return_to_sender: 'Parcel returning to seller',
};

const ACTIVE = "('booking_confirmed', 'ready_for_pickup', 'picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'failed_delivery')";
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const PICKUP_EVENTS = ['pickup_confirmed', 'pickup_failed', 'pickup_rejected'];

const db = () => getDb();
const now = () => Date.now();

export function transaction(work) {
  db().exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db().exec('COMMIT');
    return result;
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }
}

export function readOrder(id) {
  const row = db().prepare('SELECT data FROM orders WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

export function writeOrder(order, patch, event) {
  const at = new Date().toISOString();
  const next = { ...order, ...patch, events: event ? [...order.events, { label: event, at }] : order.events };
  db().prepare('UPDATE orders SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), Date.now(), order.id);
  return next;
}

export function addEvent(shipmentId, status, source, note = '', location = '', at = now()) {
  db().prepare('INSERT INTO shipment_events (shipment_id, status, note, location, source, at) VALUES (?, ?, ?, ?, ?, ?)').run(shipmentId, status, note, location, source, at);
}

export function setShipment(id, status, extra = {}) {
  const fields = Object.keys(extra).map((column) => `${column} = ?`);
  db().prepare(`UPDATE shipments SET ${['status = ?', ...fields, 'updated_at = ?'].join(', ')} WHERE id = ?`).run(status, ...Object.values(extra), now(), id);
  riderTasksFollow(id, status);
}

export const activeShipment = (orderId) => db().prepare("SELECT * FROM shipments WHERE order_id = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1").get(orderId);

export function partnerForName(name, audience) {
  const row = db().prepare("SELECT id FROM logistics_partners WHERE name = ? AND status = 'active'").get(String(name));
  if (!row) throw new ApiError(422, 'Choose an available courier.');
  const partner = loadPartner(row.id);
  if (audience === 'seller' && !partner.forSellers) throw new ApiError(422, 'Choose an available courier.');
  return partner;
}

const trackingLink = (partner, tracking) => (partner.trackingUrl && tracking ? partner.trackingUrl.replace('{tracking}', encodeURIComponent(tracking)) : '');

// Books with the courier. A failed or interrupted attempt keeps its row and idempotency key,
// so trying again can never create a second booking.
export async function bookShipment(order, partner, method) {
  let row = activeShipment(order.id);
  if (row && row.status !== 'pending') return row;
  if (!row) {
    const id = randomUUID();
    const time = now();
    db().prepare(`
      INSERT INTO shipments (id, order_id, checkout_id, seller, customer, partner_id, partner_name, environment, method, status, idempotency_key, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(id, order.id, order.checkoutId || '', order.seller, order.customer, partner.id, partner.name, partner.environment, method, `book:${order.id}:${id}`, JSON.stringify({ shopName: order.shopName, buyer: order.buyer, total: order.total, cod: order.payment === 'Cash on Delivery' }), time, time);
    addEvent(id, 'pending', 'onetap', 'Booking requested');
    row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  }
  let booking;
  try {
    booking = await callCourier(partner, 'createBooking', { reference: order.id, idempotencyKey: row.idempotency_key, order, method });
  } catch (err) {
    db().prepare('UPDATE shipments SET last_error = ?, updated_at = ? WHERE id = ?').run(err.message, now(), row.id);
    throw err;
  }
  return transaction(() => {
    const current = db().prepare('SELECT * FROM shipments WHERE id = ?').get(row.id);
    if (current.status !== 'pending') return current;
    // Cancelled while the courier was answering. The caller releases the booking.
    if (readOrder(order.id).status === 'cancelled') return { ...current, tracking: booking.tracking, status: 'cancelled' };
    setShipment(row.id, 'booking_confirmed', { tracking: booking.tracking, booking_ref: booking.bookingRef, eta: booking.eta || null, last_error: '' });
    addEvent(row.id, 'booking_confirmed', 'courier', `Booking ${booking.bookingRef} confirmed`);
    assignCodPartner(order.id, partner);
    writeOrder(readOrder(order.id), {
      status: 'ready', courier: partner.name, method, tracking: booking.tracking, bookingRef: booking.bookingRef, shipmentStatus: 'booking_confirmed', eta: booking.eta || null,
      sandbox: partner.environment === 'sandbox', trackingUrl: trackingLink(partner, booking.tracking),
    }, `Booking confirmed with ${partner.name} (${method})`);
    notifyCustomer(order.customer, 'Courier assigned', `${partner.name} will deliver ${order.id}. Tracking number ${booking.tracking}.`, `/orders/${order.id}`);
    return db().prepare('SELECT * FROM shipments WHERE id = ?').get(row.id);
  });
}

// Tells the courier to redeliver or return a parcel, once it has accepted.
export async function instructCourier(order, action) {
  const shipment = activeShipment(order.id);
  if (!shipment) throw new ApiError(409, 'This order has no active shipment.');
  await callCourier(loadPartner(shipment.partner_id), 'instruct', { reference: order.id, tracking: shipment.tracking, action, idempotencyKey: `${action}:${shipment.id}:${order.failed?.attempts || 0}` });
  transaction(() => {
    const status = action === 'reattempt' ? 'in_transit' : 'return_to_sender';
    setShipment(shipment.id, status);
    addEvent(shipment.id, status, 'courier', action === 'reattempt' ? 'Courier accepted redelivery' : 'Courier accepted return');
    if (action === 'reattempt') notifyCustomer(order.customer, 'Delivery will be tried again', `${shipment.partner_name} will try to deliver ${order.id} again.`, `/orders/${order.id}`);
  });
}

// Cancels at the courier first, so a cancelled order never leaves a live booking behind.
export async function cancelShipment(orderId) {
  const shipment = activeShipment(orderId);
  if (shipment?.tracking) await callCourier(loadPartner(shipment.partner_id), 'cancelBooking', { reference: orderId, tracking: shipment.tracking });
  transaction(() => {
    if (shipment) {
      setShipment(shipment.id, 'cancelled');
      addEvent(shipment.id, 'cancelled', 'courier', 'Booking cancelled');
    }
    db().prepare("UPDATE pickups SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status NOT IN ('picked_up', 'cancelled', 'rejected')").run(now(), orderId);
    if (shipment?.tracking) notifyCourier(shipment.partner_id, 'Pickup cancelled', `${orderId} was cancelled. Don't collect this parcel.`);
  });
}

// Applies one courier report inside the caller's transaction. Returns false if it doesn't fit.
// A Sandbox parcel is ready for delivery, and can go out for delivery, only once it has been
// marked in transit, has arrived at a sorting facility and has arrived at a delivery hub. When the
// last of the three is recorded it becomes Ready for Delivery automatically, and its rider sends it
// Out for Delivery. A live courier's own reports are always applied.
export const DISPATCH_STEPS = ['in_transit', 'at_sorting_facility', 'arrived_delivery_hub'];

export function dispatchSteps(shipmentId) {
  const done = {};
  db().prepare("SELECT status, note, location, at FROM shipment_events WHERE shipment_id = ? AND note NOT LIKE 'Ignored:%' ORDER BY id").all(shipmentId).forEach((event) => {
    if (DISPATCH_STEPS.includes(event.status) && !done[event.status]) done[event.status] = event;
  });
  return DISPATCH_STEPS.map((status) => ({ status, done: Boolean(done[status]), at: done[status]?.at || null, location: done[status]?.location || '', note: done[status]?.note || '' }));
}

const DISPATCH_GATED = ['ready_for_delivery', 'out_for_delivery'];
// Waiting at the hub is internal: the buyer hears when their rider sets off.
const QUIET = ['ready_for_delivery'];

export const dispatchReady = (shipmentId) => dispatchSteps(shipmentId).every((step) => step.done);

function applyStatus(shipment, event) {
  const { status, note = '', location = '', at, reason = '', codCollected, proof } = event;
  if (!NEXT[shipment.status]?.includes(status)) {
    addEvent(shipment.id, status, 'webhook', `Ignored: cannot follow ${shipment.status}`, location, at);
    return false;
  }
  if (DISPATCH_GATED.includes(status) && shipment.environment === 'sandbox' && !dispatchReady(shipment.id)) {
    addEvent(shipment.id, status, 'webhook', 'Ignored: not yet in transit, at a sorting facility and at a delivery hub', location, at);
    return false;
  }
  setShipment(shipment.id, status);
  addEvent(shipment.id, status, 'webhook', note || reason, location, at);
  const partner = loadPartner(shipment.partner_id);
  const order = readOrder(shipment.order_id);
  const label = `${LABELS[status] || status}${location ? ` (${location})` : ''}`;
  if (status === 'picked_up') {
    db().prepare("UPDATE pickups SET status = 'picked_up', picked_up_at = ?, updated_at = ? WHERE shipment_id = ? AND status IN ('scheduled', 'confirmed', 'failed')").run(at, now(), shipment.id);
    db().prepare('UPDATE shipments SET picked_up_at = ? WHERE id = ?').run(at, shipment.id);
    const cancel = order.cancel?.status === 'pending' ? { ...order.cancel, status: 'rejected', response: 'The courier already has this parcel.' } : order.cancel;
    writeOrder(order, { status: 'shipping', shipmentStatus: status, cancel, pickedUpAt: new Date(at).toISOString(), pickup: order.pickup && { ...order.pickup, status: 'picked_up' } }, label);
  } else if (status === 'delivered') {
    const delivery = cleanProof(proof);
    db().prepare('UPDATE shipments SET delivered_at = ?, proof = ? WHERE id = ?').run(at, delivery ? JSON.stringify(delivery) : '', shipment.id);
    delivery?.photos.forEach((item) => linkProofPhoto(item.url, shipment.id));
    const completed = writeOrder(order, { status: 'completed', paid: true, deliveredAt: new Date(at).toISOString(), shipmentStatus: status, proof: delivery }, label);
    if (order.payment === 'Cash on Delivery') markCodCollected(order.id, partner, Number.isFinite(codCollected) ? codCollected : order.total, at);
    recordCollection(completed, shipment, at);
  } else if (status === 'out_for_delivery') {
    db().prepare('UPDATE shipments SET out_for_delivery_at = ? WHERE id = ?').run(at, shipment.id);
    writeOrder(order, { status: 'shipping', shipmentStatus: status, outForDeliveryAt: new Date(at).toISOString() }, label);
  } else if (status === 'failed_delivery') {
    writeOrder(order, { status: 'failed', shipmentStatus: status, failed: reviewFailure(order, reason, at) }, `Delivery failed: ${reason || 'Reason not given'}`);
  } else if (status === 'return_to_sender') {
    const failed = order.failed || reviewFailure(order, reason, at);
    writeOrder(order, { status: 'failed', shipmentStatus: status, failed: { ...failed, status: 'returning' } }, label);
  } else {
    writeOrder(order, { status: 'shipping', shipmentStatus: status }, label);
  }
  const notice = `${order.id}: ${LABELS[status] || reason || 'Delivery not completed'}${location ? ` (${location})` : ''}.`;
  if (!QUIET.includes(status)) {
    notifyCustomer(order.customer, NOTICES[status], notice, `/orders/${order.id}`);
    notifySeller(order.seller, NOTICES[status], notice, `/seller/orders/${order.id}`);
  }
  if (DISPATCH_STEPS.includes(status) && shipment.environment === 'sandbox' && dispatchReady(shipment.id)) {
    const current = db().prepare('SELECT * FROM shipments WHERE id = ?').get(shipment.id);
    if (NEXT[current.status].includes('ready_for_delivery') && applyStatus(current, { status: 'ready_for_delivery', location, at, note: 'Automatically: in transit, sorting facility and delivery hub all done' })) {
      audit({ username: 'onetap', adminRole: 'system' }, 'shipment.ready_for_delivery', 'shipment', current.tracking, { order: current.order_id, automatic: true });
    }
  }
  return true;
}

// The courier turned the job down, so its booking is void and it can't be offered this pickup
// again. The retry timer then assigns another courier, or leaves it for an administrator.
function declinePickup(shipment, pickup, order, reason, at) {
  if (pickup.status !== 'scheduled') return false;
  setShipment(shipment.id, 'cancelled');
  addEvent(shipment.id, 'pickup_rejected', 'webhook', reason || 'Courier declined the pickup', '', at);
  db().prepare("UPDATE pickups SET status = 'pending', shipment_id = '', partner_id = '', partner_name = '', booking_ref = '', confirmation = '', booking_error = '', retries = 0, retry_at = NULL, attempts = attempts + 1, failed_reason = ?, rejected_by = ?, auto_assign = 1, updated_at = ? WHERE id = ?")
    .run(reason || 'Reason not given', JSON.stringify([...JSON.parse(pickup.rejected_by), shipment.partner_id]), now(), pickup.id);
  writeOrder(order, { status: 'to_ship', courier: '', tracking: '', bookingRef: '', shipmentStatus: '', eta: null, trackingUrl: '', pickup: order.pickup && { ...order.pickup, status: 'pending', courier: '' } }, `${shipment.partner_name} declined the pickup. Finding another courier`);
  notifySeller(order.seller, 'Courier declined', `${shipment.partner_name} can't collect ${order.id}${reason ? `: ${reason}` : ''}. Onetap is finding another courier, and your old waybill is no longer valid.`, '/seller/orders/pickups');
  notifyCustomer(order.customer, 'Changing courier', `We're assigning a new courier for ${order.id}. Your tracking number will change.`, `/orders/${order.id}`);
  return true;
}

function applyPickupEvent(shipment, { status, reason = '', confirmation = '', at }) {
  const pickup = db().prepare("SELECT * FROM pickups WHERE shipment_id = ? AND status IN ('scheduled', 'confirmed', 'failed') ORDER BY created_at DESC LIMIT 1").get(shipment.id);
  if (!pickup) return false;
  const order = readOrder(shipment.order_id);
  const mirror = (next, label) => writeOrder(order, { pickup: order.pickup && { ...order.pickup, status: next } }, label);
  if (status === 'pickup_rejected') return declinePickup(shipment, pickup, order, reason, at);
  if (status === 'pickup_confirmed') {
    db().prepare("UPDATE pickups SET status = 'confirmed', confirmation = ?, updated_at = ? WHERE id = ?").run(confirmation || `CONF-${pickup.booking_ref}`, now(), pickup.id);
    addEvent(shipment.id, status, 'webhook', 'Courier confirmed the pickup', '', at);
    mirror('confirmed', `Pickup approved by ${shipment.partner_name}`);
    notifySeller(order.seller, 'Pickup confirmed', `${shipment.partner_name} confirmed the pickup for ${order.id}.`, '/seller/orders/pickups');
  } else {
    db().prepare("UPDATE pickups SET status = 'failed', failed_reason = ?, updated_at = ? WHERE id = ?").run(reason || 'Reason not given', now(), pickup.id);
    riderTasksFollow(shipment.id, 'pickup_failed');
    addEvent(shipment.id, status, 'webhook', reason || 'Pickup failed', '', at);
    mirror('failed', 'Pickup attempt failed');
    notifySeller(order.seller, 'Pickup failed', `${order.id}: ${reason || 'The courier could not collect the parcel'}. Choose a new date.`, '/seller/orders/pickups');
  }
  return true;
}

// The single entry point for verified courier reports. event.id makes repeats harmless.
export function processCourierEvent(partnerId, event) {
  return transaction(() => {
    const key = `${partnerId}:${event.id}`;
    const seen = db().prepare('SELECT 1 FROM webhook_events WHERE event_key = ?').get(key);
    if (seen) return { outcome: 'duplicate' };
    const shipment = db().prepare('SELECT * FROM shipments WHERE tracking = ? AND partner_id = ?').get(String(event.tracking), partnerId);
    let outcome = 'unknown_shipment';
    if (shipment) {
      const pickupEvent = PICKUP_EVENTS.includes(event.status);
      const applied = pickupEvent ? applyPickupEvent(shipment, event) : applyStatus(shipment, event);
      outcome = applied ? 'applied' : 'ignored';
      audit({ username: `courier:${partnerId}`, adminRole: 'courier_api' }, `shipment.${event.status}`, 'shipment', event.tracking, { outcome, order: shipment.order_id, location: event.location || '' });
    }
    db().prepare('INSERT INTO webhook_events (event_key, partner_id, outcome, tracking, status, at) VALUES (?, ?, ?, ?, ?, ?)').run(key, partnerId, outcome, String(event.tracking), String(event.status), now());
    return { outcome };
  });
}

const PROOF_PHOTO = /^(\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp)|\/api\/proofs\/[a-f0-9-]{36}|https:\/\/\S+)$/;

// Proof of delivery is optional, because not every courier supplies it.
function cleanProof(proof) {
  if (typeof proof !== 'object' || proof === null) return null;
  const text = (value) => String(value || '').trim().slice(0, 100);
  const photos = (Array.isArray(proof.photos) ? proof.photos : [{ url: proof.photo }]).filter((item) => PROOF_PHOTO.test(item?.url || '')).slice(0, 3)
    .map((item) => ({ url: item.url, at: Number.isFinite(item.at) ? item.at : null }));
  const rider = proof.receivedBy && typeof proof.receivedBy === 'object' ? { id: text(proof.receivedBy.id), name: text(proof.receivedBy.name), phone: text(proof.receivedBy.phone) } : null;
  const clean = { receiver: text(proof.receiver), relationship: text(proof.relationship), photo: photos[0]?.url || '', photos, receivedBy: rider?.name ? rider : null, deliveredBy: text(proof.deliveredBy) };
  return clean.receiver || clean.photo || clean.receivedBy ? clean : null;
}

function logRejected(partnerId, error) {
  db().prepare("INSERT INTO webhook_events (event_key, partner_id, outcome, error, at) VALUES (?, ?, 'rejected', ?, ?)").run(`rejected:${randomUUID()}`, partnerId, error, now());
}

const EVENT_STATUSES = [...SHIPMENT_STATUSES, ...PICKUP_EVENTS];

// Signature is HMAC-SHA256 of `timestamp.body` with the partner's webhook secret.
export function signWebhook(secret, timestamp, body) {
  return hmac(secret, `${timestamp}.${body}`);
}

export function handleWebhook(partnerId, body, signature, timestamp) {
  const partner = loadPartner(partnerId);
  const secret = secretsFor(loadIntegration(partnerId, partner.environment)).webhookSecret;
  const reject = (status, message) => {
    logRejected(partnerId, message);
    throw new ApiError(status, message);
  };
  if (!secret) reject(401, 'Webhook secret is not configured.');
  if (!signature || !timestamp || !safeEqual(signWebhook(secret, timestamp, body), signature)) reject(401, 'Invalid webhook signature.');
  if (Math.abs(now() - Number(timestamp)) > WEBHOOK_MAX_AGE_MS) reject(401, 'Webhook timestamp is too old.');
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    reject(400, 'Webhook body is not valid JSON.');
  }
  if (!event?.id || !event.tracking || !EVENT_STATUSES.includes(event.status)) reject(400, 'Webhook body is missing required fields.');
  return processCourierEvent(partnerId, { ...event, at: Date.parse(event.occurredAt) || now() });
}

export function toShipment(row) {
  const data = JSON.parse(row.data);
  return {
    id: row.id, orderId: row.order_id, checkoutId: row.checkout_id, seller: data.shopName, sellerUsername: row.seller, customer: data.buyer.name, customerUsername: row.customer,
    address: data.buyer.address, phone: data.buyer.phone, partnerId: row.partner_id, courier: row.partner_name, environment: row.environment, method: row.method, tracking: row.tracking,
    bookingRef: row.booking_ref, status: row.status, eta: row.eta, investigating: Boolean(row.investigating), lastError: row.last_error, total: data.total, cod: data.cod, notes: data.notes || [],
    delayed: Boolean(row.eta && row.eta < now() && !['delivered', 'cancelled', 'return_to_sender'].includes(row.status)),
    pickedUpAt: row.picked_up_at, outForDeliveryAt: row.out_for_delivery_at, deliveredAt: row.delivered_at, proof: row.proof ? JSON.parse(row.proof) : null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const SHIPMENT_LIST = {
  from: 'shipments',
  sorts: { updated: 'updated_at', created: 'created_at', eta: 'eta', status: 'status', courier: 'partner_name' },
  defaultSort: 'updated',
};

// partnerId limits the list to one courier, for the Logistics Partner Panel.
export function listShipments(params, partnerId) {
  const where = [
    ...(partnerId ? [['partner_id = ?', partnerId], ["status NOT IN ('pending', 'cancelled')"]] : []),
    ...search(params, ['tracking', 'order_id', 'seller', 'customer', 'booking_ref']),
    ...equals(params, 'status', 'status'),
    ...equals(params, 'partner', 'partner_id'),
    ...dateRange(params, 'created_at'),
  ];
  if (params.get('group') === 'active') where.push(["status IN ('picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery')"]);
  if (params.get('delayed')) where.push([`eta < ? AND status IN ${ACTIVE}`, now()]);
  const { rows, ...page } = listQuery(db(), { ...SHIPMENT_LIST, where }, params);
  const shipments = rows.map((row) => {
    const riders = currentRiders(row.id);
    return { ...toShipment(row), rider: (riders.delivery || riders.pickup)?.rider || '' };
  });
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-shipments.csv', [
      ['Tracking', (s) => s.tracking], ['Order', (s) => s.orderId], ['Courier', (s) => s.courier], ['Environment', (s) => s.environment], ['Status', (s) => s.status], ['Seller', (s) => s.seller],
      ['Customer', (s) => s.customer], ['Address', (s) => s.address], ['ETA', (s) => isoDate(s.eta)], ['Created', (s) => isoDate(s.createdAt)],
    ], shipments);
  }
  return Response.json({ ...page, rows: shipments });
}

export function shipmentDetail(id) {
  const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that shipment.');
  const events = db().prepare('SELECT status, note, location, source, at FROM shipment_events WHERE shipment_id = ? ORDER BY id DESC').all(id);
  const pickup = db().prepare('SELECT * FROM pickups WHERE shipment_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
  const partner = loadPartner(row.partner_id);
  const shipment = toShipment(row);
  const siblings = row.checkout_id ? db().prepare('SELECT id, order_id, tracking, status, partner_name FROM shipments WHERE checkout_id = ? AND id <> ?').all(row.checkout_id, id) : [];
  const order = readOrder(row.order_id);
  return {
    ...shipment,
    events,
    pickup: pickup ? toPickup(pickup) : null,
    riders: currentRiders(id),
    riderTasks: shipmentTasks(id),
    siblings,
    items: order?.items || [],
    trackingUrl: trackingLink(partner, row.tracking),
    sandbox: row.environment === 'sandbox',
    dispatchSteps: dispatchSteps(id),
    nextEvents: row.environment === 'sandbox' ? [...NEXT[row.status].filter((s) => s !== 'cancelled' && s !== 'booking_confirmed' && (!DISPATCH_GATED.includes(s) || dispatchReady(id))), ...(pickup && ['scheduled', 'confirmed', 'failed'].includes(pickup.status) ? PICKUP_EVENTS : [])] : [],
  };
}

export function addShipmentNote(admin, id, note) {
  const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that shipment.');
  const text = String(note || '').trim();
  if (!text || text.length > 300) throw new ApiError(422, 'Enter a note of up to 300 characters.');
  const data = JSON.parse(row.data);
  const notes = [...(data.notes || []), { text, admin: admin.username, at: now() }];
  db().prepare('UPDATE shipments SET data = ?, investigating = 1, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...data, notes }), now(), id);
  audit(admin, 'shipment.note_added', 'shipment', row.tracking || id);
}

export function resolveInvestigation(admin, id) {
  db().prepare('UPDATE shipments SET investigating = 0 WHERE id = ?').run(id);
  audit(admin, 'shipment.investigation_closed', 'shipment', id);
}

export async function syncShipment(admin, id) {
  const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!row?.tracking) throw new ApiError(409, 'This shipment has no tracking number yet.');
  const partner = loadPartner(row.partner_id);
  const { events } = await callCourier(partner, 'track', { reference: row.order_id, tracking: row.tracking });
  const applied = events.map((event) => processCourierEvent(partner.id, event)).filter((result) => result.outcome === 'applied').length;
  audit(admin, 'shipment.synced', 'shipment', row.tracking, { applied });
  return { applied };
}

// Sandbox only: sends a signed event through the same verification a real courier's would.
export function sendSandboxEvent(row, fields) {
  if (row.environment !== 'sandbox') throw new ApiError(409, 'Courier events can only be simulated in Sandbox.');
  const secret = secretsFor(loadIntegration(row.partner_id, 'sandbox')).webhookSecret;
  const body = JSON.stringify({ id: randomUUID(), tracking: row.tracking, occurredAt: new Date().toISOString(), ...fields });
  const timestamp = String(now());
  return handleWebhook(row.partner_id, body, signWebhook(secret, timestamp, body), timestamp);
}

export function simulateCourierEvent(admin, id, { status, reason, location, codCollected }) {
  const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that shipment.');
  const result = sendSandboxEvent(row, { status, reason, location, codCollected });
  audit(admin, 'sandbox.event_simulated', 'shipment', row.tracking, { status, outcome: result.outcome });
  return result;
}

export function toPickup(row) {
  return {
    id: row.id, shipmentId: row.shipment_id, orderId: row.order_id, seller: row.shop_name, sellerUsername: row.seller, courier: row.partner_name, partnerId: row.partner_id, address: row.address,
    scheduledFor: row.scheduled_for, status: row.status, bookingRef: row.booking_ref, confirmation: row.confirmation, failedReason: row.failed_reason, attempts: row.attempts, createdAt: row.created_at, updatedAt: row.updated_at,
    method: row.method, slot: row.slot, area: row.area, contactName: row.contact_name, contactPhone: row.contact_phone, parcel: JSON.parse(row.parcel), preferredCourier: row.preferred_courier,
    reviewNote: row.review_note, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, bookingError: row.booking_error, retries: row.retries, pickedUpAt: row.picked_up_at,
  };
}

export { voidCodRecord };
