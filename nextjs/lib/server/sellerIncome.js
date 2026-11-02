// Seller Finance > My Income. A seller's income ledger is built from actual transactions:
// one `sale` entry per delivered order, from its collection record (which fixes the product total,
// shipping fee and Onetap's commission when the courier confirms delivery), and one `refund`
// entry if that order is later refunded. Each order can have only one of each, so nothing is
// counted twice, and every figure traces back to an order. Entries are never edited.
//
// Net income = product revenue - platform fees - commissions - refunds - other deductions.
// Shipping fees are paid by the buyer and passed to the courier, so they are in gross sales but
// never in the seller's net. A refund reverses the commission on that order.
//
// An order's net income becomes eligible once Onetap holds the money (a prepaid payment is on
// record, or the courier remitted the COD cash) and the buyer's 7-day return window has closed
// with no return open. Eligible income is paid in weekly cycles: everything that becomes
// eligible from Monday 12:00 AM to Sunday 11:59 PM (Philippine time) is Pending Release, and is
// Released the following Tuesday at 8:00 AM. Sellers withdraw released income through payouts,
// which an administrator processes. Releases are worked out from the time on every read, so no
// scheduled job runs.

import { randomBytes, randomUUID } from 'node:crypto';
import { audit } from './admin';
import { decrypt, encrypt } from './crypto';
import { accountForPayout } from './payoutAccounts';
import { backfill as backfillCollections } from './collections';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, isoDate } from './lists';
import { notifyAdmins, notifySeller } from './notifications';

const DAY = 24 * 60 * 60 * 1000;
const RETURN_WINDOW_MS = 7 * DAY;
const PH = 8 * 60 * 60 * 1000;
const COD = 'Cash on Delivery';
const PAGE_SIZE = 20;
const MIN_PAYOUT = 100;
const OPEN_PAYOUT = ['pending', 'processing'];

const db = () => getDb();
const now = () => Date.now();
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const php = (value) => `₱${money(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows, key) => money(rows.reduce((total, row) => total + (row[key] || 0), 0));

// Philippine calendar days, weeks (Monday first), months and years.
const phDate = (ms) => new Date(ms + PH).toISOString().slice(0, 10);
const startOfDay = (ms) => Date.parse(`${phDate(ms)}T00:00:00+08:00`);
function periodKey(ms, period) {
  const day = phDate(ms);
  if (period === 'year') return day.slice(0, 4);
  if (period === 'month') return day.slice(0, 7);
  if (period === 'week') {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return `Week of ${date.toISOString().slice(0, 10)}`;
  }
  return day;
}
// The Monday 12:00 AM that starts the Philippine week containing `ms`.
function weekStartOf(ms) {
  const day = new Date(`${phDate(ms)}T00:00:00Z`);
  return startOfDay(ms) - ((day.getUTCDay() + 6) % 7) * DAY;
}
// Income that becomes eligible in a week is released the Tuesday after it, at 8:00 AM.
const RELEASE_AFTER_WEEK = DAY + 8 * 60 * 60 * 1000;
export const releaseTimeFor = (eligibleAt) => weekStartOf(eligibleAt) + 7 * DAY + RELEASE_AFTER_WEEK;
// The release still to come for income that is pending now: this week's, unless last week's
// has not been released yet (Monday, or Tuesday before 8:00 AM).
function nextRelease(time) {
  const lastWeeks = releaseTimeFor(weekStartOf(time) - DAY);
  return time < lastWeeks ? lastWeeks : releaseTimeFor(time);
}
const when = (ms) => new Date(ms).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

const parseDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(`${value}T00:00:00+08:00`) : NaN);

// Writes any missing ledger entries for a seller from their delivered and refunded orders. It runs
// on every read and is safe to repeat: the (order_id, kind) key refuses a second entry.
export function syncSellerIncome(seller) {
  backfillCollections();
  const database = db();
  database.prepare(`
    INSERT OR IGNORE INTO seller_income_entries (seller, order_id, kind, gross, product_revenue, shipping_fee, platform_fee, commission, refund, deduction, net, at, created_at)
    SELECT seller, order_id, 'sale', product_total + rider_fee, product_total, rider_fee, 0, admin_fee, 0, 0, seller_proceeds, collected_at, ?
    FROM collection_records WHERE seller = ?
  `).run(now(), seller);
  // Refunds after delivery: a return or refund the seller approved. The refund's own event dates it.
  const refunded = database.prepare(`
    SELECT o.id, o.data, s.product_revenue, s.commission FROM orders o JOIN seller_income_entries s ON s.order_id = o.id AND s.kind = 'sale'
    WHERE o.seller = ? AND json_extract(o.data, '$.return.status') = 'refunded'
      AND NOT EXISTS (SELECT 1 FROM seller_income_entries r WHERE r.order_id = o.id AND r.kind = 'refund')
  `).all(seller);
  refunded.forEach((row) => {
    const order = JSON.parse(row.data);
    const event = [...(order.events || [])].reverse().find((item) => /refund/i.test(item.label));
    const at = Date.parse(event?.at) || now();
    database.prepare(`INSERT OR IGNORE INTO seller_income_entries (seller, order_id, kind, gross, product_revenue, shipping_fee, platform_fee, commission, refund, deduction, net, at, created_at)
      VALUES (?, ?, 'refund', 0, 0, 0, 0, ?, ?, 0, ?, ?, ?)`).run(seller, row.id, -row.commission, row.product_revenue, money(-(row.product_revenue - row.commission)), at, now());
  });
}

const statusText = {
  pending: 'Awaiting settlement',
  on_hold: 'In return window',
  pending_release: 'Pending release',
  released: 'Released',
  refunded: 'Refunded',
};

// One record per order: its sale, any refund, and where its money is now.
function orderRecords(seller) {
  syncSellerIncome(seller);
  const rows = db().prepare(`
    SELECT s.*, o.data, c.payment_method, c.payment_reference, c.commission_rate, cod.status AS cod_status, cod.remitted_at, sh.delivered_at
    FROM seller_income_entries s
    JOIN orders o ON o.id = s.order_id
    JOIN collection_records c ON c.order_id = s.order_id
    LEFT JOIN cod_records cod ON cod.order_id = s.order_id
    LEFT JOIN shipments sh ON sh.order_id = s.order_id AND sh.status = 'delivered'
    WHERE s.seller = ? ORDER BY s.at
  `).all(seller);
  const byOrder = new Map();
  rows.forEach((row) => {
    const record = byOrder.get(row.order_id) || { orderId: row.order_id, entries: [] };
    record.entries.push(row);
    if (row.kind === 'sale') record.sale = row;
    else record.refund = row;
    byOrder.set(row.order_id, record);
  });
  const time = now();
  return [...byOrder.values()].filter((record) => record.sale).map(({ orderId, sale, refund }) => {
    const order = JSON.parse(sale.data);
    const cod = sale.payment_method === COD;
    const settledAt = cod ? (sale.cod_status === 'remitted' ? sale.remitted_at || sale.at : null) : (sale.payment_reference ? Date.parse(order.paidAt) || sale.at : null);
    const deliveredAt = sale.delivered_at || Date.parse(order.deliveredAt) || sale.at;
    const windowEnds = deliveredAt + RETURN_WINDOW_MS;
    const returnOpen = ['pending', 'awaiting'].includes(order.return?.status);
    let status;
    let reason;
    if (refund) {
      status = 'refunded';
      reason = 'Refunded to the buyer, so this order earns nothing.';
    } else if (!settledAt) {
      status = 'pending';
      reason = cod ? 'Waiting for the courier to remit the COD cash to Onetap.' : 'Waiting for the payment record.';
    } else if (returnOpen) {
      status = 'on_hold';
      reason = 'The buyer asked for a return or refund.';
    } else if (time < windowEnds) {
      status = 'on_hold';
      reason = `The buyer can ask for a return until ${new Date(windowEnds).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}.`;
    } else {
      const eligibleAt = Math.max(settledAt, windowEnds);
      const releaseAt = releaseTimeFor(eligibleAt);
      if (time < releaseAt) {
        status = 'pending_release';
        reason = `Eligible ${when(eligibleAt)}. Released with the week's income on ${when(releaseAt)}.`;
      } else {
        status = 'released';
        reason = `Released ${when(releaseAt)}. You can withdraw it.`;
      }
    }
    const items = order.items || [];
    const line = (key) => money(sale[key] + (refund?.[key] || 0));
    return {
      orderId, orderDate: Date.parse(order.placedAt) || sale.at, deliveredAt, settledAt, eligibleAt: settledAt && !refund && !returnOpen && time >= windowEnds ? Math.max(settledAt, windowEnds) : null, windowEnds,
      releasedAt: status === 'released' ? releaseTimeFor(Math.max(settledAt, windowEnds)) : null,
      releaseAt: settledAt && !refund && !returnOpen && time >= windowEnds ? releaseTimeFor(Math.max(settledAt, windowEnds)) : null,
      product: items[0]?.name || '—', moreItems: Math.max(0, items.length - 1), quantity: items.reduce((total, item) => total + (item.qty || 0), 0),
      items: items.map(({ name, variation, qty, price }) => ({ name, variation, qty, price })), customer: order.buyer?.name || '', paymentMethod: sale.payment_method,
      paymentReference: sale.payment_reference, commissionRate: sale.commission_rate, orderStatus: order.status,
      gross: money(sale.gross), productRevenue: money(sale.product_revenue), shippingFee: money(sale.shipping_fee), platformFee: line('platform_fee'), commission: line('commission'),
      refund: money(refund?.refund || 0), deduction: line('deduction'), net: line('net'), refundedAt: refund?.at || null,
      status, statusText: statusText[status], reason, entries: [sale, refund].filter(Boolean).map(toEntry),
    };
  });
}

const toEntry = (row) => ({
  id: row.id, kind: row.kind, at: row.at, gross: money(row.gross), productRevenue: money(row.product_revenue), shippingFee: money(row.shipping_fee), platformFee: money(row.platform_fee),
  commission: money(row.commission), refund: money(row.refund), deduction: money(row.deduction), net: money(row.net),
});

function payoutsOf(seller) {
  return db().prepare('SELECT * FROM seller_payouts WHERE seller = ? ORDER BY requested_at DESC').all(seller);
}

const maskAccount = (number) => (number.length > 4 ? `•••• ${number.slice(-4)}` : number);
// Payouts since saved accounts keep the number encrypted. Older ones kept it as typed.
const payoutNumber = (stored) => (stored.startsWith('enc:') ? decrypt(stored.slice(4)) : stored);
const toPayout = (row, full = false) => ({
  id: row.id, reference: row.reference, amount: money(row.amount), method: row.method, provider: row.provider, accountName: row.account_name,
  accountNumber: full ? payoutNumber(row.account_number) : maskAccount(payoutNumber(row.account_number)), status: row.status, note: row.note, payoutReference: row.payout_reference,
  requestedAt: row.requested_at, processingAt: row.processing_at, completedAt: row.completed_at, rejectedAt: row.rejected_at, processedBy: full ? row.processed_by : undefined,
});

// Withdrawn money is matched to released orders, oldest first, so each order shows whether it
// has been paid out. Completed payouts are matched before ones still in progress.
function withPayoutStatus(records, payouts) {
  let completed = sum(payouts.filter((p) => p.status === 'completed'), 'amount');
  let inProgress = sum(payouts.filter((p) => OPEN_PAYOUT.includes(p.status)), 'amount');
  const available = records.filter((record) => record.status === 'released').sort((a, b) => a.releasedAt - b.releasedAt);
  const states = new Map();
  available.forEach((record) => {
    let left = record.net;
    const paid = Math.min(left, completed);
    completed = money(completed - paid);
    left = money(left - paid);
    const moving = Math.min(left, inProgress);
    inProgress = money(inProgress - moving);
    left = money(left - moving);
    states.set(record.orderId, left <= 0 ? (moving > 0 ? 'in_payout' : 'paid_out') : paid + moving > 0 ? 'partly_withdrawn' : 'not_withdrawn');
  });
  return records.map((record) => ({ ...record, payoutStatus: states.get(record.orderId) || (record.status === 'refunded' ? 'none' : 'not_available') }));
}

function balances(records, payouts) {
  const byStatus = (status) => sum(records.filter((record) => record.status === status), 'net');
  const payoutSum = (status) => sum(payouts.filter((p) => p.status === status), 'amount');
  const count = (status) => payouts.filter((p) => p.status === status).length;
  const released = byStatus('released');
  const committed = sum(payouts.filter((p) => p.status !== 'rejected' && p.status !== 'cancelled'), 'amount');
  return {
    // What can be withdrawn: released income minus every payout that wasn't rejected or cancelled.
    available: money(Math.max(0, released - committed)),
    released,
    pendingRelease: byStatus('pending_release'),
    pendingSettlement: byStatus('pending'),
    onHold: byStatus('on_hold'),
    notYetEligible: money(byStatus('pending') + byStatus('on_hold')),
    withdrawn: payoutSum('completed'),
    payouts: {
      pending: { amount: payoutSum('pending'), count: count('pending') },
      processing: { amount: payoutSum('processing'), count: count('processing') },
      completed: { amount: payoutSum('completed'), count: count('completed') },
    },
  };
}

function entriesIn(seller, from, to) {
  return db().prepare('SELECT * FROM seller_income_entries WHERE seller = ? AND at >= ? AND at < ? ORDER BY at').all(seller, from, to);
}

const totalsOf = (entries) => {
  const totals = {
    grossSales: sum(entries, 'gross'), productRevenue: sum(entries, 'product_revenue'), shippingFees: sum(entries, 'shipping_fee'), platformFees: sum(entries, 'platform_fee'),
    commissions: sum(entries, 'commission'), refunds: sum(entries, 'refund'), deductions: sum(entries, 'deduction'), netIncome: sum(entries, 'net'),
    orders: entries.filter((e) => e.kind === 'sale').length, refundedOrders: entries.filter((e) => e.kind === 'refund').length,
  };
  return totals;
};

export function incomeOverview(seller) {
  const records = orderRecords(seller);
  const payouts = payoutsOf(seller);
  const time = now();
  const today = startOfDay(time);
  const day = new Date(`${phDate(time)}T00:00:00Z`);
  const weekStart = today - ((day.getUTCDay() + 6) % 7) * DAY;
  const monthStart = Date.parse(`${phDate(time).slice(0, 7)}-01T00:00:00+08:00`);
  const all = db().prepare('SELECT * FROM seller_income_entries WHERE seller = ?').all(seller);
  const since = (start) => totalsOf(all.filter((entry) => entry.at >= start)).netIncome;
  // 90 Philippine days, oldest first, for the trend chart.
  const days = Array.from({ length: 90 }, (_, i) => phDate(today - (89 - i) * DAY));
  const daily = Object.fromEntries(days.map((d) => [d, { date: d, net: 0, gross: 0, orders: 0 }]));
  all.forEach((entry) => {
    const bucket = daily[phDate(entry.at)];
    if (!bucket) return;
    bucket.net = money(bucket.net + entry.net);
    bucket.gross = money(bucket.gross + entry.gross);
    if (entry.kind === 'sale') bucket.orders += 1;
  });
  const lifetime = totalsOf(all);
  const balance = balances(records, payouts);
  const upcoming = nextRelease(time);
  return {
    // The four headline figures. Total = released + pending release + not yet eligible.
    income: {
      pending: balance.pendingRelease,
      released: balance.released,
      month: since(monthStart),
      total: lifetime.netIncome,
      notYetEligible: balance.notYetEligible,
      cycle: { from: weekStartOf(time), to: weekStartOf(time) + 7 * DAY - 60 * 1000, nextRelease: upcoming },
      // Pending income by the Tuesday it is released, soonest first.
      releases: Object.entries(records.filter((r) => r.status === 'pending_release').reduce((by, r) => ({ ...by, [r.releaseAt]: money((by[r.releaseAt] || 0) + r.net) }), {}))
        .map(([at, amount]) => ({ at: Number(at), amount })).sort((a, b) => a.at - b.at),
    },
    totals: { totalEarnings: lifetime.netIncome, totalSales: lifetime.grossSales, productRevenue: lifetime.productRevenue, orders: lifetime.orders, today: since(today), week: since(weekStart), month: since(monthStart) },
    balance,
    trend: Object.values(daily),
    payouts: payouts.slice(0, 10).map((row) => toPayout(row)),
    minPayout: MIN_PAYOUT,
  };
}

const PERIODS = ['day', 'week', 'month', 'year'];
const STATEMENT_CSV = [
  ['Period', (r) => r.period], ['Orders', (r) => r.orders], ['Refunded orders', (r) => r.refundedOrders], ['Gross sales', (r) => r.grossSales], ['Product revenue', (r) => r.productRevenue],
  ['Shipping fees (to courier)', (r) => r.shippingFees], ['Platform fees', (r) => r.platformFees], ['Commissions', (r) => r.commissions], ['Refunds', (r) => r.refunds],
  ['Other deductions', (r) => r.deductions], ['Net income', (r) => r.netIncome],
];

export function incomeStatement(seller, params) {
  syncSellerIncome(seller);
  const time = now();
  const to = parseDay(params.get('to')) || startOfDay(time);
  const from = parseDay(params.get('from')) || Date.parse(`${phDate(time).slice(0, 7)}-01T00:00:00+08:00`);
  if (from > to) throw new ApiError(422, 'The start date must be on or before the end date.');
  if (to - from > 3 * 366 * DAY) throw new ApiError(422, 'Choose a range of up to three years.');
  const period = PERIODS.includes(params.get('period')) ? params.get('period') : 'day';
  const entries = entriesIn(seller, from, to + DAY);
  const groups = new Map();
  entries.forEach((entry) => {
    const key = periodKey(entry.at, period);
    groups.set(key, [...(groups.get(key) || []), entry]);
  });
  const rows = [...groups.entries()].map(([key, list]) => ({ period: key, ...totalsOf(list) }));
  const summary = { period: 'Total', ...totalsOf(entries) };
  const range = { from: phDate(from), to: phDate(to) };
  if (params.get('format') === 'csv') return csvResponse(`onetap-income-statement-${range.from}-to-${range.to}.csv`, STATEMENT_CSV, [...rows, summary]);
  return Response.json({ range, period, rows, summary, generatedAt: time });
}

const DETAIL_SORTS = { date: (r) => r.orderDate, net: (r) => r.net, gross: (r) => r.gross };
const DETAIL_CSV = [
  ['Order', (r) => r.orderId], ['Product', (r) => r.product + (r.moreItems ? ` (+${r.moreItems} more)` : '')], ['Quantity', (r) => r.quantity], ['Order date', (r) => isoDate(r.orderDate)],
  ['Delivered', (r) => isoDate(r.deliveredAt)], ['Payment', (r) => r.paymentMethod], ['Gross amount', (r) => r.gross], ['Shipping fee (to courier)', (r) => r.shippingFee], ['Platform fees', (r) => r.platformFee],
  ['Commission', (r) => r.commission], ['Refund', (r) => r.refund], ['Other deductions', (r) => r.deduction], ['Net earnings', (r) => r.net], ['Income status', (r) => r.statusText], ['Payout status', (r) => r.payoutStatus],
];

export function incomeDetails(seller, params) {
  const records = withPayoutStatus(orderRecords(seller), payoutsOf(seller));
  const q = String(params.get('q') || '').trim().toLowerCase();
  const status = params.get('status');
  const payout = params.get('payout');
  const from = parseDay(params.get('from'));
  const to = parseDay(params.get('to'));
  let rows = records.filter((r) => (!q || r.orderId.toLowerCase().includes(q) || r.items.some((item) => item.name.toLowerCase().includes(q)) || r.customer.toLowerCase().includes(q))
    && (!status || r.status === status) && (!payout || r.payoutStatus === payout)
    && (!from || r.deliveredAt >= from) && (!to || r.deliveredAt < to + DAY));
  const sort = DETAIL_SORTS[params.get('sort')] ? params.get('sort') : 'date';
  const dir = params.get('dir') === 'asc' ? 1 : -1;
  rows = rows.sort((a, b) => (DETAIL_SORTS[sort](a) - DETAIL_SORTS[sort](b)) * dir);
  if (params.get('format') === 'csv') return csvResponse('onetap-income-details.csv', DETAIL_CSV, rows);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const counts = Object.fromEntries(Object.keys(statusText).map((key) => [key, records.filter((r) => r.status === key).length]));
  return Response.json({
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ entries, items, ...row }) => row), total: rows.length, page, pageSize: PAGE_SIZE,
    counts, totals: { gross: sum(rows, 'gross'), net: sum(rows, 'net') },
  });
}

export function incomeRecord(seller, orderId) {
  const records = withPayoutStatus(orderRecords(seller), payoutsOf(seller));
  const record = records.find((r) => r.orderId === String(orderId));
  if (!record) throw new ApiError(404, 'There is no income record for that order yet. Income is recorded when the order is delivered.');
  return record;
}

// Payouts. One request can be open at a time, it can't be more than the available balance, and it
// goes to one of the seller's verified saved accounts (payoutAccounts.js).
function readPayout(input) {
  const amount = money(input.amount);
  if (!(amount >= MIN_PAYOUT)) throw new ApiError(422, 'Check the highlighted fields.', { amount: `Withdraw at least ${php(MIN_PAYOUT)}.` });
  return { amount };
}

export function requestPayout(seller, input) {
  const payout = readPayout(input || {});
  const account = accountForPayout(seller, input?.accountId);
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const { available } = balances(orderRecords(seller), payoutsOf(seller));
    if (payout.amount > available) throw new ApiError(422, `You can withdraw up to ${php(available)}.`, { amount: `You can withdraw up to ${php(available)}.` });
    if (database.prepare("SELECT 1 FROM seller_payouts WHERE seller = ? AND status IN ('pending', 'processing')").get(seller)) {
      throw new ApiError(409, 'You already have a payout in progress. You can request another once it is done.');
    }
    const reference = `PO-${randomBytes(4).toString('hex').toUpperCase()}`;
    // A copy of where it goes, so later edits to the saved account never change a payout. The number stays encrypted.
    database.prepare(`INSERT INTO seller_payouts (id, reference, seller, amount, method, provider, account_name, account_number, account_id, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(randomUUID(), reference, seller, payout.amount, account.kind === 'bank' ? 'Bank transfer' : 'E-wallet', account.provider, account.holderName, `enc:${encrypt(account.number)}`, account.id, now());
    notifyAdmins('cod', 'Seller payout requested', `${seller} asked to withdraw ${php(payout.amount)} (${reference}).`, '/admin/payouts?status=pending');
    audit({ username: seller, adminRole: 'seller' }, 'payout.requested', 'payout', reference, { amount: payout.amount, account: account.id });
    database.exec('COMMIT');
    return { reference };
  } catch (err) {
    database.exec('ROLLBACK');
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'You already have a payout in progress.');
    throw err;
  }
}

export function cancelPayout(seller, id) {
  const changed = db().prepare("UPDATE seller_payouts SET status = 'cancelled', rejected_at = ? WHERE id = ? AND seller = ? AND status = 'pending'").run(now(), String(id), seller).changes;
  if (!changed) throw new ApiError(409, 'Only a payout that is still pending can be cancelled.');
  audit({ username: seller, adminRole: 'seller' }, 'payout.cancelled', 'payout', id);
}

export function sellerPayouts(seller) {
  return payoutsOf(seller).map((row) => toPayout(row));
}

// Admin Console > Seller Payouts.
export function listPayouts(params) {
  const status = params.get('status');
  const q = String(params.get('q') || '').trim().toLowerCase();
  const rows = db().prepare('SELECT * FROM seller_payouts ORDER BY requested_at DESC').all()
    .filter((row) => (!status || row.status === status) && (!q || [row.reference, row.seller, row.account_name].some((v) => v.toLowerCase().includes(q))))
    .map((row) => ({ ...toPayout(row, true), seller: row.seller }));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-seller-payouts.csv', [
      ['Reference', (r) => r.reference], ['Seller', (r) => r.seller], ['Amount', (r) => r.amount], ['Method', (r) => r.method], ['Provider', (r) => r.provider], ['Account name', (r) => r.accountName],
      ['Account number', (r) => maskAccount(r.accountNumber)], ['Status', (r) => r.status], ['Payout reference', (r) => r.payoutReference], ['Note', (r) => r.note], ['Requested', (r) => isoDate(r.requestedAt)], ['Completed', (r) => isoDate(r.completedAt)],
    ], rows);
  }
  const page = Math.max(1, Number(params.get('page')) || 1);
  const all = db().prepare('SELECT status, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS amount FROM seller_payouts GROUP BY status').all();
  const counts = Object.fromEntries(all.map((row) => [row.status, row.c]));
  const amounts = Object.fromEntries(all.map((row) => [row.status, money(row.amount)]));
  return Response.json({ rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: rows.length, page, pageSize: PAGE_SIZE, counts, amounts });
}

const PAYOUT_ACTIONS = {
  process: { from: ['pending'], to: 'processing', title: 'Payout processing', body: (p) => `Onetap is sending ${php(p.amount)} (${p.reference}) to your ${p.provider} account ${p.accountNumber}.` },
  complete: { from: ['processing'], to: 'completed', title: 'Payout sent', body: (p, ref) => `${php(p.amount)} (${p.reference}) was sent to your ${p.provider} account ${p.accountNumber}. Transfer reference ${ref}.` },
  reject: { from: ['pending', 'processing'], to: 'rejected', title: 'Payout not sent', body: (p, note) => `${p.reference} was not sent: ${note} The amount is back in your available balance.` },
};

export function decidePayout(admin, id, { action, reference, note }) {
  const step = Object.hasOwn(PAYOUT_ACTIONS, action) ? PAYOUT_ACTIONS[action] : null;
  if (!step) throw new ApiError(400, 'Unknown action.');
  const row = db().prepare('SELECT * FROM seller_payouts WHERE id = ?').get(String(id));
  if (!row) throw new ApiError(404, 'We could not find that payout.');
  if (!step.from.includes(row.status)) throw new ApiError(409, 'This payout has changed. Refresh and try again.');
  const ref = String(reference || '').trim().slice(0, 60);
  const text = String(note || '').trim().slice(0, 300);
  if (action === 'complete' && ref.length < 4) throw new ApiError(422, 'Enter the transfer reference from the bank or wallet.', { reference: 'Enter the transfer reference from the bank or wallet.' });
  if (action === 'reject' && text.length < 10) throw new ApiError(422, 'Enter a reason of at least 10 characters.', { note: 'Enter a reason of at least 10 characters.' });
  const time = now();
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const columns = { process: 'processing_at = ?', complete: 'completed_at = ?, payout_reference = ?', reject: 'rejected_at = ?, note = ?' }[action];
    const values = { process: [time], complete: [time, ref], reject: [time, text] }[action];
    const changed = database.prepare(`UPDATE seller_payouts SET status = ?, ${columns}, processed_by = ? WHERE id = ? AND status = ?`).run(step.to, ...values, admin.username, row.id, row.status).changes;
    if (!changed) throw new ApiError(409, 'This payout has changed. Refresh and try again.');
    const payout = toPayout(row);
    notifySeller(row.seller, step.title, step.body(payout, action === 'complete' ? ref : text), '/seller/balance');
    audit(admin, `payout.${action}`, 'payout', row.reference, { seller: row.seller, amount: row.amount, reference: ref || undefined, note: text || undefined });
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  return { ...toPayout(db().prepare('SELECT * FROM seller_payouts WHERE id = ?').get(row.id), true), seller: row.seller };
}
