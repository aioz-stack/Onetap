'use client';

// The buyer's side of orders.

import { useCallback, useEffect, useState } from 'react';
import { send } from './productsApi';

const json = (data) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const Purchases = {
  list: () => send('/api/orders', undefined, 'customer').then((body) => body.orders),
  place: (order) => send('/api/orders', json(order), 'customer').then((body) => body.orders),
  act: (ids, action, data) => send('/api/orders/actions', json({ ids, action, data }), 'customer').then((body) => body.orders),
};

const REFRESH_MS = 15000;

export function usePurchases() {
  const [state, setState] = useState({ orders: [], loading: true, error: '' });

  const reload = useCallback(async () => {
    try {
      setState({ orders: await Purchases.list(), loading: false, error: '' });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  // Tracking moves as couriers and riders report, so the buyer's pages check every 15 seconds too.
  useEffect(() => {
    reload();
    const timer = setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  return { ...state, reload };
}
