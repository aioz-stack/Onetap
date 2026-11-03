// Financial records for delivered orders, written once when the courier confirms delivery. Each
// keeps the parts apart: the seller's proceeds, Onetap's admin fee (from the seller), the delivery
// fee the buyer paid, split into Onetap's logistics fee and the courier's share. Only the admin and
// logistics fees are Onetap's. Both fees come from Fee Management (fees.js) at that moment. Prepaid
// orders are reconciled against their payment record, and COD orders against what the rider
// collected and where that cash is now.

import { getDb } from './db';
import { feesFor } from './fees';
import { csvResponse, dateRange, equals, isoDate, listQuery, search } from './lists';

const COD = 'Cash on Delivery';

const db = () => getDb();
const money = (value) => Math.round(value * 100) / 100;

// Called inside the delivery's transaction, after any COD collection is recorded. The order's
// ID is the key, so a repeated delivery report can never record it twice.
export function recordCollection(order, shipment, at) {
  const productTotal = money(order.subtotal ?? order.items.reduce((sum, item) => sum + item.price * item.qty, 0));
  const riderFee = money(order.shippingFee || 0);
  // The seller's and partner's own rates if they have them (fees.js), as they stand right now.
  const fees = feesFor(productTotal, riderFee, { seller: order.seller, partnerId: shipment.partner_id });
  const cod = order.payment === COD;
  const collected = cod
    ? db().prepare('SELECT collected FROM cod_records WHERE order_id = ?').get(order.id)?.collected ?? order.total
    : order.paidAmount ?? 0;
  const rider = db().prepare("SELECT rider_id FROM rider_assignments WHERE shipment_id = ? AND kind = 'delivery' AND status = 'completed' ORDER BY finished_at DESC LIMIT 1").get(shipment.id);
  db().prepare(`
    INSERT OR IGNORE INTO collection_records (order_id, seller, shop_name, customer, customer_name, partner_id, partner_name, rider_id, payment_method, product_total, rider_fee, commission_rate, admin_fee, seller_proceeds, total, collected, payment_reference, collected_at, created_at,
      admin_fee_type, admin_fee_value, logistics_fee, logistics_fee_type, logistics_fee_value, courier_share, admin_fee_source, logistics_fee_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(order.id, order.seller, order.shopName, order.customer, order.buyer.name, shipment.partner_id, shipment.partner_name, rider?.rider_id || '', order.payment,
    productTotal, riderFee, fees.adminFeeType === 'percent' ? fees.adminFeeValue : 0, fees.adminFee, fees.sellerProceeds, money(order.total), money(collected), cod ? '' : order.paymentReference || '', at, Date.now(),
    fees.adminFeeType, fees.adminFeeValue, fees.logisticsFee, fees.logisticsFeeType, fees.logisticsFeeValue, fees.courierShare, fees.adminFeeSource, fees.logisticsFeeSource);
}

// Delivered orders from before this existed, recorded with today's commission rate.
export function backfill() {
  const missing = db().prepare(`
    SELECT o.data, s.id, s.partner_id, s.partner_name, s.delivered_at FROM orders o JOIN shipments s ON s.order_id = o.id AND s.status = 'delivered'
    WHERE NOT EXISTS (SELECT 1 FROM collection_records c WHERE c.order_id = o.id)
  `).all();
  missing.forEach((row) => recordCollection(JSON.parse(row.data), row, row.delivered_at || Date.now()));
}

// Where the money is: prepaid against its payment record, COD along the rider and courier chain.
const STATUS = `CASE
  WHEN cr.payment_method <> '${COD}' THEN (CASE WHEN cr.payment_reference <> '' THEN 'paid_online' ELSE 'payment_unverified' END)
  WHEN c.status = 'remitted' THEN 'remitted'
  WHEN c.rider_id <> '' AND c.rider_remittance_id = '' THEN 'with_rider'
  WHEN c.rider_id <> '' AND rr.status = 'submitted' THEN 'handed_over'
  ELSE 'with_courier' END`;

const COLLECTION_LIST = {
  select: `cr.*, r.first_name, r.middle_name, r.last_name, c.collected AS cod_collected, ${STATUS} AS collection_status`,
  from: 'collection_records cr LEFT JOIN cod_records c ON c.order_id = cr.order_id LEFT JOIN rider_remittances rr ON rr.id = c.rider_remittance_id LEFT JOIN riders r ON r.id = cr.rider_id',
  sorts: { collected: 'cr.collected_at', total: 'cr.total', seller: 'cr.shop_name' },
  defaultSort: 'collected',
};

const toCollection = (row) => ({
  orderId: row.order_id, seller: row.shop_name, customer: row.customer_name, courier: row.partner_name, rider: row.first_name ? [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') : '',
  paymentMethod: row.payment_method, productTotal: row.product_total, riderFee: row.rider_fee, adminFee: row.admin_fee, commissionRate: row.commission_rate,
  adminFeeType: row.admin_fee_type, adminFeeValue: row.admin_fee_value, logisticsFee: row.logistics_fee, logisticsFeeType: row.logistics_fee_type, logisticsFeeValue: row.logistics_fee_value, courierShare: row.courier_share, sellerProceeds: row.seller_proceeds, adminFeeSource: row.admin_fee_source, logisticsFeeSource: row.logistics_fee_source,
  total: row.total, collected: row.collected, difference: money(row.collected - row.total), paymentReference: row.payment_reference, collectedAt: row.collected_at, status: row.collection_status,
});

function filters(params, scope) {
  const payment = params.get('payment');
  return [
    ...(scope.riderId ? [['cr.rider_id = ?', scope.riderId]] : []),
    ...search(params, ['cr.order_id', 'cr.shop_name', 'cr.customer_name', 'cr.partner_name']),
    ...(payment === 'cod' ? [[`cr.payment_method = '${COD}'`]] : payment === 'prepaid' ? [[`cr.payment_method <> '${COD}'`]] : []),
    ...equals(params, 'partner', 'cr.partner_id'),
    ...(params.get('status') ? [[`(${STATUS}) = ?`, params.get('status')]] : []),
    ...dateRange(params, 'cr.collected_at'),
  ];
}

const SUMS = `COUNT(*) AS orders, COALESCE(SUM(cr.product_total), 0) AS product_total, COALESCE(SUM(cr.rider_fee), 0) AS rider_fee, COALESCE(SUM(cr.admin_fee), 0) AS admin_fee, COALESCE(SUM(cr.logistics_fee), 0) AS logistics_fee, COALESCE(SUM(cr.courier_share), 0) AS courier_share,
  COALESCE(SUM(cr.seller_proceeds), 0) AS seller_proceeds, COALESCE(SUM(cr.total), 0) AS total, COALESCE(SUM(cr.collected), 0) AS collected,
  COALESCE(SUM(CASE WHEN cr.payment_method = '${COD}' THEN cr.collected ELSE 0 END), 0) AS cod_collected,
  COALESCE(SUM(CASE WHEN cr.payment_method <> '${COD}' THEN cr.collected ELSE 0 END), 0) AS prepaid_collected,
  COALESCE(SUM(CASE WHEN (${STATUS}) = 'with_rider' THEN cr.collected ELSE 0 END), 0) AS with_riders,
  COALESCE(SUM(CASE WHEN (${STATUS}) = 'remitted' THEN cr.collected ELSE 0 END), 0) AS remitted`;

const toSums = (row) => ({
  orders: row.orders, productTotal: money(row.product_total), riderFee: money(row.rider_fee), adminFee: money(row.admin_fee), logisticsFee: money(row.logistics_fee), courierShare: money(row.courier_share), onetapFees: money(row.admin_fee + row.logistics_fee), sellerProceeds: money(row.seller_proceeds), total: money(row.total),
  collected: money(row.collected), codCollected: money(row.cod_collected), prepaidCollected: money(row.prepaid_collected), withRiders: money(row.with_riders), remitted: money(row.remitted),
});

const CSV = [
  ['Order', (r) => r.orderId], ['Seller', (r) => r.seller], ['Customer', (r) => r.customer], ['Courier', (r) => r.courier], ['Rider', (r) => r.rider], ['Payment method', (r) => r.paymentMethod],
  ['Product total', (r) => r.productTotal], ['Delivery fee', (r) => r.riderFee], ['Logistics fee', (r) => r.logisticsFee], ['Courier share', (r) => r.courierShare], ['Admin fee basis', (r) => (r.adminFeeType === 'fixed' ? `fixed ${r.adminFeeValue}` : `${r.adminFeeValue}%`)], ['Admin fee', (r) => r.adminFee], ['Seller proceeds', (r) => r.sellerProceeds],
  ['Total transaction', (r) => r.total], ['Collected', (r) => r.collected], ['Payment reference', (r) => r.paymentReference], ['Collection date', (r) => isoDate(r.collectedAt)], ['Collection status', (r) => r.status],
];

export function listCollections(params, scope = {}) {
  backfill();
  const where = filters(params, scope);
  const { rows, ...page } = listQuery(db(), { ...COLLECTION_LIST, where }, params);
  const records = rows.map(toCollection);
  if (params.get('format') === 'csv') return csvResponse('onetap-collections.csv', CSV, records);
  const clause = where.length ? `WHERE ${where.map(([sql]) => sql).join(' AND ')}` : '';
  const totals = db().prepare(`SELECT ${SUMS} FROM ${COLLECTION_LIST.from} ${clause}`).get(...where.flatMap(([, ...args]) => args));
  return Response.json({ ...page, rows: records, totals: toSums(totals) });
}

const PERIODS = {
  daily: "strftime('%Y-%m-%d', cr.collected_at / 1000, 'unixepoch', '+8 hours')",
  weekly: "strftime('%Y-W%W', cr.collected_at / 1000, 'unixepoch', '+8 hours')",
  monthly: "strftime('%Y-%m', cr.collected_at / 1000, 'unixepoch', '+8 hours')",
};

export function collectionsReport(params, scope = {}) {
  backfill();
  const period = PERIODS[params.get('period')] ? params.get('period') : 'daily';
  const where = filters(params, scope);
  const clause = where.length ? `WHERE ${where.map(([sql]) => sql).join(' AND ')}` : '';
  const rows = db().prepare(`SELECT ${PERIODS[period]} AS period, ${SUMS} FROM ${COLLECTION_LIST.from} ${clause} GROUP BY period ORDER BY period DESC LIMIT 400`)
    .all(...where.flatMap(([, ...args]) => args)).map((row) => ({ period: row.period, ...toSums(row) }));
  if (params.get('format') === 'csv') {
    return csvResponse(`onetap-collections-${period}.csv`, [
      ['Period', (r) => r.period], ['Orders', (r) => r.orders], ['Product total', (r) => r.productTotal], ['Delivery fees', (r) => r.riderFee], ['Logistics fees', (r) => r.logisticsFee], ['Courier shares', (r) => r.courierShare], ['Admin fees', (r) => r.adminFee], ['Seller proceeds', (r) => r.sellerProceeds],
      ['Total transactions', (r) => r.total], ['COD collected', (r) => r.codCollected], ['Prepaid collected', (r) => r.prepaidCollected], ['COD with riders', (r) => r.withRiders], ['Remitted to Onetap', (r) => r.remitted],
    ], rows);
  }
  return Response.json({ period, rows });
}

// One rider's delivered orders between two times, for their Collections page.
export function riderTransactions(riderId, from, to) {
  return db().prepare(`SELECT ${COLLECTION_LIST.select} FROM ${COLLECTION_LIST.from} WHERE cr.rider_id = ? AND cr.collected_at >= ? AND cr.collected_at < ? ORDER BY cr.collected_at`)
    .all(riderId, from, to).map(toCollection);
}
