'use client';

// Seller Centre dashboard. Today's stats are zero until a backend exists, and most
// entries show a notice. See "Mocked parts" in AGENTS.md.

import Link from 'next/link';
import { useRef } from 'react';
import { Form, Sections } from './Forms';
import Icon from './Icon';
import { AFFILIATE, BEST_PRICE, PRODUCTS, SELLER_ANNOUNCEMENTS, SELLER_CAMPAIGNS, SELLER_INSIGHTS } from '@/lib/data';
import { needsResponse, useOrders } from '@/lib/orders';
import { useSellerProducts } from '@/lib/productsApi';
import { commissionSchema } from '@/lib/schemas';
import { FieldError, Store, useStored } from '@/lib/store';
import { notBuilt, peso, toast } from '@/lib/ui';

const productsById = (ids) => ids.map((id) => PRODUCTS.find((p) => p.id === id));

function Panel({ title, note, more, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel__head">
        <h2>{title}</h2>
        {note && <p className="panel__note">{note}</p>}
        {more && (
          <button className="panel__more" type="button" onClick={() => notBuilt(more)}>
            More<span className="sr-only"> {more}</span> <Icon name="chevron" className="icon icon--sm icon--right" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function TodoStrip() {
  const { orders, loading: ordersLoading } = useOrders();
  const { products, loading: productsLoading } = useSellerProducts();
  const pending = orders.filter(needsResponse);
  const orderCount = (count) => (ordersLoading ? '–' : count);
  const items = [
    { label: 'To-Process Shipment', count: orderCount(orders.filter((o) => o.status === 'to_ship').length), href: '/seller/orders/to-ship' },
    { label: 'Processed Shipment', count: orderCount(orders.filter((o) => o.status === 'ready').length), href: '/seller/orders/to-ship?tab=ready' },
    { label: 'Return / Refunds / Cancel', count: orderCount(pending.length), href: '/seller/orders/returns' },
    { label: 'Banned / Deboosted Products', count: productsLoading ? '–' : products.filter((p) => p.status === 'violation').length, href: '/seller/products?tab=violation' },
    { label: 'Join Best Price', count: 0 },
  ];
  return (
    <section className="panel" aria-label="To do">
      <ul className="todo">
        {items.map((item) => (
          <li key={item.label}>
            {item.href ? (
              <Link href={item.href}><strong>{item.count}</strong><span>{item.label}</span></Link>
            ) : (
              <button type="button" onClick={() => notBuilt(item.label)}><strong>{item.count}</strong><span>{item.label}</span></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BusinessInsights() {
  return (
    <Panel title="Business Insights" note="Compared to yesterday, GMT+8" more="Business Insights">
      <dl className="insights">
        {SELLER_INSIGHTS.map((item) => (
          <div key={item.label}>
            <dt>
              {item.label}
              <span className="insights__hint" title={item.hint}><Icon name="help" className="icon icon--sm" /><span className="sr-only">: {item.hint}</span></span>
            </dt>
            <dd>{item.value}</dd>
            <dd className="insights__change">— 0.00%</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function BestPrice() {
  const track = useRef(null);
  const scroll = (direction) => track.current.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <Panel title="Best Price on Onetap" more="Best Price on Onetap">
      <div className="winners">
        <strong>Last 7 days winner performance</strong>
        <ul>
          {BEST_PRICE.stats.map(([label, value]) => (
            <li key={label}>{label} <strong>{value}</strong> <Icon name="chart" className="icon icon--sm" /></li>
          ))}
        </ul>
      </div>
      <div className="deal-rail">
        <button className="deal-rail__btn deal-rail__btn--prev" type="button" aria-label="Previous products" onClick={() => scroll(-1)}><Icon name="arrow-left" className="icon icon--sm" /></button>
        <ul className="deal-rail__track" ref={track} tabIndex={0} aria-label="Products to match">
          {productsById(BEST_PRICE.products).map((p) => (
            <li className="deal" key={p.id}>
              <span className="deal__image" style={{ '--tint': p.tint }} aria-hidden="true">{p.emoji}</span>
              <span className="deal__text">
                <strong>{p.name}</strong>
                <small>Recent sales: {p.sold}</small>
                <small>Current win price: <span className="deal__price">{peso(p.price)}</span></small>
                <button className="link" type="button" onClick={() => notBuilt('Best Price matching')}>Explore<span className="sr-only"> {p.name}</span></button>
              </span>
            </li>
          ))}
        </ul>
        <button className="deal-rail__btn deal-rail__btn--next" type="button" aria-label="More products" onClick={() => scroll(1)}><Icon name="arrow-left" className="icon icon--sm icon--flip" /></button>
      </div>
    </Panel>
  );
}

function AdsPanel() {
  return (
    <Panel title="Onetap Ads" more="Onetap Ads">
      <article className="ad-card">
        <h3><Icon name="megaphone" /> Join Campaign Sales Boost to accelerate campaign sales</h3>
        <div className="ad-card__chart">
          <svg viewBox="0 0 300 96" role="img" aria-label="Sales rise higher through a campaign for shops that sign up">
            <path className="ad-card__base" d="M8 78 C 70 76, 110 66, 150 60 S 240 70, 292 74" />
            <path className="ad-card__line" d="M8 76 C 70 72, 100 40, 150 20 S 240 50, 292 62" />
            <text x="8" y="94">Pre-fest</text>
            <text x="150" y="94" textAnchor="middle">Peak day</text>
            <text x="292" y="94" textAnchor="end">Post campaign</text>
          </svg>
          <button className="btn-mini" type="button" onClick={() => notBuilt('Campaign Sales Boost')}>Join Now</button>
        </div>
      </article>
      <article className="ad-card">
        <h3><Icon name="help" /> Maximise your sales with Onetap Ads</h3>
        <p className="muted">Learn how Onetap Ads work, find the right way to advertise and keep your ad spend affordable.</p>
        <button className="btn-mini" type="button" onClick={() => notBuilt('Onetap Ads')}>Learn More</button>
      </article>
    </Panel>
  );
}

function AffiliatePanel({ username }) {
  const key = `seller.${username}.commission`;
  const commission = useStored(key, '11');
  return (
    <Panel title="Affiliate Marketing Solution" more="Affiliate Marketing">
      <dl className="mini-stats">
        {AFFILIATE.stats.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="promote">
        <h3>Promote high-potential products</h3>
        <p className="muted"><span className="promote__count">{AFFILIATE.shops}</span> shops in your category have increased sales through affiliates.</p>
        <div className="promote__row">
          <span className="promote__thumbs" aria-hidden="true">
            {productsById(AFFILIATE.products).map((p) => <span className="deal__image" style={{ '--tint': p.tint }} key={p.id}>{p.emoji}</span>)}
          </span>
          <span className="muted">Potential sales: <strong className="promote__gain">{AFFILIATE.potential}</strong></span>
        </div>
        <Form
          className="promote__form"
          onSubmit={async ({ commission: rate }) => {
            if (Number(rate) < 1 || Number(rate) > 50) throw new FieldError('commission', 'Enter a rate from 1% to 50%.');
            Store.set(key, rate);
            toast(`Commission rate set to ${rate}%.`, 'success');
          }}
        >
          <Sections schema={commissionSchema(commission)} prefix="affiliate" />
          <button className="icon-btn icon-btn--bordered" type="submit" aria-label="Save commission rate"><Icon name="check" /></button>
        </Form>
      </div>
    </Panel>
  );
}

function LivestreamPanel() {
  return (
    <Panel title="Livestream" more="Live & Video">
      <div className="live-card">
        <div>
          <h3>Start streaming now!</h3>
          <p>Show your products live and turn viewers into buyers.</p>
          <button className="btn btn--white" type="button" onClick={() => notBuilt('Livestream')}>Create Stream</button>
        </div>
        <span className="live-card__art" aria-hidden="true">🎥</span>
      </div>
    </Panel>
  );
}

function CampaignPanel({ username }) {
  const key = `seller.${username}.campaigns`;
  const joined = useStored(key, []);

  function toggle(campaign) {
    const isJoined = joined.includes(campaign.id);
    Store.set(key, isJoined ? joined.filter((id) => id !== campaign.id) : [...joined, campaign.id]);
    toast(isJoined ? `You left ${campaign.title}.` : `You joined ${campaign.title}.`, isJoined ? 'info' : 'success');
  }

  return (
    <Panel title="Campaign" more="Campaign">
      <ul className="campaigns" tabIndex={0} aria-label="Campaigns">
        {SELLER_CAMPAIGNS.map((c) => (
          <li className="campaign" key={c.id}>
            <span className={`campaign__mark campaign__mark--${c.tone}`} aria-hidden="true">{c.mark}</span>
            <span className="campaign__text">
              <strong>{c.title}</strong>
              <small>{c.note}</small>
              {c.period && <small>{c.period}</small>}
              <span className="campaign__tag">{c.tag}</span>
            </span>
            {c.view ? (
              <button className="btn-mini" type="button" onClick={() => notBuilt(c.title)}>View<span className="sr-only"> {c.title}</span></button>
            ) : (
              <button className="btn-mini" type="button" aria-pressed={joined.includes(c.id)} onClick={() => toggle(c)}>
                {joined.includes(c.id) ? 'Joined' : 'Join'}<span className="sr-only"> {c.title}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ShopPerformance() {
  return (
    <section className="panel">
      <button className="performance" type="button" onClick={() => notBuilt('Shop Performance')}>
        <h2>Shop Performance</h2>
        <strong>Excellent</strong>
        <small>All metrics are meeting the targets</small>
        <Icon name="chevron" className="icon icon--sm icon--right" />
      </button>
    </section>
  );
}

function Announcements() {
  return (
    <Panel title="Announcements" more="Announcements">
      <div className="notice-banner">
        <strong>Onetap Ads top-up update</strong>
        <span>Important changes to ad credit purchases</span>
      </div>
      <ul className="notices">
        {SELLER_ANNOUNCEMENTS.map((a) => (
          <li key={a.title}>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
            <small>{a.time}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function FulfilledPanel() {
  return (
    <Panel title="Fulfilled by Onetap" more="Fulfilled by Onetap">
      <div className="fulfil-card">
        <p>Enjoy hassle-free operations and focus on growing your business.</p>
        <button className="btn-mini" type="button" onClick={() => notBuilt('Fulfilled by Onetap')}>Learn More</button>
        <span className="fulfil-card__art" aria-hidden="true">📦</span>
      </div>
    </Panel>
  );
}

export default function SellerDashboard() {
  const seller = useStored('session.seller');

  return (
    <div className="seller-content">
      <h1 className="sr-only" tabIndex={-1}>{seller.shopName} dashboard</h1>
      <div className="seller-main">
        <TodoStrip />
        <BusinessInsights />
        <BestPrice />
        <div className="seller-pair">
          <AdsPanel />
          <AffiliatePanel username={seller.username} />
        </div>
        <div className="seller-pair">
          <LivestreamPanel />
          <CampaignPanel username={seller.username} />
        </div>
      </div>
      <aside className="seller-side" aria-label="Shop updates">
        <ShopPerformance />
        <Announcements />
        <FulfilledPanel />
      </aside>
    </div>
  );
}
