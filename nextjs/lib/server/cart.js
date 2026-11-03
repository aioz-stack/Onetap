// A signed-in customer's cart (cart_items), keyed by their username. Each row is a product, or a
// product and variation (`id::variation`), with its quantity, whether it is ticked for checkout and
// when it was added. Checkout takes the ticked rows from here (`checkoutLines`) and removes what was
// ordered in the same transaction (`removeOrdered`), so unticked items stay. Prices and stock are
// never kept here: checkout reads them from the products.

import { PRODUCTS } from '../data';
import { getDb } from './db';
import { ApiError } from './errors';
import { transaction } from './shipments';

const db = () => getDb();
const now = () => Date.now();
export const MAX_CART_ITEMS = 100;
export const MAX_CART_QTY = 99;

const toItem = (row) => ({ key: row.item_key, qty: row.qty, selected: Boolean(row.selected), addedAt: row.added_at });

// Oldest first, so the cart keeps the order things were added in.
export function readCart(customer) {
  return db().prepare('SELECT * FROM cart_items WHERE customer = ? ORDER BY added_at, rowid').all(customer).map(toItem);
}

const isSample = (key) => PRODUCTS.some((product) => product.id === key);

// A key must name a demo product or a product that exists. Listings that later go off sale stay in
// the cart, and checkout refuses them.
function checkKey(key) {
  if (typeof key !== 'string' || !key || key.length > 200) throw new ApiError(400, 'That item could not be read.');
  if (isSample(key)) return key;
  const [id, variation = ''] = key.split('::');
  if (variation.length > 150 || !db().prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new ApiError(404, 'That product is no longer available.');
  return key;
}

function checkQty(value) {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 0) throw new ApiError(400, 'Quantities must be whole numbers.');
  return Math.min(qty, MAX_CART_QTY);
}

function setQty(customer, key, qty, time) {
  if (qty <= 0) {
    db().prepare('DELETE FROM cart_items WHERE customer = ? AND item_key = ?').run(customer, key);
    return;
  }
  const changed = db().prepare('UPDATE cart_items SET qty = ?, updated_at = ? WHERE customer = ? AND item_key = ?').run(qty, time, customer, key).changes;
  if (changed) return;
  const count = db().prepare('SELECT COUNT(*) AS c FROM cart_items WHERE customer = ?').get(customer).c;
  if (count >= MAX_CART_ITEMS) throw new ApiError(409, `Your cart holds up to ${MAX_CART_ITEMS} different items. Check out or remove some first.`);
  // A new item is ticked, unless it is a demo product, which can't be bought.
  db().prepare('INSERT INTO cart_items (customer, item_key, qty, selected, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(customer, key, qty, isSample(key) ? 0 : 1, time, time);
}

const qtyOf = (customer, key) => db().prepare('SELECT qty FROM cart_items WHERE customer = ? AND item_key = ?').get(customer, key)?.qty || 0;

// One request from the cart: change a quantity by `delta` or set it with `qty`, tick or untick
// items (`keys`, or every item when `all`), or bring in a guest's cart after they log in (`merge`).
export function updateCart(customer, input) {
  const action = input?.action;
  transaction(() => {
    const time = now();
    if (action === 'change') {
      const key = checkKey(input.key);
      const qty = input.qty !== undefined ? checkQty(input.qty) : Math.max(0, Math.min(qtyOf(customer, key) + Math.trunc(Number(input.delta) || 0), MAX_CART_QTY));
      setQty(customer, key, qty, time);
    } else if (action === 'select') {
      const selected = input.selected ? 1 : 0;
      if (input.all) {
        db().prepare('UPDATE cart_items SET selected = ?, updated_at = ? WHERE customer = ?').run(selected, time, customer);
      } else {
        if (!Array.isArray(input.keys) || input.keys.length > MAX_CART_ITEMS) throw new ApiError(400, 'Choose the items to select.');
        const update = db().prepare('UPDATE cart_items SET selected = ?, updated_at = ? WHERE customer = ? AND item_key = ?');
        input.keys.forEach((key) => update.run(selected, time, customer, String(key)));
      }
      // Demo products are never ticked.
      PRODUCTS.forEach((product) => db().prepare('UPDATE cart_items SET selected = 0 WHERE customer = ? AND item_key = ?').run(customer, product.id));
    } else if (action === 'merge') {
      // A guest's items join the account's cart, keeping when they were added. Anything that no
      // longer exists is skipped rather than failing the whole cart.
      if (!Array.isArray(input.items) || input.items.length > MAX_CART_ITEMS) throw new ApiError(400, 'That cart could not be read.');
      input.items.forEach((item) => {
        let key;
        try {
          key = checkKey(item?.key);
        } catch {
          return;
        }
        const qty = Math.min(qtyOf(customer, key) + checkQty(item.qty), MAX_CART_QTY);
        const addedAt = Number.isFinite(Number(item.addedAt)) && Number(item.addedAt) > 0 && Number(item.addedAt) <= time ? Number(item.addedAt) : time;
        try {
          setQty(customer, key, qty, addedAt);
        } catch {
          // A full cart keeps what it has.
        }
        if (item.selected === false) db().prepare('UPDATE cart_items SET selected = 0 WHERE customer = ? AND item_key = ?').run(customer, key);
      });
    } else {
      throw new ApiError(400, 'That cart change could not be read.');
    }
  });
  return readCart(customer);
}

// The ticked items checkout orders, as order lines. Demo products are left out: they can't be bought.
export function checkoutLines(customer) {
  return readCart(customer).filter((item) => item.selected && !isSample(item.key)).map((item) => {
    const [productId, variation = ''] = item.key.split('::');
    return { key: item.key, productId, variation, qty: item.qty };
  });
}

// Takes what was ordered out of the cart. Runs inside the checkout's transaction.
export function removeOrdered(customer, lines) {
  const time = now();
  lines.forEach((line) => setQty(customer, line.key, qtyOf(customer, line.key) - line.qty, time));
}
