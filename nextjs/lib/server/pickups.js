// Pickup requests, from the seller's schedule to a confirmed courier booking. A prepaid order
// waits for payment first, and no courier hears about it until then. After that the request goes
// to a courier automatically, unless administrators have turned on review or no courier can take
// it, when it waits in Pickup Approval. Booking runs outside any transaction, so a failed attempt
// leaves the request approved and its idempotency keys in place for the next try.

import { randomUUID } from 'node:crypto';
import { audit } from './admin';
import { callCourier, loadIntegration, loadPartner } from './couriers';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';
import { logisticsOptions } from './logistics';
import { notifyCourier, notifySeller } from './notifications';
import { shopAddress } from './orderLink';
import { closeRiderTasks, currentRiders } from './riderTasks';
import { activeShipment, addEvent, bookShipment, partnerForName, readOrder, setShipment, toPickup, transaction, writeOrder } from './shipments';
import { PICKUP_METHODS, PICKUP_SLOTS } from '../schemas';
import { SHIPPING_ZONES } from '../data';
import { shippingEstimates } from '../products';

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS_AHEAD = 14;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 30 * 1000;
const SELLER_CHANGEABLE = ['awaiting_payment', 'pending', 'scheduled', 'failed'];
const COD = 'Cash on Delivery';
const REVIEW_SETTING = 'pickup_review';
const ADMIN_CLOSED = ['picked_up', 'cancelled', 'rejected'];
const SYSTEM = { username: 'system', adminRole: 'system' };

const db = () => getDb();
const now = () => Date.now();
const PICKUPS_LINK = '/seller/orders/pickups';

function loadPickup(id, seller) {
  const pickup = db().prepare('SELECT * FROM pickups WHERE id = ?').get(String(id));
  if (!pickup || (seller && pickup.seller !== seller)) throw new ApiError(404, 'We could not find that pickup request.');
  return pickup;
}

// The order's copy of its pickup, which holds nothing the buyer shouldn't see.
function pickupSummary(id) {
  const row = db().prepare('SELECT * FROM pickups WHERE id = ?').get(id);
  return { id: row.id, status: row.status, method: row.method, scheduledFor: row.scheduled_for, slot: row.slot, courier: row.partner_name, reason: row.review_note };
}

const mirror = (id, event) => {
  const pickup = pickupSummary(id);
  const row = db().prepare('SELECT order_id FROM pickups WHERE id = ?').get(id);
  writeOrder(readOrder(row.order_id), { pickup }, event);
};

function pickupDate(input) {
  const date = Date.parse(input);
  const today = now() - DAY;
  if (!date || date < today) throw new ApiError(422, 'Choose a date from today onwards.', { date: 'Choose a date from today onwards.' });
  if (date > now() + MAX_DAYS_AHEAD * DAY) throw new ApiError(422, `Choose a date within ${MAX_DAYS_AHEAD} days.`, { date: `Choose a date within ${MAX_DAYS_AHEAD} days.` });
  return date;
}

function checkSlot(slot) {
  if (!PICKUP_SLOTS.includes(slot)) throw new ApiError(422, 'Choose a time window.', { slot: 'Choose a time window.' });
  return slot;
}

export function checkPickupRequest(input) {
  const weight = Number(input.weight);
  const parcels = Number(input.parcels);
  const contactName = String(input.contactName || '').trim().slice(0, 100);
  const contactPhone = String(input.contactPhone || '').trim();
  if (!PICKUP_METHODS.includes(input.method)) throw new ApiError(422, 'Choose how the courier gets the parcel.', { method: 'Choose a handover method.' });
  if (!SHIPPING_ZONES.includes(input.area)) throw new ApiError(422, 'Choose your pickup area.', { area: 'Choose your pickup area.' });
  if (!Number.isFinite(weight) || weight <= 0 || weight > 50) throw new ApiError(422, 'Enter a weight of up to 50 kg.', { weight: 'Enter a weight of up to 50 kg.' });
  if (!Number.isInteger(parcels) || parcels < 1 || parcels > 20) throw new ApiError(422, 'Enter 1 to 20 parcels.', { parcels: 'Enter 1 to 20 parcels.' });
  if (!contactName) throw new ApiError(422, 'Enter a contact name.', { contactName: 'Enter a contact name.' });
  if (!/^\+?[0-9][0-9 -]{9,15}$/.test(contactPhone)) throw new ApiError(422, 'Enter a valid contact number.', { contactPhone: 'Enter 10 to 16 digits.' });
  const courier = String(input.courier || '').trim();
  const partner = courier && courier !== 'Let Onetap choose' ? partnerForName(courier, 'seller') : null;
  if (partner && !partner.pickupLocations.includes(input.area)) throw new ApiError(422, `${partner.name} doesn't pick up in ${input.area}.`, { courier: `${partner.name} doesn't pick up in ${input.area}.` });
  const preferred = partner?.name || '';
  return {
    method: input.method, area: input.area, scheduledFor: pickupDate(input.date), slot: checkSlot(input.slot), contactName, contactPhone, preferred,
    parcel: JSON.stringify({ weight, parcels, note: String(input.note || '').trim().slice(0, 200) }),
  };
}

const openRequest = (orderId) => db().prepare("SELECT 1 FROM pickups WHERE order_id = ? AND status IN ('awaiting_payment', 'pending', 'approved', 'scheduled', 'confirmed', 'failed')").get(orderId);

export const pickupReviewRequired = () => db().prepare('SELECT value FROM app_settings WHERE key = ?').get(REVIEW_SETTING)?.value === 'on';

// Turning review off also releases whatever was waiting for an administrator.
export function setPickupReview(admin, on) {
  db().prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(REVIEW_SETTING, on ? 'on' : 'off');
  if (!on) db().prepare("UPDATE pickups SET auto_assign = 1 WHERE status = 'pending'").run();
  audit(admin, 'pickup.review_changed', 'setting', REVIEW_SETTING, { required: Boolean(on) });
}

// Saves the seller's schedule and tells nobody outside Onetap. A second request for the same
// order is refused here and, if two arrive together, by the pickups_one_open index.
export function submitPickupRequest(order, request) {
  const shipment = activeShipment(order.id);
  const waiting = (order.approvedAt && ['unpaid', 'to_ship'].includes(order.status)) || (order.status === 'ready' && shipment?.status === 'booking_confirmed');
  if (!waiting || order.cancel?.status === 'pending' || openRequest(order.id)) throw new ApiError(409, `${order.id} has changed. Check its latest status and try again.`);
  const id = randomUUID();
  const time = now();
  const unpaid = order.payment !== COD && !order.paid;
  return transaction(() => {
    db().prepare(`
      INSERT INTO pickups (id, shipment_id, order_id, seller, shop_name, partner_id, partner_name, address, scheduled_for, status, attempts, method, slot, area, contact_name, contact_phone, parcel, preferred_courier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, shipment?.id || '', order.id, order.seller, order.shopName, shipment?.partner_id || '', shipment?.partner_name || '', shopAddress(order.seller), request.scheduledFor, unpaid ? 'awaiting_payment' : 'pending',
      request.method, request.slot, request.area, request.contactName, request.contactPhone, request.parcel, request.preferred, time, time);
    mirror(id, `${request.method} scheduled by seller${unpaid ? ', waiting for payment' : ''}`);
    audit({ username: order.seller, adminRole: 'seller' }, 'pickup.requested', 'pickup', order.id, { method: request.method, scheduledFor: isoDate(request.scheduledFor) });
    return id;
  });
}

// Orders from before Tuguegarao became the only service area keep their old area on record,
// and are checked as today's area so that they can still be booked.
const servedArea = (area) => (SHIPPING_ZONES.includes(area) ? area : SHIPPING_ZONES[0]);

// Every active courier with whether it can take this parcel, cheapest first.
export function courierOptions(pickup, order) {
  const { weight } = JSON.parse(pickup.parcel);
  const destination = servedArea(order.zone);
  const area = pickup.area && servedArea(pickup.area);
  const declined = JSON.parse(pickup.rejected_by);
  const cod = order.payment === COD;
  const rows = logisticsOptions().map((option) => {
    const partner = loadPartner(option.id);
    const problems = [
      declined.includes(partner.id) && 'Declined this pickup',
      !partner.forSellers && 'Not offered to sellers',
      !partner.zones.includes(destination) && `No service to ${destination}`,
      !partner.deliveryLocations.includes(destination) && `Does not deliver to ${destination}`,
      area && !partner.pickupLocations.includes(area) && `No pickups in ${area}`,
      cod && !partner.services.includes('Cash on Delivery') && 'No Cash on Delivery',
      ['failed', 'not_configured', undefined].includes(loadIntegration(partner.id, partner.environment)?.status) && 'API not connected',
    ].filter(Boolean);
    const fee = shippingEstimates({ weight: weight || 1, destination }, [partner])[0]?.fee ?? null;
    return { id: partner.id, name: partner.name, environment: partner.environment, fee, eligible: !problems.length, problem: problems[0] || '', isDefault: partner.isDefault };
  });
  const usable = rows.filter((row) => row.eligible).sort((a, b) => a.fee - b.fee || b.isDefault - a.isDefault);
  const recommended = usable.find((row) => row.name === pickup.preferred_courier) || usable[0];
  return [...usable, ...rows.filter((row) => !row.eligible)].map(({ isDefault, ...row }) => ({ ...row, recommended: row.id === recommended?.id }));
}

function chooseCourier(pickup, order, choice) {
  const options = courierOptions(pickup, order);
  const option = choice && choice !== 'auto' ? options.find((row) => row.id === choice) : options.find((row) => row.recommended);
  if (!option) throw new ApiError(409, 'No active courier can take this parcel.');
  if (!option.eligible) throw new ApiError(409, `${option.name} cannot take this parcel: ${option.problem}.`);
  return loadPartner(option.id);
}

function checkDispatchable(order) {
  if (!['to_ship', 'ready'].includes(order.status)) throw new ApiError(409, `${order.id} can no longer be shipped.`);
  if (order.cancel?.status === 'pending') throw new ApiError(409, 'The buyer asked to cancel this order. The seller has to answer first.');
}

const inFlight = new Set();

function recordBookingFailure(pickup, err) {
  const retries = pickup.retries + 1;
  const retryAt = err.temporary && retries < MAX_RETRIES ? now() + RETRY_BASE_MS * 2 ** (retries - 1) : null;
  db().prepare('UPDATE pickups SET booking_error = ?, retries = ?, retry_at = ?, updated_at = ? WHERE id = ?').run(err.message, retries, retryAt, now(), pickup.id);
}

async function releaseBooking(partner, orderId, tracking, idempotencyKey) {
  await callCourier(partner, 'cancelBooking', { reference: orderId, tracking, idempotencyKey });
}

// Books the shipment and then the pickup. Both calls reuse their keys, so running this twice
// for one request can't book twice. Returns false when the courier didn't confirm.
async function dispatchPickup(id) {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  let pickup = loadPickup(id);
  try {
    const order = readOrder(pickup.order_id);
    const partner = loadPartner(pickup.partner_id);
    // Also stops the retry timer, because this failure isn't temporary.
    if (partner.status !== 'active') throw new ApiError(409, `${partner.name} has been deactivated. Send this request back to review to choose another courier.`);
    const shipment = await bookShipment(order, partner, pickup.method);
    if (shipment.status === 'cancelled') {
      await releaseBooking(partner, order.id, shipment.tracking, shipment.idempotency_key);
      transaction(() => {
        setShipment(shipment.id, 'cancelled');
        addEvent(shipment.id, 'cancelled', 'courier', 'Order was cancelled during booking');
      });
      return false;
    }
    db().prepare('UPDATE pickups SET shipment_id = ?, booking_ref = ?, updated_at = ? WHERE id = ?').run(shipment.id, shipment.booking_ref, now(), id);
    let result = { pickupRef: shipment.booking_ref };
    if (pickup.method === 'Pickup') {
      result = await callCourier(partner, 'schedulePickup', { reference: order.id, idempotencyKey: `pickup:${id}:${pickup.attempts}`, tracking: shipment.tracking, scheduledFor: pickup.scheduled_for });
    }
    return transaction(() => {
      pickup = loadPickup(id);
      if (pickup.status !== 'approved') return false;
      db().prepare("UPDATE pickups SET status = 'scheduled', booking_ref = ?, booking_error = '', failed_reason = '', retry_at = NULL, updated_at = ? WHERE id = ?").run(result.pickupRef, now(), id);
      setShipment(shipment.id, 'ready_for_pickup');
      addEvent(shipment.id, 'ready_for_pickup', 'courier', pickup.method === 'Pickup' ? `Pickup ${result.pickupRef} scheduled` : 'Seller will drop the parcel off');
      writeOrder(readOrder(order.id), { shipmentStatus: 'ready_for_pickup' });
      mirror(id, pickup.method === 'Pickup' ? `Pickup scheduled with ${partner.name}` : `Ready to drop off at ${partner.name}`);
      notifySeller(order.seller, 'Pickup scheduled', `${partner.name} booked ${order.id}. Tracking number ${shipment.tracking}. Print the waybill and attach it to the parcel.`, `/seller/orders/${order.id}`);
      notifyCourier(partner.id, 'New pickup request', `${order.id} from ${order.shopName}. Approve or reject it.`);
      audit(SYSTEM, 'pickup.scheduled', 'pickup', order.id, { courier: partner.name, tracking: shipment.tracking, bookingRef: result.pickupRef });
      return true;
    });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    recordBookingFailure(loadPickup(id), err);
    audit(SYSTEM, 'pickup.booking_failed', 'pickup', pickup.order_id, { error: err.message });
    return false;
  } finally {
    inFlight.delete(id);
  }
}

export async function approvePickup(admin, id, choice) {
  const pickup = loadPickup(id);
  if (pickup.status !== 'pending') throw new ApiError(409, 'This request has already been reviewed. Refresh and try again.');
  const order = readOrder(pickup.order_id);
  checkDispatchable(order);
  // An order that is already booked keeps its courier.
  const partner = pickup.shipment_id ? loadPartner(pickup.partner_id) : chooseCourier(pickup, order, choice);
  transaction(() => {
    const claimed = db().prepare("UPDATE pickups SET status = 'approved', partner_id = ?, partner_name = ?, reviewed_by = ?, reviewed_at = ?, review_note = '', updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(partner.id, partner.name, admin.username, now(), now(), id);
    if (!claimed.changes) throw new ApiError(409, 'This request has already been reviewed. Refresh and try again.');
    mirror(id, `${partner.name} assigned`);
    notifySeller(order.seller, 'Courier assigned', `${partner.name} was assigned to ${order.id}.`, PICKUPS_LINK);
    audit(admin, 'pickup.approved', 'pickup', order.id, { courier: partner.name, selection: choice && choice !== 'auto' ? 'manual' : 'automatic' });
  });
  await dispatchPickup(id);
  return toPickup(loadPickup(id));
}

export function rejectPickup(admin, id, reason) {
  const text = String(reason || '').trim();
  if (text.length < 10 || text.length > 300) throw new ApiError(422, 'Enter a reason of 10 to 300 characters.', { reason: 'Enter a reason of 10 to 300 characters.' });
  const pickup = loadPickup(id);
  if (pickup.status !== 'pending') throw new ApiError(409, 'This request has already been reviewed. Refresh and try again.');
  transaction(() => {
    db().prepare("UPDATE pickups SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?").run(text, admin.username, now(), now(), id);
    mirror(id, 'Pickup request returned to the seller');
    notifySeller(pickup.seller, 'Pickup request rejected', `${pickup.order_id}: ${text}`, PICKUPS_LINK);
    audit(admin, 'pickup.rejected', 'pickup', pickup.order_id, { reason: text });
  });
}

export async function retryBooking(admin, id) {
  const pickup = loadPickup(id);
  if (pickup.status !== 'approved') throw new ApiError(409, 'This request is not waiting for a booking.');
  audit(admin, 'pickup.booking_retried', 'pickup', pickup.order_id);
  await dispatchPickup(id);
  return toPickup(loadPickup(id));
}

// Sends a scheduled request to a courier. If review is on or no courier can take it, it stays
// pending, and an administrator picks it up in Pickup Approval.
export async function releasePickup(id) {
  const pickup = loadPickup(id);
  if (pickup.status !== 'pending' || pickupReviewRequired()) return;
  try {
    await approvePickup(SYSTEM, id, 'auto');
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    notifySeller(pickup.seller, 'Waiting for a courier', `No courier can take ${pickup.order_id} right now. Onetap will assign one.`, PICKUPS_LINK);
  }
}

// The buyer has paid, so a schedule that was waiting can go ahead. Returns the request to release.
export function pickupPaid(orderId) {
  const row = db().prepare("SELECT id FROM pickups WHERE order_id = ? AND status = 'awaiting_payment'").get(orderId);
  if (!row) return null;
  db().prepare("UPDATE pickups SET status = 'pending', updated_at = ? WHERE id = ?").run(now(), row.id);
  mirror(row.id, 'Payment confirmed. Pickup sent for booking');
  return row.id;
}

// An order cancelled before any booking just closes its request.
export function closeUnbookedPickup(orderId) {
  db().prepare("UPDATE pickups SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status IN ('awaiting_payment', 'pending')").run(now(), orderId);
}

export function queuePickup(orderId) {
  db().prepare("UPDATE pickups SET auto_assign = 1, updated_at = ? WHERE order_id = ? AND status = 'pending'").run(now(), orderId);
}

// Runs on a timer. Temporary courier outages clear without anyone pressing retry, and a pickup
// a courier declined moves on to the next one.
export async function retryDueBookings() {
  const due = db().prepare("SELECT id FROM pickups WHERE status = 'approved' AND retry_at IS NOT NULL AND retry_at <= ?").all(now());
  for (const { id } of due) await dispatchPickup(id);
  const queued = db().prepare("SELECT id FROM pickups WHERE status = 'pending' AND auto_assign = 1").all();
  for (const { id } of queued) {
    db().prepare('UPDATE pickups SET auto_assign = 0 WHERE id = ?').run(id);
    await releasePickup(id);
  }
}

// Puts a request back in review so another courier can be chosen. The old booking is cancelled
// at the courier first, including one whose confirmation never reached us.
export async function returnToReview(admin, id) {
  const pickup = loadPickup(id);
  if (!['approved', 'scheduled', 'failed'].includes(pickup.status)) throw new ApiError(409, 'This pickup can no longer be moved to another courier.');
  const shipment = activeShipment(pickup.order_id);
  if (shipment) await releaseBooking(loadPartner(shipment.partner_id), pickup.order_id, shipment.tracking, shipment.idempotency_key);
  transaction(() => {
    if (shipment) {
      setShipment(shipment.id, 'cancelled');
      addEvent(shipment.id, 'cancelled', 'admin', 'Booking released so another courier can be assigned');
    }
    db().prepare("UPDATE pickups SET status = 'pending', shipment_id = '', partner_id = '', partner_name = '', booking_ref = '', confirmation = '', booking_error = '', retries = 0, retry_at = NULL, attempts = attempts + 1, updated_at = ? WHERE id = ?").run(now(), id);
    const order = readOrder(pickup.order_id);
    writeOrder(order, { status: 'to_ship', courier: '', tracking: '', bookingRef: '', shipmentStatus: '', eta: null, trackingUrl: '' });
    mirror(id, 'Courier booking released, waiting for a new courier');
    notifySeller(pickup.seller, 'Courier being changed', `Onetap is assigning a different courier for ${pickup.order_id}.`, PICKUPS_LINK);
    if (shipment) notifyCourier(shipment.partner_id, 'Pickup reassigned', `${pickup.order_id} moved to another courier. Don't collect this parcel.`);
    audit(admin, 'pickup.returned_to_review', 'pickup', pickup.order_id);
  });
}

// A request still in review just changes. Anything booked goes to the courier first.
async function changeSchedule(actor, pickup, scheduledFor, slot) {
  if (['awaiting_payment', 'pending'].includes(pickup.status)) {
    transaction(() => {
      db().prepare('UPDATE pickups SET scheduled_for = ?, slot = ?, updated_at = ? WHERE id = ?').run(scheduledFor, slot, now(), pickup.id);
      mirror(pickup.id);
      audit(actor, 'pickup.rescheduled', 'pickup', pickup.order_id, { scheduledFor: isoDate(scheduledFor) });
    });
    return;
  }
  const attempts = pickup.attempts + 1;
  const partner = loadPartner(pickup.partner_id);
  const result = pickup.method === 'Pickup'
    ? await callCourier(partner, 'schedulePickup', { reference: pickup.order_id, idempotencyKey: `pickup:${pickup.id}:${attempts}`, tracking: readOrder(pickup.order_id).tracking, scheduledFor })
    : { pickupRef: pickup.booking_ref };
  transaction(() => {
    db().prepare("UPDATE pickups SET status = 'scheduled', scheduled_for = ?, slot = ?, attempts = ?, booking_ref = ?, failed_reason = '', updated_at = ? WHERE id = ?").run(scheduledFor, slot, attempts, result.pickupRef, now(), pickup.id);
    // The courier approves the new date again, then assigns a rider for it.
    closeRiderTasks(pickup.shipment_id, 'pickup', 'cancelled', 'The pickup moved to a new date');
    addEvent(pickup.shipment_id, 'ready_for_pickup', 'courier', `Pickup ${result.pickupRef} rescheduled`);
    mirror(pickup.id, 'Pickup rescheduled');
    notifySeller(pickup.seller, 'Pickup rescheduled', `${pickup.order_id} is now scheduled with ${partner.name}.`, PICKUPS_LINK);
    notifyCourier(partner.id, 'Pickup rescheduled', `${pickup.order_id} has a new pickup date.`);
    audit(actor, 'pickup.rescheduled', 'pickup', pickup.order_id, { scheduledFor: isoDate(scheduledFor) });
  });
}

async function closePickup(actor, pickup, label) {
  const booked = pickup.shipment_id && ['scheduled', 'confirmed', 'failed'].includes(pickup.status);
  if (booked && pickup.method === 'Pickup') {
    await callCourier(loadPartner(pickup.partner_id), 'cancelPickup', { reference: pickup.order_id, pickupRef: pickup.booking_ref, tracking: readOrder(pickup.order_id).tracking });
  }
  transaction(() => {
    db().prepare("UPDATE pickups SET status = 'cancelled', retry_at = NULL, updated_at = ? WHERE id = ?").run(now(), pickup.id);
    if (booked) {
      closeRiderTasks(pickup.shipment_id, 'pickup', 'cancelled', 'The pickup was cancelled');
      setShipment(pickup.shipment_id, 'booking_confirmed');
      addEvent(pickup.shipment_id, 'booking_confirmed', label === 'seller' ? 'seller' : 'admin', `Pickup cancelled by ${label === 'seller' ? 'the seller' : 'an administrator'}`);
      writeOrder(readOrder(pickup.order_id), { shipmentStatus: 'booking_confirmed' });
    }
    mirror(pickup.id, 'Pickup cancelled. Set a new schedule when ready');
    if (booked) notifyCourier(pickup.partner_id, 'Pickup cancelled', `The pickup for ${pickup.order_id} was cancelled.`);
    if (label !== 'seller') notifySeller(pickup.seller, 'Pickup cancelled', `Onetap cancelled the pickup for ${pickup.order_id}. Request it again when ready.`, PICKUPS_LINK);
    audit(actor, 'pickup.cancelled', 'pickup', pickup.order_id);
  });
}

export async function reschedulePickup(admin, id, date, slot) {
  const pickup = loadPickup(id);
  if (ADMIN_CLOSED.includes(pickup.status) || pickup.status === 'approved') throw new ApiError(409, 'This pickup can no longer be changed.');
  await changeSchedule(admin, pickup, pickupDate(date), slot ? checkSlot(slot) : pickup.slot);
}

export async function cancelPickup(admin, id) {
  const pickup = loadPickup(id);
  if (ADMIN_CLOSED.includes(pickup.status)) throw new ApiError(409, 'This pickup can no longer be changed.');
  await closePickup(admin, pickup, 'admin');
}

const sellerActor = (seller) => ({ username: seller, adminRole: 'seller' });

export async function sellerReschedule(seller, id, { date, slot }) {
  const pickup = loadPickup(id, seller);
  if (!SELLER_CHANGEABLE.includes(pickup.status)) throw new ApiError(409, 'This pickup can no longer be rescheduled. Contact Onetap support.');
  await changeSchedule(sellerActor(seller), pickup, pickupDate(date), checkSlot(slot));
}

export async function sellerCancel(seller, id) {
  const pickup = loadPickup(id, seller);
  if (!SELLER_CHANGEABLE.includes(pickup.status)) throw new ApiError(409, 'This pickup can no longer be cancelled. Contact Onetap support.');
  await closePickup(sellerActor(seller), pickup, 'seller');
}

export function pickupDetail(id) {
  const row = loadPickup(id);
  const order = readOrder(row.order_id);
  return {
    ...toPickup(row),
    couriers: row.status === 'pending' && !row.shipment_id ? courierOptions(row, order) : [],
    canApprove: row.status === 'pending',
    order: { total: order.total, payment: order.payment, zone: order.zone, deliverTo: order.buyer.address, items: order.items.map(({ name, qty, variation }) => ({ name, qty, variation })), cancelPending: order.cancel?.status === 'pending' },
  };
}

const PICKUP_LIST = { from: 'pickups', sorts: { scheduled: 'scheduled_for', created: 'created_at', status: 'status', seller: 'shop_name', courier: 'partner_name' }, defaultSort: 'created' };

const counts = (where, values) => Object.fromEntries(db().prepare(`SELECT status, COUNT(*) AS c FROM pickups WHERE ${where} GROUP BY status`).all(...values).map((row) => [row.status, row.c]));

export function listPickups(params, scope = {}) {
  const scoped = [];
  if (scope.seller) scoped.push(['seller = ?', scope.seller]);
  // A courier only ever sees a pickup once its booking is confirmed.
  if (scope.partnerId) scoped.push(['partner_id = ?', scope.partnerId], ["status IN ('scheduled', 'confirmed', 'picked_up', 'failed')"]);
  const where = [
    ...scoped,
    ...search(params, ['order_id', 'shop_name', 'booking_ref', 'seller']),
    ...equals(params, 'status', 'status'),
    ...equals(params, 'partner', 'partner_id'),
    ...dateRange(params, 'scheduled_for'),
  ];
  const { rows, ...page } = listQuery(db(), { ...PICKUP_LIST, where }, params);
  const pickups = rows.map((row) => ({ ...toPickup(row), rider: row.shipment_id ? currentRiders(row.shipment_id).pickup || null : null }));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-pickups.csv', [
      ['Order', (p) => p.orderId], ['Seller', (p) => p.seller], ['Courier', (p) => p.courier], ['Handover', (p) => p.method], ['Status', (p) => p.status], ['Scheduled', (p) => isoDate(p.scheduledFor)], ['Time', (p) => p.slot],
      ['Booking ref', (p) => p.bookingRef], ['Confirmation', (p) => p.confirmation], ['Failed reason', (p) => p.failedReason], ['Contact', (p) => p.contactName], ['Phone', (p) => p.contactPhone], ['Address', (p) => p.address],
    ], pickups);
  }
  const countWhere = scoped.length ? scoped.map(([clause]) => clause).join(' AND ') : '1 = 1';
  return Response.json({ ...page, rows: pickups, counts: counts(countWhere, scoped.flatMap(([, ...args]) => args)), ...(scoped.length ? {} : { reviewRequired: pickupReviewRequired() }) });
}
