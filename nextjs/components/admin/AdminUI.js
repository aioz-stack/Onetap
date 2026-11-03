'use client';

// Building blocks shared by every Admin Console page.

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { Badge } from '../SellerOrders';
import { peso } from '@/lib/ui';

export { Badge };

const NETWORK = 'We could not reach the server. Check your connection and try again.';

// A fetch for one panel's API, which sends an expired session back to that panel's login.
function panelFetch(base, login) {
  return async (url, options = {}) => {
    let response;
    try {
      response = await fetch(`${base}${url}`, options);
    } catch {
      throw new Error(NETWORK);
    }
    // A 401 from the login form just means a wrong password, not an expired session.
    if (response.status === 401 && !url.startsWith('/auth/')) window.location.assign(login);
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Something went wrong. Please try again.');
      error.fields = body.fields;
      throw error;
    }
    // Anything that changed something may change what is waiting, so the sidebar counts reload.
    if (options.method && options.method !== 'GET') window.dispatchEvent(new Event(COUNTS_CHANGED));
    return body;
  };
}

export const COUNTS_CHANGED = 'onetap:counts';
const COUNTS_MS = 10000;

// A panel's sidebar counts: work waiting in each section, keyed by the section's path. They reload
// every 10 seconds, on every page change, and straight after any action in the panel.
export function useNavCounts(fetcher) {
  const [counts, setCounts] = useState({});
  const pathname = usePathname();
  const load = useCallback(() => fetcher('/nav-counts').then((body) => setCounts(body.counts || {})).catch(() => {}), [fetcher]);
  useRefresh(load, COUNTS_MS);
  useEffect(() => {
    load();
  }, [load, pathname]);
  useEffect(() => {
    window.addEventListener(COUNTS_CHANGED, load);
    return () => window.removeEventListener(COUNTS_CHANGED, load);
  }, [load]);
  return counts;
}

// The number beside a sidebar section. Screen readers hear it as "3 waiting".
export function NavCount({ count, className = '' }) {
  if (!count) return null;
  return <span className={`nav-count ${className}`}><span aria-hidden="true">{count > 99 ? '99+' : count}</span><span className="sr-only">, {count} waiting</span></span>;
}

const jsonBody = (data, method) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const adminFetch = panelFetch('/api/admin', '/admin/login');
export const postAdmin = (url, data, method = 'POST') => adminFetch(url, jsonBody(data, method));
export const courierFetch = panelFetch('/api/courier', '/courier/login');
export const postCourier = (url, data, method = 'POST') => courierFetch(url, jsonBody(data, method));
export const riderFetch = panelFetch('/api/rider', '/rider/login');
export const postRider = (url, data, method = 'POST') => riderFetch(url, jsonBody(data, method));

export const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : '—');
export const dateOnly = (ms) => (ms ? new Date(ms).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }) : '—');
export const percent = (rate) => (rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(1)}%`);

const ADMIN_CLIENT = { fetch: adminFetch, base: '/api/admin' };
export const COURIER_CLIENT = { fetch: courierFetch, base: '/api/courier' };

const REFRESH_MS = 15000;

// Runs now, every 15 seconds (or `every` ms), and whenever the page is looked at again, to keep it
// in step with the database. Polling stands in for a realtime connection.
export function useRefresh(load, every = REFRESH_MS) {
  useEffect(() => {
    load();
    const timer = setInterval(load, every);
    const onShow = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [load, every]);
}

// Loads one server-paged list, and keeps its filters, sort and page.
export function useAdminList(url, initial = {}, client = ADMIN_CLIENT) {
  const [filters, setFilters] = useState(initial);
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const latest = useRef(0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();

  const load = useCallback(async () => {
    latest.current += 1;
    const request = latest.current;
    try {
      const data = await client.fetch(`${url}?${query}`);
      if (request === latest.current) setState({ loading: false, error: '', data });
    } catch (err) {
      if (request === latest.current) setState((current) => ({ ...current, loading: false, error: err.message }));
    }
  }, [url, query, client]);

  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  const setFilter = (name, value) => setFilters((current) => ({ ...current, [name]: value, page: name === 'page' ? value : undefined }));
  const setSort = (column) => setFilters((current) => ({ ...current, sort: column, dir: current.sort === column && current.dir === 'desc' ? 'asc' : 'desc', page: undefined }));
  return { ...state, filters, setFilter, setSort, reload: load, exportUrl: `${client.base}${url}?${query}&format=csv` };
}

export function PageHead({ title, text, children }) {
  return (
    <div className="order-head admin-head">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        {text && <p className="muted">{text}</p>}
      </div>
      {children && <div className="admin-head__actions">{children}</div>}
    </div>
  );
}

export function SandboxBanner() {
  return (
    <p className="admin-banner" role="note">
      <strong>Sandbox mode.</strong> Couriers here are simulated, so no real parcel moves. Live couriers need a production adapter and their credentials.
    </p>
  );
}

export function FilterBar({ list, placeholder, children, exportable = true }) {
  return (
    <div className="admin-filters">
      <label className="order-search">
        <Icon name="search" />
        <span className="sr-only">Search</span>
        <input type="search" placeholder={placeholder} value={list.filters.q || ''} onChange={(e) => list.setFilter('q', e.target.value)} />
      </label>
      {children}
      {exportable && <a className="btn-mini" href={list.exportUrl} download>Export CSV</a>}
    </div>
  );
}

export function SelectFilter({ list, name, label, options }) {
  return (
    <label className="admin-select">
      <span className="sr-only">{label}</span>
      <select value={list.filters[name] || ''} onChange={(e) => list.setFilter(name, e.target.value)}>
        <option value="">{label}: All</option>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
}

export function DateFilter({ list, name, label }) {
  return (
    <label className="admin-date">
      <span>{label}</span>
      <input type="date" value={list.filters[name] || ''} onChange={(e) => list.setFilter(name, e.target.value)} />
    </label>
  );
}

export function Tabs({ list, name = 'tab', tabs, label }) {
  const current = list.filters[name] || '';
  return (
    <div className="order-tabs" role="group" aria-label={label}>
      {tabs.map(([value, text, count]) => (
        <button type="button" key={value} aria-pressed={current === value} onClick={() => list.setFilter(name, value)}>
          {text}{count !== undefined && <> <span>{count}</span></>}
        </button>
      ))}
    </div>
  );
}

function LoadState({ list, empty }) {
  if (list.loading) return <div className="skeleton" role="status" aria-label="Loading" />;
  if (list.error && !list.data) {
    return (
      <div className="panel order-empty" role="alert">
        <Icon name="box" />
        <h2>We couldn&apos;t load this</h2>
        <p className="muted">{list.error}</p>
        <button className="btn-mini" type="button" onClick={list.reload}>Try Again</button>
      </div>
    );
  }
  if (!list.data?.rows.length) return <div className="panel order-empty"><Icon name="box" /><h2>{empty}</h2></div>;
  return null;
}

export function DataTable({ list, columns, empty, rowKey, label }) {
  const state = <LoadState list={list} empty={empty} />;
  if (list.loading || !list.data?.rows.length) return state;
  const { rows, total, page, pageSize } = list.data;
  const pages = Math.ceil(total / pageSize) || 1;
  const { sort, dir } = list.filters;

  return (
    <>
      <div className="admin-table" role="region" aria-label={label} tabIndex={0}>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column.label} aria-sort={sort === column.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {column.sort
                    ? <button type="button" onClick={() => list.setSort(column.sort)}>{column.label}{sort === column.sort && (dir === 'asc' ? ' ▲' : ' ▼')}</button>
                    : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.label}>{column.render(row)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <nav className="admin-pages" aria-label="Pages">
        <span className="muted">{total.toLocaleString('en-PH')} total</span>
        <button className="btn-mini" type="button" disabled={page <= 1} onClick={() => list.setFilter('page', String(page - 1))}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn-mini" type="button" disabled={page >= pages} onClick={() => list.setFilter('page', String(page + 1))}>Next</button>
      </nav>
    </>
  );
}

export function StatCards({ items }) {
  return (
    <dl className="admin-stats">
      {items.map(({ label, value, href }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{href ? <a href={href}>{value}</a> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

const HEIGHT = 150;
const WIDTH = 560;
const GAP = 2;

const shortDay = (day) => new Date(`${day}T00:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

// Grouped bars for up to two series on one scale, with a hover readout and a table for screen readers.
// `labelEvery` spaces the day labels out on long ranges. Negative days (refunds) draw no bar but read out in the tooltip.
export function TrendChart({ title, series, money, labelEvery = 3 }) {
  const [hover, setHover] = useState(null);
  const days = series[0].values;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v.value)));
  const slot = WIDTH / days.length;
  // Narrow slots on long ranges still get a visible bar.
  const barWidth = Math.max(2, Math.min(16, (slot - Math.min(6, slot * 0.3)) / series.length - GAP));
  const format = (value) => (money ? peso(value) : value.toLocaleString('en-PH'));

  return (
    <figure className="admin-chart">
      <figcaption>
        <strong>{title}</strong>
        {series.length > 1 && (
          <span className="admin-legend">
            {series.map((s) => <span key={s.label}><i className={`admin-swatch admin-swatch--${s.tone}`} />{s.label}</span>)}
          </span>
        )}
      </figcaption>
      <div className="admin-chart__plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT + 18}`} aria-hidden="true">
          <line className="admin-chart__axis" x1="0" x2={WIDTH} y1={HEIGHT} y2={HEIGHT} />
          {days.map((day, i) => (
            <g key={day.day}>
              {series.map((s, j) => {
                const height = (Math.max(0, s.values[i].value) / max) * (HEIGHT - 8);
                const x = i * slot + (slot - series.length * (barWidth + GAP)) / 2 + j * (barWidth + GAP);
                return height ? <rect className={`admin-bar admin-bar--${s.tone}`} key={s.label} x={x} y={HEIGHT - height} width={barWidth} height={height} rx="3" /> : null;
              })}
              {i % labelEvery === 0 && <text x={Math.min(WIDTH - 18, Math.max(18, i * slot + slot / 2))} y={HEIGHT + 14} textAnchor="middle">{shortDay(day.day)}</text>}
              <rect className="admin-chart__hit" x={i * slot} y="0" width={slot} height={HEIGHT} onMouseEnter={() => setHover(i)} />
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="admin-tooltip" style={{ left: `${Math.min(78, Math.max(4, ((hover + 0.5) / days.length) * 100 - 10))}%` }}>
            <strong>{shortDay(days[hover].day)}</strong>
            {series.map((s) => <span key={s.label}>{s.label}: {format(s.values[hover].value)}</span>)}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Day</th>{series.map((s) => <th scope="col" key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{days.map((day, i) => <tr key={day.day}><th scope="row">{shortDay(day.day)}</th>{series.map((s) => <td key={s.label}>{format(s.values[i].value)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

export function RateBars({ title, rows }) {
  return (
    <figure className="admin-chart">
      <figcaption><strong>{title}</strong></figcaption>
      <ul className="admin-rates">
        {rows.map(({ label, rate, note }) => (
          <li key={label}>
            <span className="admin-rates__label">{label}</span>
            <span className="admin-rates__track"><span className="admin-bar--one" style={{ width: `${(rate || 0) * 100}%` }} /></span>
            <span className="admin-rates__value">{percent(rate)}</span>
            <small className="muted">{note}</small>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function TextField({ id, label, error, hint, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={Boolean(error)} {...props} />
      {hint && <small className="field__hint">{hint}</small>}
      {error && <small className="field__error">{error}</small>}
    </div>
  );
}

export function CheckGroup({ legend, options, value, onChange }) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option}>
          <input type="checkbox" checked={value.includes(option)} onChange={(e) => onChange(e.target.checked ? [...value, option] : value.filter((item) => item !== option))} /> {option}
        </label>
      ))}
    </fieldset>
  );
}
