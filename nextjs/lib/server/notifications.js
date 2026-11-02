// In-app notices for sellers, customers, courier partners and their riders.

import { getDb } from './db';

export function notifySeller(seller, title, body, link) {
  getDb().prepare('INSERT INTO seller_notifications (seller, title, body, link, at) VALUES (?, ?, ?, ?, ?)').run(seller, title, body, link, Date.now());
}

export function listNotifications(seller) {
  return getDb().prepare('SELECT * FROM seller_notifications WHERE seller = ? ORDER BY id DESC LIMIT 30').all(seller)
    .map(({ id, title, body, link, read, at }) => ({ id, title, body, link, read: Boolean(read), at }));
}

export function markNotificationsRead(seller) {
  getDb().prepare('UPDATE seller_notifications SET read = 1 WHERE seller = ?').run(seller);
}

export function notifyCourier(partnerId, title, body, link = '/courier/pickups') {
  getDb().prepare('INSERT INTO courier_notifications (partner_id, title, body, link, at) VALUES (?, ?, ?, ?, ?)').run(partnerId, title, body, link, Date.now());
}

export function listCourierNotifications(partnerId) {
  return getDb().prepare('SELECT * FROM courier_notifications WHERE partner_id = ? ORDER BY id DESC LIMIT 30').all(partnerId)
    .map(({ id, title, body, link, read, at }) => ({ id, title, body, link, read: Boolean(read), at }));
}

export function markCourierNotificationsRead(partnerId) {
  getDb().prepare('UPDATE courier_notifications SET read = 1 WHERE partner_id = ?').run(partnerId);
}

// `details` is set for a new task: the order, its customer, where to collect it and when it was assigned.
export function notifyRider(riderId, title, body, link = '/rider', details = null) {
  getDb().prepare('INSERT INTO rider_notifications (rider_id, title, body, link, details, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(riderId, title, body, link, details ? JSON.stringify(details) : '', Date.now());
}

export function listRiderNotifications(riderId) {
  return getDb().prepare('SELECT * FROM rider_notifications WHERE rider_id = ? ORDER BY id DESC LIMIT 30').all(riderId)
    .map(({ id, title, body, link, read, details, at }) => ({ id, title, body, link, read: Boolean(read), details: details ? JSON.parse(details) : null, at }));
}

// One notice when `id` is given, otherwise all of them.
export function markRiderNotificationsRead(riderId, id) {
  if (id) getDb().prepare('UPDATE rider_notifications SET read = 1 WHERE rider_id = ? AND id = ?').run(riderId, Number(id));
  else getDb().prepare('UPDATE rider_notifications SET read = 1 WHERE rider_id = ?').run(riderId);
}

export function notifyCustomer(customer, title, body, link) {
  getDb().prepare('INSERT INTO customer_notifications (customer, title, body, link, at) VALUES (?, ?, ?, ?, ?)').run(customer, title, body, link, Date.now());
}

export function listCustomerNotifications(customer) {
  return getDb().prepare('SELECT * FROM customer_notifications WHERE customer = ? ORDER BY id DESC LIMIT 30').all(customer)
    .map(({ id, title, body, link, read, at }) => ({ id, title, body, link, read: Boolean(read), at }));
}

export function markCustomerNotificationsRead(customer) {
  getDb().prepare('UPDATE customer_notifications SET read = 1 WHERE customer = ?').run(customer);
}
