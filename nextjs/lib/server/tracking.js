// The shipping tracking history sellers and buyers see: eleven milestones in order, each with when
// and where it happened. It is read from the order, its pickup, its rider and the courier's
// verified shipment events each time, so it never holds a copy that can drift.

import { getDb } from './db';

const MILESTONES = [
  ['order_confirmed', 'Order Confirmed'],
  ['pickup_scheduled', 'Pickup Scheduled'],
  ['rider_assigned', 'Rider Assigned'],
  ['picked_up', 'Confirmed Collected'],
  ['in_transit', 'In Transit'],
  ['at_sorting_facility', 'Arrived at Sorting Facility'],
  ['sorting_completed', 'Sorting Completed'],
  ['departed_sorting_facility', 'Departed Sorting Facility'],
  ['arrived_delivery_hub', 'Arrived at Delivery Hub'],
  ['out_for_delivery', 'Out for Delivery'],
  ['delivered', 'Delivered'],
];

// Setbacks shown alongside the milestones.
const EXCEPTIONS = { pickup_failed: 'Pickup Failed', failed_delivery: 'Delivery Failed', return_to_sender: 'Returning to Seller' };

const dateText = (ms) => new Date(ms).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

// Buyers see where and when. Sellers also see the courier's notes and the rider's name.
export function trackingFor(order, audience) {
  const db = getDb();
  const shipment = db.prepare("SELECT id FROM shipments WHERE order_id = ? AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1").get(order.id);
  const events = shipment ? db.prepare("SELECT status, note, location, at FROM shipment_events WHERE shipment_id = ? AND note NOT LIKE 'Ignored:%' ORDER BY id").all(shipment.id) : [];
  const pickup = db.prepare("SELECT method, scheduled_for, slot, created_at FROM pickups WHERE order_id = ? AND status NOT IN ('cancelled', 'rejected') ORDER BY created_at DESC LIMIT 1").get(order.id);
  const rider = shipment && db.prepare("SELECT a.assigned_at, r.first_name, r.middle_name, r.last_name FROM rider_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.shipment_id = ? AND a.kind = 'pickup' AND a.status IN ('assigned', 'accepted', 'completed', 'failed') ORDER BY a.assigned_at DESC LIMIT 1").get(shipment.id);
  const seller = audience === 'seller';
  const found = {};
  if (order.approvedAt) found.order_confirmed = { at: Date.parse(order.approvedAt) };
  if (pickup) found.pickup_scheduled = { at: pickup.created_at, note: pickup.method === 'Pickup' ? `For ${dateText(pickup.scheduled_for)}${pickup.slot ? `, ${pickup.slot}` : ''}` : 'Seller drops the parcel off at the courier' };
  if (rider) found.rider_assigned = { at: rider.assigned_at, note: seller ? [rider.first_name, rider.middle_name, rider.last_name].filter(Boolean).join(' ') : '' };
  events.forEach((event) => {
    if (!found[event.status]) found[event.status] = { at: event.at, location: event.location, note: seller ? event.note : '' };
  });
  return {
    milestones: MILESTONES.map(([key, label]) => ({ key, label, done: Boolean(found[key]), at: found[key]?.at || null, location: found[key]?.location || '', note: found[key]?.note || '' })),
    exceptions: events.filter((event) => EXCEPTIONS[event.status]).map((event) => ({ label: EXCEPTIONS[event.status], at: event.at, location: event.location, note: event.note })),
  };
}
