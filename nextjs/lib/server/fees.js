// Onetap's fees, set by administrators in Fee Management.
//
// Admin fee: charged to the seller on every delivered order, as a fixed amount per order or a
// percentage of the order's product total (the seller's gross product income). It comes out of the
// seller's proceeds.
// Logistics fee: Onetap's share of the delivery fee the buyer paid (the partner's gross delivery
// income), as a fixed amount per delivery or a percentage of that fee. The courier gets the rest.
//
// Each has a default rate, and each seller (admin fee) or logistics partner (logistics fee) can have
// its own rate instead, or have the fee switched off (account_fees). Both are worked out when the
// courier confirms delivery and saved on the order's collection record (collections.js), once per
// order, so a later change never rewrites history and an order is never charged twice. Every change
// to a default or account fee is kept in fee_changes with the administrator who made it. Sellers
// never see either fee.

import { audit } from './admin';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, isoDate, listQuery, search } from './lists';

const KEYS = { admin: 'admin_fee', logistics: 'logistics_fee' };
const TYPES = ['percent', 'fixed'];
const LIMITS = { percent: 50, fixed: 100000 };
// A seller pays the admin fee and a logistics partner the logistics fee.
const KINDS = { seller: 'admin', partner: 'logistics' };
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const db = () => getDb();

const read = (key) => {
  const row = db().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
};

// The default rates. The admin fee started as a commission percentage, which carries over the first time.
export function currentFees() {
  const legacy = Number(db().prepare("SELECT value FROM app_settings WHERE key = 'commission_rate'").get()?.value) || 0;
  return {
    admin: read(KEYS.admin) || { type: 'percent', value: legacy },
    logistics: read(KEYS.logistics) || { type: 'percent', value: 0 },
  };
}

const accountRow = (kind, account) => db().prepare('SELECT * FROM account_fees WHERE kind = ? AND account = ?').get(kind, account);

// The fee an account pays now: its own rate, the default, or nothing when switched off. `source`
// says which, and is saved with each order's fees.
function effectiveFee(kind, row, defaults) {
  const fallback = defaults[KINDS[kind]];
  if (row && !row.enabled) return { type: row.custom ? row.type : fallback.type, value: 0, source: 'off' };
  if (row?.custom) return { type: row.type, value: row.value, source: 'account' };
  return { ...fallback, source: 'default' };
}

// A fixed fee never takes more than the amount it is charged on.
function apply(fee, base) {
  if (!fee?.value || base <= 0) return 0;
  return money(fee.type === 'fixed' ? Math.min(fee.value, base) : (base * fee.value) / 100);
}

// The fees on one delivered order, from its product total and delivery fee, for its seller and partner.
export function feesFor(productTotal, deliveryFee, { seller = '', partnerId = '' } = {}, defaults = currentFees()) {
  const admin = effectiveFee('seller', seller && accountRow('seller', seller), defaults);
  const logistics = effectiveFee('partner', partnerId && accountRow('partner', partnerId), defaults);
  const adminFee = apply(admin, productTotal);
  const logisticsFee = apply(logistics, deliveryFee);
  return {
    adminFee, logisticsFee, courierShare: money(deliveryFee - logisticsFee), sellerProceeds: money(productTotal - adminFee),
    adminFeeType: admin.type, adminFeeValue: admin.value, adminFeeSource: admin.source,
    logisticsFeeType: logistics.type, logisticsFeeValue: logistics.value, logisticsFeeSource: logistics.source,
  };
}

const describe = (fee) => (fee.type === 'fixed' ? `₱${money(fee.value).toLocaleString('en-PH', { minimumFractionDigits: 2 })} per order` : `${fee.value}%`);

function readFee(input, name) {
  const type = TYPES.includes(input?.type) ? input.type : '';
  const value = Number(input?.value);
  if (!type) throw new ApiError(422, 'Check the highlighted fields.', { [`${name}Type`]: 'Choose a fixed amount or a percentage.' });
  if (input?.value === '' || input?.value === undefined || !Number.isFinite(value) || value < 0 || value > LIMITS[type]) {
    throw new ApiError(422, 'Check the highlighted fields.', { [`${name}Value`]: type === 'percent' ? `Enter a percentage from 0 to ${LIMITS.percent}.` : `Enter an amount from ₱0 to ₱${LIMITS.fixed.toLocaleString('en-PH')}.` });
  }
  return { type, value: money(value) };
}

function transaction(work) {
  db().exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db().exec('COMMIT');
    return result;
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }
}

const recordChange = (admin, kind, account, before, after) => db()
  .prepare('INSERT INTO fee_changes (kind, account, before, after, admin, admin_role, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(kind, account, JSON.stringify(before), JSON.stringify(after), admin.username, admin.adminRole, Date.now());

// The default rates, for every seller and partner without their own.
export function setFees(admin, input) {
  const next = { admin: readFee(input?.admin, 'admin'), logistics: readFee(input?.logistics, 'logistics') };
  const previous = currentFees();
  if (JSON.stringify(next) === JSON.stringify(previous)) throw new ApiError(422, 'Nothing has changed yet.');
  transaction(() => {
    const save = db().prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    save.run(KEYS.admin, JSON.stringify(next.admin));
    save.run(KEYS.logistics, JSON.stringify(next.logistics));
    recordChange(admin, 'default', '', previous, next);
    audit(admin, 'settings.fees_changed', 'setting', 'fees', { adminFee: { from: describe(previous.admin), to: describe(next.admin) }, logisticsFee: { from: describe(previous.logistics), to: describe(next.logistics) } });
  });
  return next;
}

// What an account's setting looks like to administrators.
function toSetting(kind, row, defaults) {
  const fee = effectiveFee(kind, row, defaults);
  return {
    enabled: row ? Boolean(row.enabled) : true,
    mode: row?.custom ? 'custom' : 'default',
    type: row?.custom ? row.type : defaults[KINDS[kind]].type,
    value: row?.custom ? row.value : defaults[KINDS[kind]].value,
    effective: fee,
    createdAt: row?.created_at || null, createdBy: row?.created_by || '', updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || '',
  };
}

const settingText = (setting) => (!setting.enabled ? 'Switched off' : `${describe(setting)}${setting.mode === 'default' ? ' (default)' : ''}`);

function checkAccount(kind, account) {
  const row = kind === 'seller'
    ? db().prepare('SELECT username FROM sellers WHERE username = ?').get(account)
    : db().prepare('SELECT id FROM logistics_partners WHERE id = ?').get(account);
  if (!row) throw new ApiError(404, kind === 'seller' ? 'We could not find that seller.' : 'We could not find that logistics partner.');
}

// Sets one seller's admin fee or one partner's logistics fee: switched on or off, and the default
// rate or its own. Applies to orders delivered from now on.
export function setAccountFee(admin, kind, account, input) {
  if (!KINDS[kind]) throw new ApiError(404, 'Choose a seller or a logistics partner.');
  checkAccount(kind, account);
  const enabled = input?.enabled !== false;
  const custom = input?.mode === 'custom';
  const rate = custom ? readFee(input, 'fee') : null;
  const defaults = currentFees();
  return transaction(() => {
    const row = accountRow(kind, account);
    const before = toSetting(kind, row, defaults);
    const time = Date.now();
    const next = { enabled: enabled ? 1 : 0, custom: custom ? 1 : 0, type: rate?.type || before.type, value: rate ? rate.value : 0 };
    if (row && row.enabled === next.enabled && row.custom === next.custom && (!custom || (row.type === next.type && row.value === next.value))) throw new ApiError(422, 'Nothing has changed yet.');
    if (!row && enabled && !custom) throw new ApiError(422, 'Nothing has changed yet.');
    db().prepare(`INSERT INTO account_fees (kind, account, enabled, custom, type, value, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, account) DO UPDATE SET enabled = excluded.enabled, custom = excluded.custom, type = excluded.type, value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(kind, account, next.enabled, next.custom, next.type, next.value, time, admin.username, time, admin.username);
    const after = toSetting(kind, accountRow(kind, account), defaults);
    const strip = ({ enabled: on, mode, type, value }) => ({ enabled: on, mode, type, value });
    recordChange(admin, kind, account, strip(before), strip(after));
    audit(admin, kind === 'seller' ? 'fees.seller_changed' : 'fees.partner_changed', kind === 'seller' ? 'seller' : 'partner', account, { from: settingText(before), to: settingText(after) });
    return accountFeeDetail(kind, account);
  });
}

const toChange = (row) => ({ id: row.id, kind: row.kind, account: row.account, before: JSON.parse(row.before), after: JSON.parse(row.after), admin: row.admin, adminRole: row.admin_role, at: row.at });

// Gross income, fees and net from delivered orders, per seller or per partner.
const TOTALS = {
  seller: "(SELECT seller AS who, COUNT(*) AS orders, SUM(product_total) AS gross, SUM(admin_fee) AS fee, SUM(seller_proceeds) AS net FROM collection_records GROUP BY seller)",
  partner: "(SELECT partner_id AS who, COUNT(*) AS orders, SUM(rider_fee) AS gross, SUM(logistics_fee) AS fee, SUM(courier_share) AS net FROM collection_records GROUP BY partner_id)",
};
const FEE_FILTERS = {
  default: 'COALESCE(f.custom, 0) = 0 AND COALESCE(f.enabled, 1) = 1',
  custom: 'f.custom = 1 AND f.enabled = 1',
  off: 'f.enabled = 0',
};

const sums = (row) => ({ orders: row.orders || 0, gross: money(row.gross), fee: money(row.fee), net: money(row.net) });

// Fee Management > Admin Fee: every registered seller with their admin fee and what it has taken.
export function sellerFeeList(params) {
  const defaults = currentFees();
  const status = params.get('status');
  const fee = params.get('fee');
  const where = [
    ...search(params, ['s.username', 's.profile', 's.email']),
    ...(status ? [["COALESCE(a.status, 'pending') = ?", status]] : []),
    ...(FEE_FILTERS[fee] ? [[FEE_FILTERS[fee]]] : []),
  ];
  const { rows, ...page } = listQuery(db(), {
    select: "s.username, s.email, s.profile, COALESCE(a.status, 'pending') AS status, f.*, t.orders, t.gross, t.fee, t.net",
    from: `sellers s LEFT JOIN seller_applications a ON a.username = s.username LEFT JOIN account_fees f ON f.kind = 'seller' AND f.account = s.username LEFT JOIN ${TOTALS.seller} t ON t.who = s.username`,
    where,
    sorts: { seller: 's.username', fees: 'COALESCE(t.fee, 0)', gross: 'COALESCE(t.gross, 0)', updated: 'COALESCE(f.updated_at, 0)' },
    defaultSort: 'seller',
  }, params);
  const sellers = rows.map((row) => {
    const profile = JSON.parse(row.profile);
    return {
      account: row.username, name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || row.username, shopName: profile.shopName || row.username, email: row.email,
      status: row.status, setting: toSetting('seller', row.kind ? row : null, defaults), ...sums(row),
    };
  });
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-seller-admin-fees.csv', [
      ['Seller', (r) => r.name], ['Store', (r) => r.shopName], ['Username', (r) => r.account], ['Status', (r) => r.status], ['Admin fee', (r) => settingText(r.setting)],
      ['Orders', (r) => r.orders], ['Gross product income', (r) => r.gross], ['Admin fees', (r) => r.fee], ['Net income', (r) => r.net], ['Changed', (r) => isoDate(r.setting.updatedAt)], ['Changed by', (r) => r.setting.updatedBy],
    ], sellers);
  }
  return Response.json({ ...page, rows: sellers, defaults, limits: LIMITS });
}

// Fee Management > Logistic Fee: every logistics partner with its logistics fee and what it has taken.
export function partnerFeeList(params) {
  const defaults = currentFees();
  const status = params.get('status');
  const fee = params.get('fee');
  const where = [
    ...search(params, ['p.name', 'p.id']),
    ...(status ? [['p.status = ?', status]] : []),
    ...(FEE_FILTERS[fee] ? [[FEE_FILTERS[fee]]] : []),
  ];
  const { rows, ...page } = listQuery(db(), {
    select: 'p.id, p.name, p.status, f.*, t.orders, t.gross, t.fee, t.net',
    from: `logistics_partners p LEFT JOIN account_fees f ON f.kind = 'partner' AND f.account = p.id LEFT JOIN ${TOTALS.partner} t ON t.who = p.id`,
    where,
    sorts: { partner: 'p.name', fees: 'COALESCE(t.fee, 0)', gross: 'COALESCE(t.gross, 0)', updated: 'COALESCE(f.updated_at, 0)' },
    defaultSort: 'partner',
  }, params);
  const partners = rows.map((row) => ({ account: row.id, name: row.name, status: row.status, setting: toSetting('partner', row.kind ? row : null, defaults), ...sums(row) }));
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-partner-logistics-fees.csv', [
      ['Partner', (r) => r.name], ['Status', (r) => r.status], ['Logistics fee', (r) => settingText(r.setting)],
      ['Deliveries', (r) => r.orders], ['Gross delivery income', (r) => r.gross], ['Logistics fees', (r) => r.fee], ['Net income', (r) => r.net], ['Changed', (r) => isoDate(r.setting.updatedAt)], ['Changed by', (r) => r.setting.updatedBy],
    ], partners);
  }
  return Response.json({ ...page, rows: partners, defaults, limits: LIMITS });
}

// One account's fee: the setting, its totals, the orders it was charged on (newest first, with how
// each was worked out), and every change to it.
export function accountFeeDetail(kind, account) {
  if (!KINDS[kind]) throw new ApiError(404, 'Choose a seller or a logistics partner.');
  checkAccount(kind, account);
  const defaults = currentFees();
  const seller = kind === 'seller';
  const column = seller ? 'seller' : 'partner_id';
  const name = seller
    ? (() => { const row = db().prepare('SELECT profile FROM sellers WHERE username = ?').get(account); const p = JSON.parse(row.profile); return { name: [p.firstName, p.lastName].filter(Boolean).join(' '), shopName: p.shopName }; })()
    : { name: db().prepare('SELECT name FROM logistics_partners WHERE id = ?').get(account).name };
  const totals = db().prepare(seller
    ? 'SELECT COUNT(*) AS orders, SUM(product_total) AS gross, SUM(admin_fee) AS fee, SUM(seller_proceeds) AS net FROM collection_records WHERE seller = ?'
    : 'SELECT COUNT(*) AS orders, SUM(rider_fee) AS gross, SUM(logistics_fee) AS fee, SUM(courier_share) AS net FROM collection_records WHERE partner_id = ?').get(account);
  const orders = db().prepare(`SELECT order_id, collected_at, product_total, rider_fee, admin_fee, admin_fee_type, admin_fee_value, admin_fee_source, seller_proceeds, logistics_fee, logistics_fee_type, logistics_fee_value, logistics_fee_source, courier_share
    FROM collection_records WHERE ${column} = ? ORDER BY collected_at DESC LIMIT 20`).all(account).map((row) => (seller
    ? { orderId: row.order_id, at: row.collected_at, gross: row.product_total, fee: row.admin_fee, net: row.seller_proceeds, type: row.admin_fee_type, value: row.admin_fee_value, source: row.admin_fee_source }
    : { orderId: row.order_id, at: row.collected_at, gross: row.rider_fee, fee: row.logistics_fee, net: row.courier_share, type: row.logistics_fee_type, value: row.logistics_fee_value, source: row.logistics_fee_source }));
  const history = db().prepare('SELECT * FROM fee_changes WHERE kind = ? AND account = ? ORDER BY id DESC LIMIT 50').all(kind, account).map(toChange);
  return { kind, account, ...name, setting: toSetting(kind, accountRow(kind, account) || null, defaults), defaults, limits: LIMITS, totals: sums(totals), orders, history };
}

// What Fee Management shows: the default rates, what fees earned so far, how many accounts have
// their own, and every change.
export function feeOverview() {
  const totals = db().prepare('SELECT COUNT(*) AS orders, COALESCE(SUM(admin_fee), 0) AS admin, COALESCE(SUM(logistics_fee), 0) AS logistics FROM collection_records').get();
  const accounts = Object.fromEntries(['seller', 'partner'].map((kind) => [kind, {
    custom: db().prepare('SELECT COUNT(*) AS c FROM account_fees WHERE kind = ? AND custom = 1 AND enabled = 1').get(kind).c,
    off: db().prepare('SELECT COUNT(*) AS c FROM account_fees WHERE kind = ? AND enabled = 0').get(kind).c,
  }]));
  const names = {
    seller: (account) => JSON.parse(db().prepare('SELECT profile FROM sellers WHERE username = ?').get(account)?.profile || '{}').shopName || account,
    partner: (account) => db().prepare('SELECT name FROM logistics_partners WHERE id = ?').get(account)?.name || account,
  };
  const history = db().prepare('SELECT * FROM fee_changes ORDER BY id DESC LIMIT 30').all().map((row) => ({ ...toChange(row), accountName: names[row.kind]?.(row.account) || '' }));
  // Changes from before fee_changes existed are only in the audit log.
  const older = db().prepare("SELECT admin, detail, at FROM admin_audit WHERE action IN ('settings.fees_changed', 'settings.commission_changed') AND at < COALESCE((SELECT MIN(at) FROM fee_changes WHERE kind = 'default'), 9e15) ORDER BY id DESC LIMIT 20").all()
    .map((row) => ({ admin: row.admin, at: row.at, detail: JSON.parse(row.detail || '{}') }));
  return { fees: currentFees(), limits: LIMITS, earned: { orders: totals.orders, adminFees: money(totals.admin), logisticsFees: money(totals.logistics) }, accounts, history, older };
}
