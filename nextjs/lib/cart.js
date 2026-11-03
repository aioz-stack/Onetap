'use client';

// The buyer's cart. A signed-in customer's cart lives in the database (/api/cart), so it follows
// them to other devices; a guest's stays in this browser and joins their account when they log in.
// Either way Store 'cart' holds the current copy, oldest item first, so the header count and every
// open tab stay in step. Each change shows at once and is then saved; if saving fails, the copy is
// read back from the server. Checkout orders only the ticked items, and the server decides prices.

import { useEffect } from 'react';
import { PRODUCTS } from './data';
import { send } from './productsApi';
import { Auth, Store, useStored } from './store';
import { toast } from './ui';

const EMPTY = [];
const MAX_QTY = 99;
const SYNC_MS = 30000;

export const isSampleItem = (key) => PRODUCTS.some((product) => product.id === key);

// Items as { key, qty, selected, addedAt }. Carts saved before items had these were { key: qty }.
export function cartItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([key, qty], i) => ({ key, qty: Number(qty) || 1, selected: !isSampleItem(key), addedAt: i + 1 }));
  return EMPTY;
}

export const useCart = () => cartItems(useStored('cart', EMPTY));
export const cartCount = (items) => items.reduce((sum, item) => sum + item.qty, 0);

const json = (data) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const current = () => cartItems(Store.get('cart', EMPTY));
const save = (items) => Store.set('cart', items);
const signedIn = () => Boolean(Auth.session('customer'));

// Requests go one at a time, so the last response is the latest cart.
let queue = Promise.resolve();
function remote(data) {
  if (!signedIn()) return queue;
  queue = queue
    .then(() => send('/api/cart', json(data), 'customer'))
    .then((body) => save(body.items))
    .catch((err) => {
      toast(err.message, 'error');
      return Cart.sync();
    });
  return queue;
}

function setItem(key, qty) {
  const items = current();
  const existing = items.find((item) => item.key === key);
  const next = Math.max(0, Math.min(qty, MAX_QTY));
  if (!next) save(items.filter((item) => item.key !== key));
  else if (existing) save(items.map((item) => (item.key === key ? { ...item, qty: next } : item)));
  else save([...items, { key, qty: next, selected: !isSampleItem(key), addedAt: Date.now() }]);
}

export const Cart = {
  change(key, delta) {
    setItem(key, (current().find((item) => item.key === key)?.qty || 0) + delta);
    return remote({ action: 'change', key, delta });
  },
  remove(key) {
    setItem(key, 0);
    return remote({ action: 'change', key, qty: 0 });
  },
  // Ticks or unticks some items, or all of them when keys is null. Demo products are never ticked.
  select(keys, selected) {
    save(current().map((item) => ((!keys || keys.includes(item.key)) ? { ...item, selected: selected && !isSampleItem(item.key) } : item)));
    return remote(keys ? { action: 'select', keys, selected } : { action: 'select', all: true, selected });
  },
  // Reads the signed-in customer's cart, first bringing in what they added as a guest. Logging out
  // clears this browser's copy; the account keeps its cart.
  async sync() {
    const customer = Auth.session('customer');
    const owner = Store.get('cartOwner', '');
    if (!customer) {
      if (owner) {
        save(EMPTY);
        Store.remove('cartOwner');
      } else if (!Array.isArray(Store.get('cart', EMPTY))) {
        save(current());
      }
      return;
    }
    try {
      const guest = owner === customer.username ? EMPTY : owner ? EMPTY : current();
      const body = guest.length
        ? await send('/api/cart', json({ action: 'merge', items: guest }), 'customer')
        : await send('/api/cart', undefined, 'customer');
      if (Auth.session('customer')?.username !== customer.username) return;
      save(body.items);
      Store.set('cartOwner', customer.username);
    } catch {
      // Offline or signed out: keep the copy we have.
    }
  },
};

// Keeps the cart in step with the account: on load, on logging in or out, when the window is
// looked at again, and every 30 seconds for changes made on another device.
export function CartSync() {
  useEffect(() => {
    const sync = () => Cart.sync();
    sync();
    document.addEventListener('onetap:session', sync);
    window.addEventListener('focus', sync);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, SYNC_MS);
    return () => {
      document.removeEventListener('onetap:session', sync);
      window.removeEventListener('focus', sync);
      clearInterval(timer);
    };
  }, []);
  return null;
}
