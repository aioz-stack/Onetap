'use client';

// Shared UI state that any component or plain function can drive: toasts, modal, theme.

import { useSyncExternalStore } from 'react';
import { I18N } from './data';
import { Store, useStored } from './store';

export function peso(amount) {
  return `₱${amount.toLocaleString('en-PH')}`;
}

// Seller Centre, the Admin Console, the Logistics Partner Panel and the Rider Panel have their own bars in place of the store header and footer.
export function isSellerApp(pathname) {
  return ['/seller/dashboard', '/seller/orders', '/seller/products', '/seller/chat', '/seller/income', '/seller/balance', '/seller/bank-accounts', '/admin', '/courier', '/rider'].some((path) => pathname.startsWith(path));
}

export function notBuilt(label) {
  toast(`${label} isn't available yet.`);
}

// A small observable value, for state owned by one host component but set from anywhere.
export function createState(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? next(value) : next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use() {
      return useSyncExternalStore(this.subscribe, this.get, () => initial);
    },
  };
}

export const toasts = createState([]);
let nextToastId = 0;

export function toast(message, type = 'info') {
  nextToastId += 1;
  const id = nextToastId;
  toasts.set((list) => [...list, { id, message, type }]);
  setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 3800);
}

export const modalState = createState({ open: false, key: 0, title: '', variant: '', content: null });

export const Modal = {
  open({ title, content, variant = '' }) {
    modalState.set(({ key }) => ({ open: true, key: key + 1, title, variant, content }));
  },

  close() {
    if (modalState.get().open) modalState.set((state) => ({ ...state, open: false }));
  },
};

const themeListeners = new Set();

export const Theme = {
  current() {
    return document.documentElement.dataset.theme;
  },

  apply(theme) {
    document.documentElement.dataset.theme = theme;
    themeListeners.forEach((listener) => listener());
  },

  toggle() {
    const next = this.current() === 'dark' ? 'light' : 'dark';
    Store.set('theme', next);
    this.apply(next);
  },

  subscribe(listener) {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  },

  use() {
    return useSyncExternalStore(this.subscribe, () => this.current(), () => 'light');
  },
};

export function useLanguage() {
  const lang = useStored('lang', 'en');
  return { lang, t: I18N[lang] || I18N.en };
}
