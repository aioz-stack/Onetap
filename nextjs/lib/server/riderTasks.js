// Rider tasks follow the shipment. Whatever moves a parcel (its rider, the partner's staff, an
// administrator in Sandbox or a courier's API), the matching task closes in the same
// transaction, so a rider is never left holding a task for a parcel that has moved on.
// This file only reads and writes rider tables, so shipments.js and pickups.js can use it.

import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { notifyRider } from './notifications';

export const OPEN_TASK = ['assigned', 'accepted'];
const OPEN = "('assigned', 'accepted')";

// The task a shipment status ends, and how it ends.
const OUTCOMES = {
  picked_up: ['pickup', 'completed'],
  pickup_failed: ['pickup', 'failed'],
  delivered: ['delivery', 'completed'],
  failed_delivery: ['delivery', 'failed'],
  return_to_sender: ['delivery', 'cancelled', 'The parcel is going back to the seller'],
};

const db = () => getDb();

// What a new task's notification shows: the order, its customer, where to collect it and when it
// was assigned. Buyers' contact details and address only go to the rider delivering to them.
export function taskNotice(shipmentId, kind, assignedAt) {
  const shipment = db().prepare('SELECT order_id, data FROM shipments WHERE id = ?').get(shipmentId);
  const data = JSON.parse(shipment.data);
  const pickup = db().prepare('SELECT address FROM pickups WHERE shipment_id = ? ORDER BY created_at DESC').get(shipmentId);
  const delivery = kind === 'delivery';
  return {
    orderId: shipment.order_id, kind, assignedAt, seller: data.shopName, customer: data.buyer.name, customerPhone: delivery ? data.buyer.phone : '',
    pickupLocation: pickup?.address || '', deliveryAddress: delivery ? data.buyer.address : '', cod: Boolean(data.cod), total: data.total,
  };
}

// Closes a shipment's open tasks, of one kind or all. Riders hear about a task taken away from them.
export function closeRiderTasks(shipmentId, kind, status, note = '') {
  const time = Date.now();
  const open = db().prepare(`SELECT * FROM rider_assignments WHERE shipment_id = ? AND status IN ${OPEN}${kind ? ' AND kind = ?' : ''}`).all(shipmentId, ...(kind ? [kind] : []));
  open.forEach((task) => {
    db().prepare('UPDATE rider_assignments SET status = ?, note = ?, finished_at = ?, updated_at = ? WHERE id = ?').run(status, note, time, time, task.id);
    if (status === 'cancelled') notifyRider(task.rider_id, 'Task cancelled', `${task.order_id}: ${note || 'This task was cancelled'}. You don't need to go.`);
  });
  return open;
}

// Called for every shipment and pickup status that is applied.
export function riderTasksFollow(shipmentId, status) {
  if (status === 'cancelled') return closeRiderTasks(shipmentId, null, 'cancelled', 'The courier booking was cancelled');
  const [kind, outcome, note] = OUTCOMES[status] || [];
  const closed = kind ? closeRiderTasks(shipmentId, kind, outcome, note) : [];
  // The rider who collects a parcel carries it on to the buyer, unless the partner gives the
  // delivery to someone else, which reassigns this task.
  if (status === 'picked_up') {
    closed.forEach((task) => {
      if (db().prepare(`SELECT 1 FROM rider_assignments WHERE shipment_id = ? AND kind = 'delivery' AND status IN ${OPEN}`).get(shipmentId)) return;
      const time = Date.now();
      db().prepare("INSERT INTO rider_assignments (id, partner_id, rider_id, shipment_id, order_id, kind, status, note, assigned_by, assigned_at, accepted_at, updated_at) VALUES (?, ?, ?, ?, ?, 'delivery', 'accepted', 'Carried on from collection', 'Onetap', ?, ?, ?)")
        .run(randomUUID(), task.partner_id, task.rider_id, shipmentId, task.order_id, time, time, time);
      const notice = taskNotice(shipmentId, 'delivery', time);
      notifyRider(task.rider_id, 'New delivery task', `Deliver ${task.order_id} to ${notice.customer}. You collected it, so it's already yours.`, '/rider', notice);
    });
  }
  // The delivery rider takes the cash for a COD parcel, and owes it to their courier.
  if (status === 'delivered' && closed.length) db().prepare('UPDATE cod_records SET rider_id = ? WHERE order_id = ?').run(closed[0].rider_id, closed[0].order_id);
  return closed;
}

const riderName = (row) => [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ');

function taskRows(where, ...values) {
  return db().prepare(`
    SELECT a.*, r.first_name, r.middle_name, r.last_name, r.phone FROM rider_assignments a
    JOIN riders r ON r.id = a.rider_id WHERE ${where} ORDER BY a.assigned_at, a.rowid
  `).all(...values);
}

const toTask = (row) => ({
  id: row.id, kind: row.kind, status: row.status, note: row.note, riderId: row.rider_id, rider: riderName(row), phone: row.phone, assignedBy: row.assigned_by,
  assignedAt: row.assigned_at, acceptedAt: row.accepted_at, finishedAt: row.finished_at,
});

export const shipmentTasks = (shipmentId) => taskRows('a.shipment_id = ?', shipmentId).map(toTask).reverse();

// Each part of the job shows its latest task, unless that task was taken back or turned down.
const SHOWN = ['assigned', 'accepted', 'completed', 'failed'];

function latest(rows, toValue) {
  const last = {};
  rows.forEach((row) => {
    last[row.kind] = row;
  });
  return Object.fromEntries(Object.entries(last).filter(([, row]) => SHOWN.includes(row.status)).map(([kind, row]) => [kind, toValue(row)]));
}

// The rider who has, or last had, each part of the job, for the shipment's courier.
export const currentRiders = (shipmentId) => latest(taskRows('a.shipment_id = ?', shipmentId), toTask);

// For an order's seller and buyer. Buyers only see who is delivering to them.
export function orderRiders(orderId, audience) {
  const rows = taskRows("a.order_id = ? AND a.shipment_id IN (SELECT id FROM shipments WHERE order_id = ? AND status <> 'cancelled')", orderId, orderId);
  const riders = latest(rows, (row) => ({ name: riderName(row), phone: row.phone, status: row.status }));
  if (audience === 'customer') return riders.delivery ? { delivery: riders.delivery } : {};
  return riders;
}
