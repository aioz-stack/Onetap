// Product storage. Every seller query is scoped to the seller making the request.

import { randomUUID } from 'node:crypto';
import { validateProduct } from '../products';
import { shopNameOf } from './auth';
import { getDb } from './db';
import { ApiError } from './errors';
import { recordReview } from './moderation';

function toProduct(row) {
  return {
    ...JSON.parse(row.data),
    id: row.id,
    seller: row.seller,
    shopName: row.shop_name,
    status: row.status,
    violation: row.violation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findRow(seller, id) {
  const row = getDb().prepare('SELECT * FROM products WHERE id = ? AND seller = ?').get(id, seller);
  if (!row) throw new ApiError(404, 'We could not find that product.');
  return row;
}

function cleanProduct(input, action) {
  if (!['publish', 'delist'].includes(action)) throw new ApiError(400, 'Unknown action.');
  const { id, seller, shopName, status, violation, createdAt, updatedAt, ...product } = input;
  if (typeof product.name !== 'string' || typeof product.code !== 'string') throw new ApiError(400, 'That product data is not valid.');
  return { ...product, name: product.name.trim(), code: product.code.trim() };
}

function checkProduct(product, action) {
  let errors;
  try {
    errors = validateProduct(product, action === 'publish' ? 'publish' : 'draft');
  } catch {
    throw new ApiError(400, 'That product data is not valid.');
  }
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
}

function checkCode(seller, code, id = '') {
  const taken = getDb().prepare('SELECT id FROM products WHERE seller = ? AND code = ? AND id <> ?').get(seller, code, id);
  if (taken) throw new ApiError(409, 'You already use that product code.', { code: 'You already use that product code.' });
}

const statusFor = (action) => (action === 'publish' ? 'live' : 'unpublished');
const SUSPENDED = 'An administrator suspended this product, so it can\'t be published or unpublished.';

export function listProducts(seller) {
  const rows = getDb().prepare('SELECT * FROM products WHERE seller = ? ORDER BY updated_at DESC').all(seller);
  return rows.map(toProduct);
}

export function getProduct(seller, id) {
  return toProduct(findRow(seller, id));
}

export function createProduct(seller, input, action) {
  const product = cleanProduct(input, action);
  checkProduct(product, action);
  checkCode(seller, product.code);
  const id = randomUUID();
  const now = Date.now();
  const status = statusFor(action);
  getDb().prepare(`
    INSERT INTO products (id, seller, shop_name, code, status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, seller, shopNameOf(seller), product.code, status, JSON.stringify(product), now, now);
  if (status === 'live') recordReview(id, 'published', seller);
  return getProduct(seller, id);
}

// A suspended product can be edited, but only an administrator can put it back on sale.
export function updateProduct(seller, id, input, action) {
  const row = findRow(seller, id);
  const product = cleanProduct(input, action);
  checkProduct(product, action);
  checkCode(seller, product.code, id);
  const status = row.status === 'suspended' ? 'suspended' : statusFor(action);
  getDb().prepare(`
    UPDATE products SET code = ?, status = ?, violation = ?, data = ?, updated_at = ? WHERE id = ?
  `).run(product.code, status, status === 'suspended' ? row.violation : null, JSON.stringify(product), Date.now(), id);
  if (status === 'live') recordReview(id, 'published', seller);
  return getProduct(seller, id);
}

export function changeStatus(seller, id, action) {
  const row = findRow(seller, id);
  if (row.status === 'suspended') throw new ApiError(409, SUSPENDED);
  if (action === 'publish') checkProduct(JSON.parse(row.data), 'publish');
  else if (action !== 'unpublish') throw new ApiError(400, 'Unknown action.');
  const status = statusFor(action);
  getDb().prepare('UPDATE products SET status = ?, violation = NULL, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  if (status === 'live') recordReview(id, 'published', seller);
  return getProduct(seller, id);
}

export function deleteProduct(seller, id) {
  findRow(seller, id);
  getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
}

export function listLiveProducts() {
  const rows = getDb().prepare(`
    SELECT p.* FROM products p JOIN seller_applications a ON a.username = p.seller
    WHERE p.status = 'live' AND a.status = 'approved' ORDER BY p.updated_at DESC
  `).all();
  return rows.map(toProduct);
}
