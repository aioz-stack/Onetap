'use client';

// Browser side of the product API.

import { useCallback, useEffect, useState } from 'react';
import { Auth } from './store';
import { isSellerApp } from './ui';
import { LIMITS } from './products';

export class ApiFailure extends Error {
  constructor(message, fields) {
    super(message);
    this.fields = fields;
  }
}

export async function send(url, options, role = 'seller') {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new ApiFailure('We could not reach the server. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  // An expired session: dropping the local copy sends the seller to the login page.
  if (response.status === 401) Auth.clearAccount(role);
  // A seller who was suspended while working in Seller Centre. Elsewhere, they can keep browsing.
  if (response.status === 403 && role === 'seller' && isSellerApp(window.location.pathname)) window.location.assign('/seller/application');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiFailure(body.error || 'Something went wrong. Please try again.', body.fields);
  return body;
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

// Couriers and rates from the server. Public, and never includes API details.
export const logisticsOptions = () => fetch('/api/logistics/options').then((response) => response.json()).then((body) => body.partners);

export const Products = {
  list: () => send('/api/seller/products').then((body) => body.products),
  get: (id) => send(`/api/seller/products/${id}`).then((body) => body.product),
  create: (product, action) => send('/api/seller/products', json('POST', { product, action })).then((body) => body.product),
  update: (id, product, action) => send(`/api/seller/products/${id}`, json('PUT', { product, action })).then((body) => body.product),
  setStatus: (id, action) => send(`/api/seller/products/${id}`, json('PATCH', { action })).then((body) => body.product),
  remove: (id) => send(`/api/seller/products/${id}`, { method: 'DELETE' }),
  async upload(file) {
    const form = new FormData();
    form.append('file', file);
    return (await send('/api/uploads', { method: 'POST', body: form })).url;
  },
};

// Loads the seller's products.
export function useSellerProducts() {
  const [state, setState] = useState({ loading: true, error: '', products: [] });

  const load = useCallback(async () => {
    try {
      setState({ loading: false, error: '', products: await Products.list() });
    } catch (err) {
      setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ApiFailure('That image could not be read.'));
    };
    image.src = url;
  });
}

function readVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ApiFailure('That video could not be read. Use an MP4 file.'));
    };
    video.src = url;
  });
}

export async function uploadImage(file, { square = true } = {}) {
  if (!LIMITS.imageTypes[file.type]) throw new ApiFailure('Use a JPG, PNG or WebP image.');
  if (file.size > LIMITS.imageBytes) throw new ApiFailure('Images must be 5 MB or smaller.');
  const image = await readImage(file);
  if (square && image.naturalWidth !== image.naturalHeight) {
    throw new ApiFailure(`Images must be square (1:1). This one is ${image.naturalWidth} × ${image.naturalHeight}.`);
  }
  return Products.upload(file);
}

export async function uploadVideo(file) {
  if (file.type !== 'video/mp4') throw new ApiFailure('Use an MP4 video.');
  if (file.size > LIMITS.videoBytes) throw new ApiFailure('Videos must be 30 MB or smaller.');
  const video = await readVideo(file);
  const [min, max] = LIMITS.videoSeconds;
  if (video.duration < min || video.duration > max) throw new ApiFailure(`Videos must be ${min} to ${max} seconds long. This one is ${Math.round(video.duration)}.`);
  if (video.videoWidth < 1 || video.videoHeight < 1) throw new ApiFailure('Videos must be at least 1 × 1 pixels.');
  const url = await Products.upload(file);
  return { url, duration: Math.round(video.duration), width: video.videoWidth, height: video.videoHeight, size: file.size };
}
