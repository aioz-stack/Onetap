// The numbers beside each panel's sidebar sections: work waiting for someone, worked out from the
// same records the pages show, so a count drops as soon as the work is done. Keys are the sections'
// paths. A section with nothing waiting is left out. Unread notifications have their own count on
// each panel's bell.

import { can } from '../adminRoles';
import { applicationCounts } from './applications';
import { customerApprovalCounts } from './customerApprovals';
import { getDb } from './db';
import { flaggedListings } from './moderation';

const db = () => getDb();
const count = (sql, ...args) => db().prepare(sql).get(...args).c;
const OPEN_TASK = "('assigned', 'accepted')";

function only(counts) {
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
}

// Admin Console, limited to the sections the administrator's role can open.
export function adminNavCounts(admin) {
  const now = Date.now();
  const counts = {};
  if (can(admin, 'pickups')) counts['/admin/pickups'] = count("SELECT COUNT(*) AS c FROM pickups WHERE status = 'pending' OR status = 'failed' OR (status = 'approved' AND booking_error <> '')");
  if (can(admin, 'shipments')) counts['/admin/shipments'] = count("SELECT COUNT(*) AS c FROM shipments WHERE status = 'failed_delivery' OR (status = 'pending' AND last_error <> '') OR investigating = 1");
  if (can(admin, 'cod')) {
    counts['/admin/cod'] = count("SELECT COUNT(*) AS c FROM cod_records WHERE status = 'collected' AND due_at < ?", now);
    counts['/admin/payouts'] = count("SELECT COUNT(*) AS c FROM seller_payouts WHERE status IN ('pending', 'processing')");
    counts['/admin/payout-accounts'] = count("SELECT COUNT(*) AS c FROM seller_payout_accounts WHERE status = 'pending' AND deleted_at IS NULL");
  }
  if (can(admin, 'api')) counts['/admin/api'] = count("SELECT COUNT(*) AS c FROM api_logs WHERE outcome = 'failed' AND at >= ?", now - 24 * 60 * 60 * 1000);
  if (can(admin, 'sellers')) counts['/admin/sellers'] = applicationCounts().pending;
  if (can(admin, 'customers')) counts['/admin/customers'] = customerApprovalCounts().pending;
  if (can(admin, 'products')) counts['/admin/products'] = flaggedListings();
  return only(counts);
}

// Logistics Partner Panel, for the signed-in user's partner only.
export function courierNavCounts(partnerId) {
  const now = Date.now();
  return only({
    // Booked pickups the partner hasn't accepted yet (they show as Pending).
    '/courier/pickups': count("SELECT COUNT(*) AS c FROM pickups WHERE partner_id = ? AND status = 'scheduled'", partnerId),
    '/courier/shipments': count("SELECT COUNT(*) AS c FROM shipments WHERE partner_id = ? AND status = 'failed_delivery'", partnerId),
    // Pickups the partner accepted that no rider has, and declined tasks to hand to someone else.
    '/courier/riders': count(`SELECT COUNT(*) AS c FROM pickups p WHERE p.partner_id = ? AND p.status IN ('scheduled', 'confirmed') AND p.method = 'Pickup'
      AND NOT EXISTS (SELECT 1 FROM rider_assignments a WHERE a.shipment_id = p.shipment_id AND a.kind = 'pickup' AND a.status IN ${OPEN_TASK})`, partnerId),
    '/courier/cod': count("SELECT COUNT(*) AS c FROM cod_records WHERE partner_id = ? AND status = 'collected' AND due_at < ?", partnerId, now),
    '/courier/finance/remittances/riders': count("SELECT COUNT(*) AS c FROM rider_remittances WHERE partner_id = ? AND status = 'submitted'", partnerId),
  });
}

// Rider Panel, for the signed-in rider only.
export function riderNavCounts(riderId) {
  const waiting = count("SELECT COUNT(*) AS c FROM rider_remittances WHERE rider_id = ? AND status = 'submitted'", riderId);
  return only({
    // New tasks to accept or decline. Orders already accepted are on My Tasks itself.
    '/rider': count("SELECT COUNT(*) AS c FROM rider_assignments WHERE rider_id = ? AND status = 'assigned'", riderId),
    // COD parcels whose cash they still hold, unless a handover is already waiting.
    '/rider/remittances': waiting ? 0 : count("SELECT COUNT(*) AS c FROM cod_records WHERE rider_id = ? AND status IN ('collected', 'remitted') AND rider_remittance_id = ''", riderId),
  });
}
