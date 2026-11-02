// Onetap's fees, set by administrators in Fee Management.
//
// Admin fee: charged to the seller on every delivered order, as a fixed amount or a percentage of
// the order's product total. It comes out of the seller's proceeds.
// Logistics fee: Onetap's share of the delivery fee the buyer paid, as a fixed amount or a
// percentage of that delivery fee. The courier gets the rest. Sellers are never charged it.
//
// Both are worked out when the courier confirms delivery and saved on the order's collection
// record (collections.js), so a later change never rewrites history. Sellers never see either fee.

import { audit } from './admin';
import { getDb } from './db';
import { ApiError } from './errors';

const KEYS = { admin: 'admin_fee', logistics: 'logistics_fee' };
const TYPES = ['percent', 'fixed'];
const LIMITS = { percent: 50, fixed: 100000 };
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const read = (key) => {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
};

// The admin fee started as a commission percentage, which carries over the first time.
export function currentFees() {
  const legacy = Number(getDb().prepare("SELECT value FROM app_settings WHERE key = 'commission_rate'").get()?.value) || 0;
  return {
    admin: read(KEYS.admin) || { type: 'percent', value: legacy },
    logistics: read(KEYS.logistics) || { type: 'percent', value: 0 },
  };
}

// A fixed fee never takes more than the amount it is charged on.
function apply(fee, base) {
  if (!fee?.value || base <= 0) return 0;
  return money(fee.type === 'fixed' ? Math.min(fee.value, base) : (base * fee.value) / 100);
}

export function feesFor(productTotal, deliveryFee, fees = currentFees()) {
  const adminFee = apply(fees.admin, productTotal);
  const logisticsFee = apply(fees.logistics, deliveryFee);
  return {
    adminFee, logisticsFee, courierShare: money(deliveryFee - logisticsFee), sellerProceeds: money(productTotal - adminFee),
    adminFeeType: fees.admin.type, adminFeeValue: fees.admin.value, logisticsFeeType: fees.logistics.type, logisticsFeeValue: fees.logistics.value,
  };
}

const describe = (fee) => (fee.type === 'fixed' ? `₱${money(fee.value).toLocaleString('en-PH', { minimumFractionDigits: 2 })} per order` : `${fee.value}%`);

function readFee(input, name) {
  const type = TYPES.includes(input?.type) ? input.type : '';
  const value = Number(input?.value);
  if (!type) throw new ApiError(422, 'Check the highlighted fields.', { [`${name}Type`]: 'Choose a fixed amount or a percentage.' });
  if (input?.value === '' || !Number.isFinite(value) || value < 0 || value > LIMITS[type]) {
    throw new ApiError(422, 'Check the highlighted fields.', { [`${name}Value`]: type === 'percent' ? `Enter a percentage from 0 to ${LIMITS.percent}.` : `Enter an amount from ₱0 to ₱${LIMITS.fixed.toLocaleString('en-PH')}.` });
  }
  return { type, value: money(value) };
}

export function setFees(admin, input) {
  const next = { admin: readFee(input?.admin, 'admin'), logistics: readFee(input?.logistics, 'logistics') };
  const previous = currentFees();
  if (JSON.stringify(next) === JSON.stringify(previous)) throw new ApiError(422, 'Nothing has changed yet.');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const save = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    save.run(KEYS.admin, JSON.stringify(next.admin));
    save.run(KEYS.logistics, JSON.stringify(next.logistics));
    audit(admin, 'settings.fees_changed', 'setting', 'fees', { adminFee: { from: describe(previous.admin), to: describe(next.admin) }, logisticsFee: { from: describe(previous.logistics), to: describe(next.logistics) } });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return next;
}

// What Fee Management shows: the settings, what they earned so far, and who changed them.
export function feeOverview() {
  const db = getDb();
  const totals = db.prepare('SELECT COUNT(*) AS orders, COALESCE(SUM(admin_fee), 0) AS admin, COALESCE(SUM(logistics_fee), 0) AS logistics FROM collection_records').get();
  const history = db.prepare("SELECT admin, detail, at FROM admin_audit WHERE action IN ('settings.fees_changed', 'settings.commission_changed') ORDER BY id DESC LIMIT 20").all()
    .map((row) => ({ admin: row.admin, at: row.at, detail: JSON.parse(row.detail || '{}') }));
  return { fees: currentFees(), limits: LIMITS, earned: { orders: totals.orders, adminFees: money(totals.admin), logisticsFees: money(totals.logistics) }, history };
}
