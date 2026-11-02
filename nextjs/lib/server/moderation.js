// Product listings. Sellers publish straight to the marketplace, and administrators can take
// a listing down. Every step is recorded.

import { reviewProduct } from '../products';
import { audit } from './admin';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, equals, isoDate, listQuery, search } from './lists';
import { notifySeller } from './notifications';

export function recordReview(productId, action, actor, reason = '') {
  getDb().prepare('INSERT INTO product_reviews (product_id, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(productId, action, actor, reason, Date.now());
}

function toListing(row) {
  const product = JSON.parse(row.data);
  return { ...product, id: row.id, seller: row.seller, shopName: row.shop_name, status: row.status, reason: row.violation, createdAt: row.created_at, updatedAt: row.updated_at, flag: reviewProduct(product) };
}

const STATUS_FILTERS = { live: 'live', suspended: 'suspended' };

export function moderationCounts() {
  const counts = Object.fromEntries(getDb().prepare('SELECT status, COUNT(*) AS c FROM products GROUP BY status').all().map((row) => [row.status, row.c]));
  return { live: counts.live || 0, suspended: counts.suspended || 0 };
}

export function flaggedListings() {
  return getDb().prepare("SELECT data FROM products WHERE status = 'live'").all().filter((row) => reviewProduct(JSON.parse(row.data))).length;
}

export function listListings(params) {
  const status = STATUS_FILTERS[params.get('tab')];
  const where = [
    ['status <> ?', 'unpublished'],
    ...(status ? [['status = ?', status]] : []),
    ...search(params, ['code', 'shop_name', 'seller', 'data']),
    ...equals(params, 'seller', 'seller'),
  ];
  const { rows, ...page } = listQuery(getDb(), { from: 'products', where, sorts: { updated: 'updated_at', created: 'created_at', seller: 'shop_name', status: 'status' }, defaultSort: 'updated' }, params);
  const listings = rows.map(toListing);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-listings.csv', [['Product', (p) => p.name], ['Code', (p) => p.code], ['Seller', (p) => p.shopName], ['Category', (p) => p.category], ['Status', (p) => p.status], ['Reason', (p) => p.reason], ['Updated', (p) => isoDate(p.updatedAt)]], listings);
  }
  return Response.json({ ...page, rows: listings, counts: moderationCounts() });
}

export function listingDetail(id) {
  const row = getDb().prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that product.');
  const history = getDb().prepare('SELECT action, actor, reason, at FROM product_reviews WHERE product_id = ? ORDER BY id DESC').all(id);
  return { ...toListing(row), history };
}

const DECISIONS = {
  reinstate: { from: ['suspended'], status: 'live', title: 'Your product is back on sale', body: (name) => `${name} was reinstated and is on the marketplace again.` },
  suspend: { from: ['live'], status: 'suspended', needsReason: true, title: 'Your product was suspended', body: (name, reason) => `${name} was removed from the marketplace: ${reason}` },
};

export function decideListing(admin, id, action, reason) {
  const decision = Object.hasOwn(DECISIONS, action) ? DECISIONS[action] : null;
  if (!decision) throw new ApiError(400, 'Unknown action.');
  const db = getDb();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that product.');
  if (!decision.from.includes(row.status)) throw new ApiError(409, 'This product has changed. Refresh and try again.');
  const text = String(reason || '').trim();
  if (decision.needsReason && (text.length < 10 || text.length > 500)) throw new ApiError(422, 'Enter a reason of 10 to 500 characters.', { reason: 'Enter a reason of 10 to 500 characters.' });

  const { name } = JSON.parse(row.data);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE products SET status = ?, violation = ?, updated_at = ? WHERE id = ?').run(decision.status, decision.needsReason ? text : null, Date.now(), id);
    recordReview(id, action, admin.username, text);
    notifySeller(row.seller, decision.title, decision.body(name, text), `/seller/products?tab=${decision.status === 'live' ? 'live' : 'violation'}`);
    audit(admin, `product.${action}`, 'product', id, { name, seller: row.seller, reason: text });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listingDetail(id);
}
