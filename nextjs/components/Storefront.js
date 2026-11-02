'use client';

// Storefront state, product grid, cart and the home carousel.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openCustomerLogin } from './Auth';
import Icon from './Icon';
import { RichText } from './RichText';
import { CATEGORIES, PRODUCT_CATEGORIES, PRODUCTS } from '@/lib/data';
import { Chat } from '@/lib/chat';
import { salePrice, saleRows, totalStock } from '@/lib/products';
import { Auth, Store, useStored } from '@/lib/store';
import { createState, Modal, peso, toast } from '@/lib/ui';

const StorefrontContext = createContext(null);
export const useStorefront = () => useContext(StorefrontContext);

function scrollToDeals() {
  document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
}

export function StorefrontProvider({ children }) {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  const goToDeals = useCallback(() => {
    if (pathname === '/') scrollToDeals();
    else router.push('/#products');
  }, [pathname, router]);

  const search = useCallback((text) => {
    setQuery(text.trim());
    setCategory('All');
    goToDeals();
  }, [goToDeals]);

  const value = useMemo(
    () => ({ category, setCategory, query, setQuery, search, goToDeals }),
    [category, query, search, goToDeals],
  );
  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

function matches(product, category, query) {
  const inCategory = category === 'All' || product.category === category;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${product.name} ${product.category}`.toLowerCase();
  return inCategory && words.every((w) => text.includes(w));
}

export const Cart = {
  change(id, delta) {
    const items = Store.get('cart', {});
    const qty = (items[id] || 0) + delta;
    if (qty > 0) items[id] = qty;
    else delete items[id];
    Store.set('cart', items);
  },
};

// Products sellers have published, in the shape the sample products use.
export const liveProducts = createState([]);

function toStoreProduct(listing) {
  const rows = saleRows(listing).filter((row) => Number(row.stock) > 0);
  const cheapest = (rows.length ? rows : saleRows(listing)).reduce((best, row) => (salePrice(row) < salePrice(best) ? row : best));
  return {
    id: listing.id,
    name: listing.name,
    category: PRODUCT_CATEGORIES.find((c) => c.name === listing.category)?.store,
    price: salePrice(cheapest),
    variation: listing.variations.enabled ? cheapest.key : '',
    was: Number(cheapest.price),
    image: listing.images[0],
    shop: `seller:${listing.seller}`,
    listing,
  };
}

export function loadLiveProducts() {
  return fetch('/api/products')
    .then((response) => (response.ok ? response.json() : { products: [] }))
    .then(({ products }) => liveProducts.set(products.map(toStoreProduct)))
    .catch(() => {});
}

// Cart keys are product ids, plus the variation for seller listings that have them.
export function findCartItem(key, live) {
  const sample = PRODUCTS.find((item) => item.id === key);
  if (sample) return sample;
  const [id, variation] = key.split('::');
  const product = live.find((item) => item.id === id);
  if (!product) return null;
  if (!variation) return product;
  const row = saleRows(product.listing).find((other) => other.key === variation);
  return row && { ...product, id: key, variation, name: `${product.name} (${variation})`, price: salePrice(row) };
}

function addToCart(key, name) {
  Cart.change(key, 1);
  toast(`Added ${name} to your cart.`, 'success');
}

function QuickView({ product }) {
  const { listing } = product;
  const rows = saleRows(listing);
  const hasVariations = listing.variations.enabled;
  const [selected, setSelected] = useState(rows.find((row) => Number(row.stock) > 0) || rows[0]);
  const stock = Number(selected.stock) || 0;

  return (
    <div className="quick-view">
      <div className="quick-view__images">
        {listing.images.map((url, i) => <img src={url} alt={`${listing.name}, image ${i + 1}`} key={url} />)}
      </div>
      {listing.video && <video src={listing.video.url} controls preload="metadata" aria-label={`${listing.name} video`} />}
      <p className="product__price">{peso(salePrice(selected))} {Number(selected.promo) > 0 && <s>{peso(Number(selected.price))}</s>}</p>
      <p className="muted">{listing.shopName} · {listing.condition} · {stock} in stock{listing.preOrder ? ` · Pre-order, ships in ${listing.preOrderDays} days` : ''}</p>
      {hasVariations && (
        <div className="chips" role="group" aria-label="Choose a variation">
          {rows.map((row) => (
            <button className="chip" type="button" key={row.key} aria-pressed={row.key === selected.key} disabled={!Number(row.stock)} onClick={() => setSelected(row)}>{row.key}</button>
          ))}
        </div>
      )}
      <button
        className="btn btn--primary btn--block"
        type="button"
        disabled={!stock}
        onClick={() => {
          addToCart(hasVariations ? `${product.id}::${selected.key}` : product.id, listing.name);
          Modal.close();
        }}
      >
        {stock ? 'Add to Cart' : 'Sold Out'}
      </button>
      <RichText blocks={listing.description} />
      {listing.specs.some((spec) => spec.value.trim()) && (
        <dl className="shop-info">
          {listing.specs.filter((spec) => spec.value.trim()).map((spec) => <div className="shop-info__row" key={spec.name}><dt>{spec.name}</dt><dd>{spec.value}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

function openQuickView(product) {
  Modal.open({ title: product.name, variant: 'wide', content: <QuickView product={product} /> });
}

function ProductCard({ product: p }) {
  const off = Math.round((1 - p.price / p.was) * 100);
  const soldOut = p.listing && !totalStock(p.listing);
  return (
    <article className="product">
      <div className="product__image" style={{ '--tint': p.tint }}>
        {p.image ? <img src={p.image} alt="" /> : <span aria-hidden="true">{p.emoji}</span>}
        {off > 0 && <span className="product__off">-{off}%</span>}
      </div>
      <div className="product__body">
        {p.listing ? <h3><button className="product__name" type="button" onClick={() => openQuickView(p)}>{p.name}</button></h3> : <h3>{p.name}</h3>}
        <p className="product__price">{peso(p.price)} {off > 0 && <s>{peso(p.was)}</s>}</p>
        {p.listing
          ? <p className="product__meta">{p.listing.shopName}</p>
          : <p className="product__meta"><Icon name="star" className="icon icon--sm" /> {p.rating} · {p.sold} sold</p>}
        <div className="product__actions">
          <button
            className="btn btn--primary btn--sm"
            type="button"
            disabled={soldOut}
            onClick={() => {
              if (p.listing?.variations.enabled) openQuickView(p);
              else addToCart(p.id, p.name);
            }}
          >
            {soldOut ? 'Sold Out' : 'Add to Cart'}
          </button>
          <button
            className="icon-btn icon-btn--bordered"
            type="button"
            aria-label={`Chat with seller about ${p.name}`}
            onClick={() => Chat.openShop(p.shop, `Hi! Is "${p.name}" available?`)}
          >
            <Icon name="chat" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Deals() {
  const { category, setCategory, query } = useStorefront();
  const live = liveProducts.use();
  const list = [...live, ...PRODUCTS].filter((p) => matches(p, category, query));

  useEffect(() => {
    loadLiveProducts();
  }, []);

  let status = '';
  if (query) status = `${list.length} ${list.length === 1 ? 'result' : 'results'} for "${query}"`;
  else if (!list.length) status = 'No products in this category.';

  return (
    <section className="container deals" id="products" aria-labelledby="deals-title">
      <div className="deals__head">
        <h2 id="deals-title">Today&apos;s Deals</h2>
        <div className="chips" role="group" aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <button className="chip" type="button" key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
      </div>
      <p className="deals__status" role="status">{status}</p>
      <div className="product-grid">
        {list.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

// Scrolls smoothly on the home page; without scripts it is still a normal link.
export function DealsLink({ children, ...props }) {
  const { goToDeals } = useStorefront();
  return (
    <Link
      href="/#products"
      {...props}
      onClick={(e) => {
        e.preventDefault();
        goToDeals();
      }}
    >
      {children}
    </Link>
  );
}

function CartView() {
  const { goToDeals } = useStorefront();
  const router = useRouter();
  const items = useStored('cart', {});
  const live = liveProducts.use();
  const rows = Object.entries(items)
    .map(([id, qty]) => ({ p: findCartItem(id, live), qty }))
    .filter((row) => row.p);

  useEffect(() => {
    loadLiveProducts();
  }, []);

  if (!rows.length) {
    return (
      <div className="empty">
        <p>Your cart is empty.</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => {
            Modal.close();
            goToDeals();
          }}
        >
          Browse Deals
        </button>
      </div>
    );
  }

  const total = rows.reduce((sum, { p, qty }) => sum + p.price * qty, 0);
  return (
    <>
      <ul className="cart-list">
        {rows.map(({ p, qty }) => (
          <li className="cart-row" key={p.id}>
            <span className="cart-row__image" style={{ '--tint': p.tint }} aria-hidden="true">{p.image ? <img src={p.image} alt="" /> : p.emoji}</span>
            <div className="cart-row__text">
              <strong>{p.name}</strong>
              <span>{peso(p.price * qty)}</span>
              <div className="stepper">
                <button type="button" aria-label={`Remove one ${p.name}`} onClick={() => Cart.change(p.id, -1)}>−</button>
                <span aria-label="Quantity">{qty}</span>
                <button type="button" aria-label={`Add one ${p.name}`} onClick={() => Cart.change(p.id, 1)}>+</button>
              </div>
            </div>
            <button className="icon-btn" type="button" aria-label={`Delete ${p.name} from cart`} onClick={() => Cart.change(p.id, -qty)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <div className="cart-total"><span>Subtotal</span><strong>{peso(total)}</strong></div>
      <button
        className="btn btn--primary btn--block"
        type="button"
        onClick={() => {
          const customer = Auth.session('customer');
          if (customer && customer.approvalStatus !== 'approved') {
            toast(customer.approvalStatus === 'rejected' ? 'Your registration was not approved. Send a new ID from the notice at the top of the page.' : 'You can check out once your account is approved. We\'ll notify you.');
          } else if (customer) {
            Modal.close();
            router.push('/checkout');
          } else {
            toast('Log in to check out.');
            openCustomerLogin();
          }
        }}
      >
        Checkout
      </button>
    </>
  );
}

export function openCart() {
  Modal.open({ title: 'Your Cart', variant: 'drawer', content: <CartView /> });
}

function claimVouchers() {
  if (!Auth.session('customer')) {
    toast('Log in or sign up to claim your vouchers.');
    openCustomerLogin();
    return;
  }
  if (Auth.session('customer').approvalStatus !== 'approved') {
    toast('You can claim vouchers once your account is approved.');
    return;
  }
  if (Store.get('vouchersClaimed')) {
    toast('You already claimed today\'s vouchers.');
    return;
  }
  Store.set('vouchersClaimed', true);
  toast('Vouchers claimed! They will apply at checkout.', 'success');
}

const SLIDE_COUNT = 3;

export function Carousel() {
  const { goToDeals } = useStorefront();
  const [index, setIndex] = useState(0);
  const timer = useRef(null);

  const stop = useCallback(() => clearInterval(timer.current), []);
  const start = useCallback(() => {
    clearInterval(timer.current);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % SLIDE_COUNT), 6000);
  }, []);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  return (
    <div className="carousel" aria-roledescription="carousel" aria-label="Featured offers" onMouseEnter={stop} onMouseLeave={start} onFocus={stop}>
      <article className="slide slide--vip" hidden={index !== 0}>
        <span className="pill"><Icon name="star" /> Onetap VIP Member Club</span>
        <h1 className="slide__title">Unlock Exclusive<br />Savings &amp; Free Shipping!</h1>
        <p className="slide__text">Get up to 20% OFF vouchers daily + ₱0 minimum spend delivery nationwide.</p>
        <div className="slide__actions">
          <button className="btn btn--white" type="button" onClick={claimVouchers}>Claim Vouchers Now</button>
          <span className="slide__note">Limited Daily Slots</span>
        </div>
      </article>
      <article className="slide slide--flash" hidden={index !== 1}>
        <span className="pill"><Icon name="star" /> Payday Flash Sale</span>
        <h2 className="slide__title">Big Brands,<br />Bigger Payday Deals</h2>
        <p className="slide__text">Fresh markdowns on gadgets, fashion and home essentials every day.</p>
        <div className="slide__actions">
          <button className="btn btn--white" type="button" onClick={goToDeals}>Shop Today&apos;s Deals</button>
          <span className="slide__note">While Stocks Last</span>
        </div>
      </article>
      <article className="slide slide--seller" hidden={index !== 2}>
        <span className="pill"><Icon name="star" /> Onetap Sellers</span>
        <h2 className="slide__title">Open Your Shop<br />in One Tap</h2>
        <p className="slide__text">Register your store and start reaching shoppers nationwide.</p>
        <div className="slide__actions">
          <Link className="btn btn--white" href="/seller/register">Start Selling</Link>
          <span className="slide__note">Free to Join</span>
        </div>
      </article>
      <div className="carousel__dots" role="group" aria-label="Choose slide">
        {Array.from({ length: SLIDE_COUNT }, (_, i) => (
          <button type="button" key={i} aria-label={`Show slide ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  );
}
