// Riders: registered by a logistics partner in its panel, assigned to pickups and deliveries,
// and signed in to the Rider Panel. A rider belongs to one partner, which always comes from the
// signed-in session, never from the request. Driver's licenses are private files outside the
// public uploads folder, served only to the rider's own partner. A rider holds one task at a
// time. Their status updates go through the same signed Sandbox path as the panel's, and
// riderTasks.js closes tasks however the parcel moves.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { redirect } from 'next/navigation';
import { audit, checkOrigin } from './admin';
import { checkPassword, currentAccount, endSessions, hashPassword, loginAccount } from './auth';
import { loadPartner } from './couriers';
import { courierShipment, ownShipment, reportActions, reportStatus } from './courierPanel';
import { panelAccess } from './courierUsers';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';
import { notifyCourier, notifyCustomer, notifyRider, notifySeller } from './notifications';
import { cashByRider } from './riderCash';
import { OPEN_TASK, taskNotice } from './riderTasks';
import { route } from './route';
import { readOrder, shipmentDetail, transaction, writeOrder } from './shipments';

const LICENSE_DIR = path.join(UPLOAD_DIR, '..', 'documents', 'riders');
const MAX_LICENSE_BYTES = 10 * 1024 * 1024;
const NO_EMAIL = '@rider.onetap.local';
const PAGE_SIZE = 20;
const DAY = 24 * 60 * 60 * 1000;
const REPORT_PERIODS = [7, 30, 90];
const NAME = /^\p{L}[\p{L} .'-]*$/u;
const OPEN = "('assigned', 'accepted')";
const USERNAME = /^[a-z0-9_.]{4,30}$/;

// A rider collects once the courier holds the pickup, and delivers once the parcel is collected.
const PICKUP_SHIPMENT = ['booking_confirmed', 'ready_for_pickup'];
const DELIVERY_SHIPMENT = ['picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'failed_delivery'];
// What a rider may report. Returning a parcel is the seller's and courier's decision, not the rider's.
const RIDER_EVENTS = { pickup: ['picked_up', 'pickup_failed'], delivery: ['in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'out_for_delivery', 'delivered', 'failed_delivery'] };
// A rider confirms the delivery, or reports it failed, only once they are out delivering it.
const AT_DOOR = ['delivered', 'failed_delivery'];

const db = () => getDb();
const now = () => Date.now();
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const fullName = (row) => [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ');
const partnerActor = (account) => ({ username: account.username, adminRole: `courier:${account.partnerId}` });
const riderActor = (rider) => ({ username: rider.username, adminRole: `rider:${rider.partnerId}` });
const taskLabel = (kind) => (kind === 'pickup' ? 'pickup' : 'delivery');

// Philippine mobile numbers, stored as 09XXXXXXXXX.
export function normalizePhone(value) {
  const match = String(value ?? '').replace(/[\s()-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
  return match ? `0${match[1]}` : null;
}

// The type comes from the file's own bytes, because the browser's can be anything.
function licenseType(bytes) {
  const part = (start, end) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (part(1, 4) === 'PNG') return { mime: 'image/png', extension: 'png' };
  if (part(0, 4) === 'RIFF' && part(8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  if (part(0, 5) === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  return null;
}

async function readLicense(file, required) {
  const invalid = (message) => new ApiError(422, 'Check the highlighted fields.', { license: message });
  if (!(file instanceof File) || !file.size) {
    if (required) throw invalid("Upload the rider's driver's license.");
    return null;
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = licenseType(bytes);
  if (!type) throw invalid('Use a JPG, PNG, WebP or PDF file.');
  if (bytes.length > MAX_LICENSE_BYTES) throw invalid('Files must be 10 MB or smaller.');
  return { ...type, bytes, name: text(file.name, 120) || `license.${type.extension}`, hash: createHash('sha256').update(bytes).digest('hex') };
}

function readDetails(form) {
  const errors = {};
  const value = (name) => text(form.get(name), 60);
  const details = { first: value('firstName'), middle: value('middleName'), last: value('lastName'), phone: normalizePhone(form.get('phone')), username: text(form.get('username'), 40).toLowerCase() };
  if (!USERNAME.test(details.username)) errors.username = 'Use 4 to 30 letters, numbers, dots or underscores.';
  const checkName = (field, name, label, optional) => {
    if (!name) {
      if (!optional) errors[field] = `Enter the ${label}.`;
    } else if (!NAME.test(name)) errors[field] = 'Use letters, spaces, dots, hyphens or apostrophes.';
  };
  checkName('firstName', details.first, 'first name');
  checkName('middleName', details.middle, 'middle name', true);
  checkName('lastName', details.last, 'last name');
  if (!details.phone) errors.phone = 'Enter a mobile number, like 0917 123 4567.';
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  return details;
}

// A rider is one person with one account: one username, one mobile number, one license, and one
// name within a partner. Usernames and numbers are unique across all partners.
function checkDuplicates(partnerId, details, license, current = '') {
  const errors = {};
  if (db().prepare('SELECT 1 FROM riders WHERE username = ? AND id <> ?').get(details.username, current)) errors.username = 'That username is already taken.';
  if (db().prepare('SELECT 1 FROM riders WHERE phone = ? AND id <> ?').get(details.phone, current)) errors.phone = 'This contact number is already registered to a rider.';
  if (license && db().prepare('SELECT 1 FROM riders WHERE license_hash = ? AND id <> ?').get(license.hash, current)) errors.license = "This driver's license file is already registered to a rider.";
  const sameName = db().prepare('SELECT 1 FROM riders WHERE partner_id = ? AND id <> ? AND lower(first_name) = lower(?) AND lower(middle_name) = lower(?) AND lower(last_name) = lower(?)')
    .get(partnerId, current, details.first, details.middle, details.last);
  if (sameName) errors.lastName = 'A rider with this name is already registered. Check the list, or add a middle name to tell them apart.';
  if (Object.keys(errors).length) throw new ApiError(409, 'This rider looks already registered.', errors);
}

function storeLicense(license) {
  mkdirSync(LICENSE_DIR, { recursive: true });
  const stored = `${randomUUID()}.${license.extension}`;
  writeFileSync(path.join(LICENSE_DIR, stored), license.bytes);
  return stored;
}

// What the auth tables expect: an inactive rider, or one from before usernames who has no password yet, is disabled.
const profileFor = ({ id, partnerId, name, active, hasLogin }) => JSON.stringify({ riderId: id, partnerId, name, disabled: !active || !hasLogin });

function loadRider(partnerId, id) {
  const row = db().prepare('SELECT * FROM riders WHERE id = ? AND partner_id = ?').get(String(id ?? ''), partnerId);
  if (!row) throw new ApiError(404, 'We could not find that rider.');
  return row;
}

// A rider with several orders shows the furthest along: delivering, then carrying, then collecting.
const TASK_RANK = (task) => (task.kind === 'delivery' && task.status === 'accepted' ? (['ready_for_delivery', 'out_for_delivery'].includes(task.shipment_status) ? 4 : 3) : task.status === 'accepted' ? 2 : 1);

function riderState(row, open, last) {
  if (!row.active) return 'inactive';
  if (open) {
    if (open.status === 'assigned') return 'assigned';
    if (open.kind === 'pickup') return 'picking_up';
    return ['ready_for_delivery', 'out_for_delivery'].includes(open.shipment_status) ? 'delivering' : 'in_transit';
  }
  return last === 'completed' ? 'completed' : 'available';
}

function toRider(row, tasks = [], stats = {}, last, cash = {}) {
  const count = (kind, status) => stats[`${kind}:${status}`] || 0;
  const open = [...tasks].sort((a, b) => TASK_RANK(b) - TASK_RANK(a))[0];
  return {
    id: row.id, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, name: fullName(row), phone: row.phone, username: row.username,
    active: Boolean(row.active), hasLogin: Boolean(row.has_login), status: riderState(row, open, last), available: Boolean(row.active) && !open,
    license: { name: row.license_name, mime: row.license_mime, size: row.license_size },
    current: open ? { id: open.id, kind: open.kind, orderId: open.order_id, shipmentId: open.shipment_id, status: open.status, shipmentStatus: open.shipment_status, assignedAt: open.assigned_at } : null,
    completedPickups: count('pickup', 'completed'), failedPickups: count('pickup', 'failed'), completedDeliveries: count('delivery', 'completed'), failedDeliveries: count('delivery', 'failed'),
    openTasks: tasks.length, pendingPickups: tasks.filter((task) => task.kind === 'pickup').length, cashHeld: cash.held || 0, cashWaiting: cash.waiting || 0, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Every rider of a partner, with their open task, task counts and how their last task ended.
function partnerRiders(partnerId, where = '', ...values) {
  const rows = db().prepare(`SELECT * FROM riders WHERE partner_id = ? ${where} ORDER BY created_at DESC`).all(partnerId, ...values);
  const open = {};
  db().prepare(`SELECT a.*, s.status AS shipment_status FROM rider_assignments a JOIN shipments s ON s.id = a.shipment_id WHERE a.partner_id = ? AND a.status IN ${OPEN}`).all(partnerId).forEach((task) => {
    open[task.rider_id] = [...(open[task.rider_id] || []), task];
  });
  const stats = {};
  db().prepare('SELECT rider_id, kind, status, COUNT(*) AS c FROM rider_assignments WHERE partner_id = ? GROUP BY rider_id, kind, status').all(partnerId).forEach((row) => {
    stats[row.rider_id] = { ...stats[row.rider_id], [`${row.kind}:${row.status}`]: row.c };
  });
  const last = {};
  db().prepare("SELECT rider_id, status FROM rider_assignments WHERE partner_id = ? AND status IN ('completed', 'failed') ORDER BY finished_at").all(partnerId).forEach((row) => {
    last[row.rider_id] = row.status;
  });
  const cash = cashByRider(partnerId);
  return rows.map((row) => toRider(row, open[row.id], stats[row.id], last[row.id], cash[row.id]));
}

export async function createRider(account, form) {
  const details = readDetails(form);
  const license = await readLicense(form.get('license'), true);
  checkNewPassword(form.get('password'), form.get('confirmPassword'));
  checkDuplicates(account.partnerId, details, license);
  // The Rider Panel account is created with the rider, so they can sign in straight away.
  const password = await hashPassword(form.get('password'));
  const stored = storeLicense(license);
  const id = randomUUID();
  const time = now();
  const name = fullName({ first_name: details.first, middle_name: details.middle, last_name: details.last });
  try {
    transaction(() => {
      checkDuplicates(account.partnerId, details, license);
      db().prepare(`
        INSERT INTO riders (id, partner_id, username, phone, email, password, profile, first_name, middle_name, last_name, active, has_login, license_name, license_mime, license_size, license_stored, license_hash, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, account.partnerId, details.username, details.phone, `${id}${NO_EMAIL}`, password, profileFor({ id, partnerId: account.partnerId, name, active: true, hasLogin: true }), details.first, details.middle, details.last,
        license.name, license.mime, license.bytes.length, stored, license.hash, account.username, time, time);
      audit(partnerActor(account), 'rider.created', 'rider', id, { name, username: details.username, phone: details.phone });
    });
  } catch (err) {
    rmSync(path.join(LICENSE_DIR, stored), { force: true });
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'This rider is already registered.');
    throw err;
  }
  return riderDetail(account.partnerId, id);
}

export async function updateRider(account, id, form) {
  const row = loadRider(account.partnerId, id);
  const details = readDetails(form);
  const license = await readLicense(form.get('license'), false);
  checkDuplicates(account.partnerId, details, license, row.id);
  const stored = license ? storeLicense(license) : null;
  const name = fullName({ first_name: details.first, middle_name: details.middle, last_name: details.last });
  try {
    transaction(() => {
      checkDuplicates(account.partnerId, details, license, row.id);
      // The username is the rider's sign-in, so changing it signs them out.
      if (details.username !== row.username) endSessions('rider', row.username);
      db().prepare(`
        UPDATE riders SET username = ?, phone = ?, profile = ?, first_name = ?, middle_name = ?, last_name = ?, license_name = ?, license_mime = ?, license_size = ?, license_stored = ?, license_hash = ?, updated_at = ? WHERE id = ?
      `).run(details.username, details.phone, profileFor({ id: row.id, partnerId: row.partner_id, name, active: row.active, hasLogin: row.has_login }), details.first, details.middle, details.last,
        license?.name || row.license_name, license?.mime || row.license_mime, license?.bytes.length || row.license_size, stored || row.license_stored, license?.hash || row.license_hash, now(), row.id);
      audit(partnerActor(account), 'rider.updated', 'rider', row.id, { name, username: details.username, previousUsername: details.username !== row.username ? row.username : undefined, phone: details.phone, licenseReplaced: Boolean(license) });
    });
  } catch (err) {
    if (stored) rmSync(path.join(LICENSE_DIR, stored), { force: true });
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'Another rider already has these details.');
    throw err;
  }
  return riderDetail(account.partnerId, row.id);
}

export function setRiderActive(account, id, active) {
  transaction(() => {
    const row = loadRider(account.partnerId, id);
    if (!active && db().prepare(`SELECT 1 FROM rider_assignments WHERE rider_id = ? AND status IN ${OPEN}`).get(row.id)) {
      throw new ApiError(409, `${fullName(row)} has a task in progress. Reassign or remove it first.`);
    }
    // Cash must be settled while the rider can still sign in to hand it over.
    const cash = cashByRider(row.partner_id)[row.id];
    if (!active && (cash?.held || cash?.waiting)) {
      throw new ApiError(409, `${fullName(row)} still has COD cash to settle. They hand it over in the Rider Panel and you confirm it under Rider Remittances first.`);
    }
    if (!active) endSessions('rider', row.username);
    db().prepare('UPDATE riders SET active = ?, profile = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, profileFor({ id: row.id, partnerId: row.partner_id, name: fullName(row), active, hasLogin: row.has_login }), now(), row.id);
    audit(partnerActor(account), active ? 'rider.activated' : 'rider.deactivated', 'rider', row.id, { name: fullName(row) });
  });
}

function checkNewPassword(password, confirmPassword) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new ApiError(422, 'Use a password of 12 to 128 characters.', { password: 'Use 12 to 128 characters.' });
  if (password !== confirmPassword) throw new ApiError(422, 'The passwords do not match.', { confirmPassword: 'The passwords do not match.' });
}

// The partner resets a forgotten password, which signs the rider out.
export async function setRiderLogin(account, id, { password, confirmPassword }) {
  loadRider(account.partnerId, id);
  checkNewPassword(password, confirmPassword);
  const hash = await hashPassword(password);
  transaction(() => {
    const row = loadRider(account.partnerId, id);
    endSessions('rider', row.username);
    db().prepare('UPDATE riders SET password = ?, has_login = 1, profile = ?, updated_at = ? WHERE id = ?')
      .run(hash, profileFor({ id: row.id, partnerId: row.partner_id, name: fullName(row), active: row.active, hasLogin: true }), now(), row.id);
    audit(partnerActor(account), row.has_login ? 'rider.password_reset' : 'rider.login_created', 'rider', row.id, { name: fullName(row) });
  });
}

export function riderDetail(partnerId, id) {
  const row = loadRider(partnerId, id);
  const [rider] = partnerRiders(partnerId, 'AND id = ?', row.id);
  const history = db().prepare('SELECT a.*, s.tracking FROM rider_assignments a LEFT JOIN shipments s ON s.id = a.shipment_id WHERE a.rider_id = ? ORDER BY a.assigned_at DESC LIMIT 50').all(row.id).map(toHistory);
  return { ...rider, history };
}

const toHistory = (row) => ({
  id: row.id, orderId: row.order_id, shipmentId: row.shipment_id, tracking: row.tracking || '', kind: row.kind, status: row.status, note: row.note, assignedBy: row.assigned_by,
  assignedAt: row.assigned_at, acceptedAt: row.accepted_at, finishedAt: row.finished_at,
});

export function licenseResponse(partnerId, id) {
  const row = loadRider(partnerId, id);
  return new Response(readFileSync(path.join(LICENSE_DIR, row.license_stored)), {
    headers: {
      'Content-Type': row.license_mime,
      'Content-Disposition': `inline; filename="drivers-license.${row.license_stored.split('.').pop()}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    },
  });
}

const RIDER_FILTERS = ['available', 'assigned', 'picking_up', 'in_transit', 'delivering', 'completed', 'inactive'];

export function listRiders(params, partnerId) {
  const all = partnerRiders(partnerId);
  const q = text(params.get('q'), 60).toLowerCase();
  const status = params.get('status');
  const matches = all.filter((rider) => (!q || rider.name.toLowerCase().includes(q) || rider.username.includes(q) || rider.phone.includes(q.replace(/\D/g, '') || q))
    && (!RIDER_FILTERS.includes(status) || rider.status === status));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-riders.csv', [
      ['Name', (r) => r.name], ['Contact number', (r) => r.phone], ['Status', (r) => r.status], ['Current task', (r) => (r.current ? `${r.current.kind} ${r.current.orderId}` : '')],
      ['Completed pickups', (r) => r.completedPickups], ['Completed deliveries', (r) => r.completedDeliveries], ['Failed deliveries', (r) => r.failedDeliveries], ['Username', (r) => r.username], ['Registered', (r) => isoDate(r.createdAt)],
    ], matches);
  }
  const page = Math.max(1, Number(params.get('page')) || 1);
  const counts = Object.fromEntries(RIDER_FILTERS.map((value) => [value, all.filter((rider) => rider.status === value).length]));
  return Response.json({ rows: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: matches.length, page, pageSize: PAGE_SIZE, counts, metrics: riderMetrics(partnerId, all) });
}

function riderMetrics(partnerId, riders) {
  const tasks = Object.fromEntries(db().prepare('SELECT kind, status, COUNT(*) AS c FROM rider_assignments WHERE partner_id = ? GROUP BY kind, status').all(partnerId).map((row) => [`${row.kind}:${row.status}`, row.c]));
  const pending = db().prepare("SELECT COUNT(*) AS c FROM pickups WHERE partner_id = ? AND status IN ('scheduled', 'confirmed')").get(partnerId).c;
  const unassigned = db().prepare(`SELECT COUNT(*) AS c FROM pickups p WHERE p.partner_id = ? AND p.status IN ('scheduled', 'confirmed') AND p.method = 'Pickup' AND NOT EXISTS (SELECT 1 FROM rider_assignments a WHERE a.shipment_id = p.shipment_id AND a.kind = 'pickup' AND a.status IN ${OPEN})`).get(partnerId).c;
  return {
    total: riders.length,
    available: riders.filter((rider) => rider.available).length,
    assigned: riders.filter((rider) => rider.current).length,
    pendingPickups: pending,
    pickupsWithoutRider: unassigned,
    activeDeliveries: (tasks['delivery:assigned'] || 0) + (tasks['delivery:accepted'] || 0),
    completedDeliveries: tasks['delivery:completed'] || 0,
    failedDeliveries: tasks['delivery:failed'] || 0,
  };
}

// What the partner can do with riders on one shipment. Drop-off parcels need no pickup rider.
// The partner's active riders, for the Received By choice on a delivery.
export const riderChoices = (partnerId) => db().prepare('SELECT * FROM riders WHERE partner_id = ? AND active = 1 ORDER BY first_name, last_name').all(partnerId)
  .map((row) => ({ id: row.id, name: fullName(row), phone: row.phone }));

export function assignmentOptions(detail, partnerId) {
  const pickupStatus = detail.pickup?.status;
  const open = (kind) => detail.riders[kind] && OPEN_TASK.includes(detail.riders[kind].status) ? detail.riders[kind] : null;
  const pickup = PICKUP_SHIPMENT.includes(detail.status) && detail.pickup?.method === 'Pickup' && (pickupStatus === 'confirmed' || (pickupStatus === 'scheduled' && detail.sandbox));
  const delivery = DELIVERY_SHIPMENT.includes(detail.status) && !open('pickup');
  return {
    pickup,
    delivery,
    open: { pickup: open('pickup'), delivery: open('delivery') },
    riders: pickup || delivery ? partnerRiders(partnerId, 'AND active = 1').map(({ id, name, phone, status, openTasks }) => ({ id, name, phone, status, openTasks })) : [],
  };
}

const scheduleText = (pickup) => (pickup ? ` on ${new Date(pickup.scheduledFor).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })}${pickup.slot ? `, ${pickup.slot}` : ''}` : '');

export function assignRider(account, shipmentId, input) {
  const kind = ['pickup', 'delivery'].includes(input.kind) ? input.kind : null;
  if (!kind) throw new ApiError(400, 'Choose a pickup or delivery task.');
  let detail = courierShipment(shipmentId, account.partnerId);
  const options = assignmentOptions(detail, account.partnerId);
  if (!options[kind]) throw new ApiError(409, kind === 'pickup' ? "This pickup can't take a rider right now. Refresh and try again." : "This parcel isn't ready for a delivery rider. Its pickup rider must collect it first.");
  const rider = loadRider(account.partnerId, input.riderId);
  if (!rider.active) throw new ApiError(409, 'Only active riders can be assigned.');
  // Assigning a rider accepts a new pickup, so a rider never goes for a parcel the courier hasn't accepted.
  if (kind === 'pickup' && detail.pickup.status === 'scheduled') {
    reportStatus(ownShipment(shipmentId, account.partnerId), detail, { status: 'pickup_confirmed' }, account.name, partnerActor(account));
    detail = courierShipment(shipmentId, account.partnerId);
  }
  const name = fullName(rider);
  transaction(() => {
    const time = now();
    const previous = db().prepare(`SELECT * FROM rider_assignments WHERE shipment_id = ? AND kind = ? AND status IN ${OPEN}`).get(shipmentId, kind);
    if (previous) {
      db().prepare("UPDATE rider_assignments SET status = 'reassigned', note = 'Given to another rider', finished_at = ?, updated_at = ? WHERE id = ?").run(time, time, previous.id);
      notifyRider(previous.rider_id, 'Task reassigned', `${detail.orderId} was given to another rider. You don't need to go.`);
    }
    db().prepare("INSERT INTO rider_assignments (id, partner_id, rider_id, shipment_id, order_id, kind, status, assigned_by, assigned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?, ?, ?)")
      .run(randomUUID(), account.partnerId, rider.id, shipmentId, detail.orderId, kind, account.name, time, time);
    const order = readOrder(detail.orderId);
    const notice = taskNotice(shipmentId, kind, time);
    if (kind === 'pickup') {
      notifyRider(rider.id, 'New pickup task', `Collect ${detail.orderId} from ${detail.seller}${scheduleText(detail.pickup)}. Open the app to accept it.`, '/rider', notice);
      notifySeller(order.seller, 'Rider assigned', `${name} (${rider.phone}) from ${detail.courier} will collect ${detail.orderId}${scheduleText(detail.pickup)}.`, `/seller/orders/${detail.orderId}`);
      writeOrder(order, {}, previous ? 'Pickup rider changed' : `${detail.courier} assigned a rider to collect the parcel`);
    } else {
      notifyRider(rider.id, 'New delivery task', `Deliver ${detail.orderId} to ${detail.customer}. Open the app to accept it.`, '/rider', notice);
      notifyCustomer(order.customer, 'Delivery rider assigned', `${rider.first_name} from ${detail.courier} will deliver ${detail.orderId}. Contact number ${rider.phone}.`, `/orders/${detail.orderId}`);
      notifySeller(order.seller, 'Delivery rider assigned', `${name} from ${detail.courier} will deliver ${detail.orderId}.`, `/seller/orders/${detail.orderId}`);
      writeOrder(order, {}, previous ? 'Delivery rider changed' : 'Delivery rider assigned');
    }
    audit(partnerActor(account), previous ? 'rider_assignment.reassigned' : 'rider_assignment.created', 'shipment', detail.tracking, { order: detail.orderId, kind, rider: rider.id, previousRider: previous?.rider_id });
  });
}

export function removeRider(account, shipmentId, input) {
  const detail = courierShipment(shipmentId, account.partnerId);
  transaction(() => {
    const task = db().prepare(`SELECT * FROM rider_assignments WHERE shipment_id = ? AND kind = ? AND status IN ${OPEN}`).get(shipmentId, String(input.kind));
    if (!task) throw new ApiError(409, 'No rider has this task now. Refresh and try again.');
    const time = now();
    db().prepare("UPDATE rider_assignments SET status = 'cancelled', note = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(`Removed by ${account.name}`, time, time, task.id);
    notifyRider(task.rider_id, 'Task removed', `${detail.orderId} is no longer yours. You don't need to go.`);
    audit(partnerActor(account), 'rider_assignment.removed', 'shipment', detail.tracking, { order: detail.orderId, kind: task.kind, rider: task.rider_id });
  });
}

const ASSIGNMENT_LIST = {
  select: 'a.*, r.first_name, r.middle_name, r.last_name, r.phone, r.username, s.tracking',
  from: 'rider_assignments a JOIN riders r ON r.id = a.rider_id LEFT JOIN shipments s ON s.id = a.shipment_id',
  sorts: { assigned: 'a.assigned_at', finished: 'a.finished_at', status: 'a.status', rider: 'r.last_name' },
  defaultSort: 'assigned',
};

export function listAssignments(params, partnerId) {
  const where = [
    ['a.partner_id = ?', partnerId],
    ...search(params, ['a.order_id', 'r.first_name', 'r.last_name', 'r.username', 'r.phone', 's.tracking']),
    ...equals(params, 'status', 'a.status'),
    ...equals(params, 'kind', 'a.kind'),
    ...equals(params, 'rider', 'a.rider_id'),
    ...dateRange(params, 'a.assigned_at'),
  ];
  const { rows, ...page } = listQuery(db(), { ...ASSIGNMENT_LIST, where }, params);
  const tasks = rows.map((row) => ({ ...toHistory(row), rider: fullName(row), phone: row.phone }));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-rider-assignments.csv', [
      ['Order', (t) => t.orderId], ['Tracking', (t) => t.tracking], ['Task', (t) => t.kind], ['Rider', (t) => t.rider], ['Contact number', (t) => t.phone], ['Status', (t) => t.status], ['Note', (t) => t.note],
      ['Assigned by', (t) => t.assignedBy], ['Assigned', (t) => isoDate(t.assignedAt)], ['Accepted', (t) => isoDate(t.acceptedAt)], ['Finished', (t) => isoDate(t.finishedAt)],
    ], tasks);
  }
  return Response.json({ ...page, rows: tasks, riders: partnerRiders(partnerId).map(({ id, name }) => ({ id, name })) });
}

const rate = (part, whole) => (whole ? part / whole : null);

export function riderPerformance(params, partnerId) {
  const asked = Number(params.get('days'));
  const days = REPORT_PERIODS.includes(asked) ? asked : 30;
  const since = now() - days * DAY;
  const tasks = db().prepare('SELECT * FROM rider_assignments WHERE partner_id = ? AND assigned_at >= ?').all(partnerId, since);
  const rows = partnerRiders(partnerId).map((rider) => {
    const own = tasks.filter((task) => task.rider_id === rider.id);
    const count = (kind, status) => own.filter((task) => task.kind === kind && task.status === status).length;
    const timed = own.filter((task) => task.kind === 'delivery' && task.status === 'completed' && task.accepted_at);
    const delivered = count('delivery', 'completed');
    const failed = count('delivery', 'failed');
    return {
      id: rider.id, name: rider.name, status: rider.status, tasks: own.length,
      pickups: count('pickup', 'completed'), failedPickups: count('pickup', 'failed'), delivered, failedDeliveries: failed,
      declined: own.filter((task) => task.status === 'declined').length,
      successRate: rate(delivered, delivered + failed),
      averageMinutes: timed.length ? timed.reduce((sum, task) => sum + task.finished_at - task.accepted_at, 0) / timed.length / 60000 : null,
    };
  });
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-rider-performance.csv', [
      ['Rider', (r) => r.name], ['Tasks', (r) => r.tasks], ['Pickups collected', (r) => r.pickups], ['Failed pickups', (r) => r.failedPickups], ['Delivered', (r) => r.delivered],
      ['Failed deliveries', (r) => r.failedDeliveries], ['Declined', (r) => r.declined], ['Delivery success', (r) => (r.successRate === null ? '' : r.successRate.toFixed(3))], ['Average delivery minutes', (r) => (r.averageMinutes === null ? '' : Math.round(r.averageMinutes))],
    ], rows);
  }
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  return Response.json({ days, rows, totals: { tasks: sum('tasks'), pickups: sum('pickups'), failedPickups: sum('failedPickups'), delivered: sum('delivered'), failedDeliveries: sum('failedDeliveries'), successRate: rate(sum('delivered'), sum('delivered') + sum('failedDeliveries')) } });
}

// The Rider Panel. A rider signs in with their username, and only while their partner's panel is open.

export async function currentRider() {
  const account = await currentAccount('rider');
  return account && panelAccess(account.partnerId).open ? account : null;
}

export async function pageRider() {
  const account = await currentRider();
  if (!account) redirect('/rider/login');
  return { ...account, partnerName: loadPartner(account.partnerId).name };
}

export function riderRoute(handler) {
  return route(async (request, context) => {
    if (request.method !== 'GET') checkOrigin(request);
    const account = await currentRider();
    if (!account) throw new ApiError(401, 'Log in to the Rider Panel first.');
    return handler(request, account, context);
  });
}

export const riderLogin = (request, identifier, password) => loginAccount('rider', request, identifier, password, ({ partnerId }) => {
  if (!panelAccess(partnerId).open) throw new ApiError(403, `${loadPartner(partnerId).name} isn't active on Onetap, so the Rider Panel is closed.`);
});

export async function changeRiderPassword(rider, current, next) {
  const row = db().prepare('SELECT * FROM riders WHERE id = ?').get(rider.riderId);
  if (typeof current !== 'string' || !await checkPassword(current, row.password)) throw new ApiError(422, 'Your current password is not right.', { current: 'Your current password is not right.' });
  if (typeof next !== 'string' || next.length < 12 || next.length > 128) throw new ApiError(422, 'Use at least 12 characters.', { next: 'Use at least 12 characters.' });
  db().prepare('UPDATE riders SET password = ?, updated_at = ? WHERE id = ?').run(await hashPassword(next), now(), row.id);
  audit(riderActor(rider), 'rider.password_changed', 'rider', row.id);
}

function riderActions(task, detail) {
  if (task.status === 'assigned') return ['accept', 'decline'];
  if (!detail.sandbox) return [];
  const allowed = reportActions(detail);
  // The three steps before Out for Delivery go in order, each once.
  const steps = Object.fromEntries(detail.dispatchSteps.map((step) => [step.status, step.done]));
  const inOrder = (status) => !(status in steps) || (!steps[status] && DISPATCH_ORDER.slice(0, DISPATCH_ORDER.indexOf(status)).every((before) => steps[before]));
  return RIDER_EVENTS[task.kind].filter((status) => allowed.includes(status) && inOrder(status)
    && (!AT_DOOR.includes(status) || detail.status === 'out_for_delivery'));
}

const DISPATCH_ORDER = ['in_transit', 'at_sorting_facility', 'arrived_delivery_hub'];

const MOVEMENT = ['picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'failed_delivery', 'return_to_sender'];

// The parcel's movements so far, oldest first, and where it is in sorting.
function movement(shipmentId) {
  const updates = db().prepare(`SELECT status, location, at FROM shipment_events WHERE shipment_id = ? AND status IN (${MOVEMENT.map(() => '?').join(', ')}) AND note NOT LIKE 'Ignored:%' ORDER BY id`).all(shipmentId, ...MOVEMENT);
  const latest = (status) => updates.findLast((event) => event.status === status);
  const done = latest('sorting_completed');
  const arrived = latest('at_sorting_facility');
  const sorting = done ? { state: 'sorted', facility: done.location, at: done.at } : arrived ? { state: 'sorting', facility: arrived.location, at: arrived.at } : { state: 'not_yet' };
  return { updates, sorting, lastLocation: updates.at(-1)?.location || '' };
}

// A rider sees what the task needs: the seller for a pickup, and the buyer only while delivering to them.
function taskDetail(task) {
  const detail = shipmentDetail(task.shipment_id);
  const base = {
    id: task.id, riderId: task.rider_id, kind: task.kind, status: task.status, orderId: task.order_id, tracking: detail.tracking, courier: detail.courier, sandbox: detail.sandbox, shipmentStatus: detail.status,
    assignedAt: task.assigned_at, acceptedAt: task.accepted_at, items: detail.items.map(({ name, qty, variation }) => ({ name, qty, variation })), actions: riderActions(task, detail),
    cod: detail.cod, total: detail.total, dispatchSteps: detail.dispatchSteps, ...movement(task.shipment_id),
  };
  if (task.kind === 'pickup') {
    const { pickup } = detail;
    return { ...base, seller: detail.seller, address: pickup?.address || '', contactName: pickup?.contactName || '', contactPhone: pickup?.contactPhone || '', scheduledFor: pickup?.scheduledFor, slot: pickup?.slot || '', method: pickup?.method || '', parcel: pickup?.parcel || {} };
  }
  return { ...base, customer: detail.customer, address: detail.address, phone: detail.phone, pickedUpAt: detail.pickedUpAt, outForDeliveryAt: detail.outForDeliveryAt };
}

// The My Tasks categories, worked out from each shipment's status every time, so they always
// match what the partner, seller, buyer and Onetap see. A rider's orders are the ones they hold a
// task for, the ones they collected while they are still on the move, and the ones they delivered,
// which leave the active tabs for Completed.
const WAITING_PICKUP = ['booking_confirmed', 'ready_for_pickup'];
const MOVING = ['picked_up', 'in_transit', 'at_sorting_facility', 'sorting_completed', 'departed_sorting_facility', 'arrived_delivery_hub', 'ready_for_delivery'];
const BOARD_LIMIT = 50;

function taskBoard(riderId) {
  const rows = db().prepare(`
    SELECT a.id, a.kind, a.status, a.order_id, a.shipment_id, a.assigned_at, a.finished_at, s.status AS shipment_status, s.tracking, s.picked_up_at, s.out_for_delivery_at, s.delivered_at, s.proof, s.data
    FROM rider_assignments a JOIN shipments s ON s.id = a.shipment_id
    WHERE a.rider_id = ? AND a.status IN ('assigned', 'accepted', 'completed') ORDER BY a.assigned_at DESC
  `).all(riderId);
  const board = { forPickup: [], inTransit: [], outForDelivery: [], completed: [] };
  const placed = new Set();
  const place = (category, row, extra = {}) => {
    if (placed.has(row.order_id) || board[category].length >= BOARD_LIMIT) return;
    placed.add(row.order_id);
    const data = JSON.parse(row.data);
    board[category].push({
      taskId: row.id, kind: row.kind, taskStatus: row.status, open: OPEN_TASK.includes(row.status), orderId: row.order_id, tracking: row.tracking, shipmentStatus: row.shipment_status,
      seller: data.shopName, customer: data.buyer.name, cod: data.cod, total: data.total, assignedAt: row.assigned_at, pickedUpAt: row.picked_up_at, outForDeliveryAt: row.out_for_delivery_at, ...extra,
    });
  };
  // Open tasks first, so the order a rider is working on lands in its own category.
  [...rows.filter((row) => OPEN_TASK.includes(row.status)), ...rows.filter((row) => !OPEN_TASK.includes(row.status))].forEach((row) => {
    const open = OPEN_TASK.includes(row.status);
    if (open && row.kind === 'pickup' && WAITING_PICKUP.includes(row.shipment_status)) place('forPickup', row);
    else if (open && row.kind === 'delivery' && ['ready_for_delivery', 'out_for_delivery'].includes(row.shipment_status)) place('outForDelivery', row);
    else if (open && row.kind === 'delivery') place('inTransit', row, movement(row.shipment_id));
    else if (!open && row.kind === 'pickup' && MOVING.includes(row.shipment_status)) place('inTransit', row, movement(row.shipment_id));
    else if (!open && row.kind === 'delivery' && row.shipment_status === 'delivered') {
      // Completed means the courier's delivery report was applied with proof attached.
      const proof = row.proof ? JSON.parse(row.proof) : null;
      if (proof) place('completed', row, { deliveredAt: row.delivered_at, receiver: proof.receiver, relationship: proof.relationship, receivedBy: proof.receivedBy?.name || '', photo: proof.photo || '', photos: proof.photos || [] });
    }
  });
  return board;
}

export function riderHome(rider) {
  const open = db().prepare(`SELECT * FROM rider_assignments WHERE rider_id = ? AND status IN ${OPEN} ORDER BY assigned_at`).all(rider.riderId);
  const row = db().prepare('SELECT * FROM riders WHERE id = ?').get(rider.riderId);
  const [me] = partnerRiders(rider.partnerId, 'AND id = ?', rider.riderId);
  return {
    rider: { name: fullName(row), phone: row.phone, username: row.username, partner: loadPartner(rider.partnerId).name, status: me.status, completedPickups: me.completedPickups, completedDeliveries: me.completedDeliveries },
    tasks: open.map(taskDetail),
    board: taskBoard(rider.riderId),
  };
}

// Task History in the Rider Panel's header: the rider's finished tasks, newest first, with the
// parcel's current status and the cash they took for each COD delivery. Read from the same
// rider_assignments, shipments and cod_records rows the partner, seller and Onetap read.
// Every finished task is reachable: the dropdown asks for more `limit` at a time.
const HISTORY_STEP = 25;

export function riderHistory(rider, params) {
  const limit = Math.min(Math.max(Number(params.get('limit')) || HISTORY_STEP, 1), 5000);
  const rows = db().prepare(`
    SELECT a.*, s.tracking, s.status AS shipment_status, s.data, c.collected AS cod_collected, c.rider_id AS cod_rider
    FROM rider_assignments a LEFT JOIN shipments s ON s.id = a.shipment_id LEFT JOIN cod_records c ON c.order_id = a.order_id
    WHERE a.rider_id = ? AND a.status NOT IN ${OPEN} ORDER BY COALESCE(a.finished_at, a.assigned_at) DESC, a.rowid DESC LIMIT ?
  `).all(rider.riderId, limit + 1);
  const [me] = partnerRiders(rider.partnerId, 'AND id = ?', rider.riderId);
  return {
    completedPickups: me.completedPickups,
    completedDeliveries: me.completedDeliveries,
    step: HISTORY_STEP,
    more: rows.length > limit,
    rows: rows.slice(0, limit).map((row) => {
      const data = row.data ? JSON.parse(row.data) : {};
      const took = row.kind === 'delivery' && row.status === 'completed' && data.cod && row.cod_rider === rider.riderId;
      return { ...toHistory(row), customer: data.buyer?.name || '', seller: data.shopName || '', shipmentStatus: row.shipment_status || '', cod: Boolean(data.cod), total: data.total || 0, collected: took ? row.cod_collected : null };
    }),
  };
}

const NEEDS_REASON = 3;

export function riderTaskAction(rider, id, input) {
  const task = db().prepare(`SELECT * FROM rider_assignments WHERE id = ? AND rider_id = ? AND status IN ${OPEN}`).get(String(id), rider.riderId);
  if (!task) throw new ApiError(409, 'This task has changed. Refresh to see your latest task.');
  const name = rider.name;
  const label = taskLabel(task.kind);
  const shipmentsLink = task.kind === 'pickup' ? '/courier/pickups' : '/courier/shipments';
  if (input.action === 'accept') {
    return transaction(() => {
      const changed = db().prepare("UPDATE rider_assignments SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'assigned'").run(now(), now(), task.id).changes;
      if (!changed) throw new ApiError(409, 'This task has changed. Refresh to see your latest task.');
      notifyCourier(rider.partnerId, 'Rider accepted', `${name} accepted the ${label} for ${task.order_id}.`, shipmentsLink);
      const order = readOrder(task.order_id);
      if (task.kind === 'pickup') notifySeller(order.seller, 'Rider on the way', `${name} confirmed the pickup for ${task.order_id}.`, `/seller/orders/${task.order_id}`);
      audit(riderActor(rider), 'rider_assignment.accepted', 'order', task.order_id, { kind: task.kind });
      return { status: 'accepted' };
    });
  }
  if (input.action === 'decline') {
    const reason = text(input.reason, 200);
    if (reason.length < NEEDS_REASON) throw new ApiError(422, 'Enter the reason.', { reason: 'Enter the reason.' });
    return transaction(() => {
      const changed = db().prepare("UPDATE rider_assignments SET status = 'declined', note = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'assigned'").run(reason, now(), now(), task.id).changes;
      if (!changed) throw new ApiError(409, 'You already accepted this task. Contact your dispatcher to hand it over.');
      notifyCourier(rider.partnerId, 'Rider declined', `${name} declined the ${label} for ${task.order_id}: ${reason}. Assign another rider.`, shipmentsLink);
      audit(riderActor(rider), 'rider_assignment.declined', 'order', task.order_id, { kind: task.kind, reason });
      return { status: 'declined' };
    });
  }
  if (input.action === 'report') {
    if (task.status !== 'accepted') throw new ApiError(409, 'Accept the task first.');
    const detail = shipmentDetail(task.shipment_id);
    const row = db().prepare('SELECT * FROM shipments WHERE id = ?').get(task.shipment_id);
    if (!riderActions(task, detail).includes(input.status)) throw new ApiError(409, 'This shipment has changed. Refresh and try again.');
    // Every rider update says where it happened.
    if (text(input.location, 100).length < 2) throw new ApiError(422, 'Enter where you are.', { location: 'Enter where you are.' });
    // A rider's delivery needs a photo they took themselves.
    const { phone } = db().prepare('SELECT phone FROM riders WHERE id = ?').get(rider.riderId);
    return reportStatus(row, { ...detail, actions: riderActions(task, detail) }, input, `rider ${name}`, riderActor(rider), undefined, { requirePhoto: true, deliveredBy: `${name}, ${phone}`, riderId: rider.riderId });
  }
  throw new ApiError(400, 'Unknown action.');
}
