// Small lookups shared by shipments and orders.

import { formatAddress } from '../address';
import { getDb } from './db';

export function shopAddress(seller) {
  const row = getDb().prepare('SELECT profile FROM sellers WHERE username = ?').get(seller);
  if (!row) return '';
  return formatAddress(JSON.parse(row.profile));
}

export function reviewFailure(order, reason, at) {
  return { reason: reason || 'Reason not given', attempts: (order.failed?.attempts || 0) + 1, status: 'pending', at: new Date(at).toISOString() };
}
