// Small lookups shared by shipments and orders.

import { getDb } from './db';

export function shopAddress(seller) {
  const row = getDb().prepare('SELECT profile FROM sellers WHERE username = ?').get(seller);
  if (!row) return '';
  const { street, barangay, city, province, zip } = JSON.parse(row.profile);
  return [street, barangay, city, province, zip].filter(Boolean).join(', ');
}

export function reviewFailure(order, reason, at) {
  return { reason: reason || 'Reason not given', attempts: (order.failed?.attempts || 0) + 1, status: 'pending', at: new Date(at).toISOString() };
}
