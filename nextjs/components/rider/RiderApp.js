'use client';

// The Rider Panel: a rider's current task and its progress buttons, their task history, the COD
// cash they collect each day and handing it to their courier. The server decides which task is
// theirs, what they may see of it, which updates they can send and what cash they hold.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { ThemeToggle } from '../Header';
import { dateOnly, dateTime, postRider, riderFetch, StatCards, TextField, useRefresh, Badge } from '../admin/AdminUI';
import { mapLink, REPORT_FORMS, ReportForm } from '../courier/CourierPanel';
import { COLLECTION_STATUS, HANDOVER_STATUS, RIDER_REMITTANCE_STATUS, RIDER_STATUS, SHIPMENT_STATUS, TASK_KIND, TASK_STATUS } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

// Notifications check every 5 seconds, faster than the pages, so a new task shows up quickly. A new
// one also tells My Tasks to reload.
const NOTICE_MS = 5000;
export const TASKS_CHANGED = 'onetap:rider-tasks';

// The header's dropdowns: one open at a time, closed by a click outside or Escape.
function useHeaderPanel() {
  const [panel, setPanel] = useState(null);
  const pathname = usePathname();
  useEffect(() => setPanel(null), [pathname]);
  useEffect(() => {
    // The path is taken when the click starts, so a button that removes itself (Mark as read) still counts as inside.
    function onClick(e) {
      if (!e.composedPath().some((el) => el.matches?.('.panel-pop, [data-rider-toggle]'))) setPanel(null);
    }
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      const toggle = document.querySelector('[data-rider-toggle][aria-expanded="true"]');
      if (toggle) {
        setPanel(null);
        toggle.focus();
      }
    }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  const toggleProps = (id, label) => ({
    'data-rider-toggle': id, 'aria-expanded': panel === id, 'aria-controls': `rider-${id}`, 'aria-label': label, title: label,
    className: 'seller-bar__icon', type: 'button', onClick: () => setPanel(panel === id ? null : id),
  });
  return { panel, close: () => setPanel(null), toggleProps };
}

// A new task's order, customer, pickup location and assignment time.
function NoticeDetails({ details }) {
  if (!details) return null;
  return (
    <dl className="notif__facts">
      <div><dt>Order</dt><dd>{details.orderId} · {TASK_KIND[details.kind]}</dd></div>
      <div><dt>Customer</dt><dd>{details.customer}{details.customerPhone && <>, {tel(details.customerPhone)}</>}</dd></div>
      <div><dt>Pickup location</dt><dd>{details.pickupLocation || details.seller || '—'}</dd></div>
      {details.deliveryAddress && <div><dt>Deliver to</dt><dd>{details.deliveryAddress}</dd></div>}
      {details.kind === 'delivery' && <div><dt>Payment</dt><dd>{details.cod ? `Collect ${peso(details.total)} cash` : 'Prepaid'}</dd></div>}
      <div><dt>Assigned</dt><dd>{dateTime(details.assignedAt)}</dd></div>
    </dl>
  );
}

function RiderNotifications({ open, close, toggleProps }) {
  const [items, setItems] = useState([]);
  const seen = useRef(null);
  const unread = items.filter((item) => !item.read).length;

  const load = useCallback(() => riderFetch('/notifications').then((body) => {
    // Anything new since the last check gets a toast, and My Tasks reloads to show it.
    const fresh = seen.current ? body.notifications.filter((item) => !item.read && !seen.current.has(item.id)) : [];
    seen.current = new Set(body.notifications.map((item) => item.id));
    if (fresh.length) {
      toast(fresh.length === 1 ? `${fresh[0].title}: ${fresh[0].details?.orderId || fresh[0].body}` : `${fresh.length} new notifications`, 'info');
      window.dispatchEvent(new Event(TASKS_CHANGED));
    }
    setItems(body.notifications);
  }).catch(() => {}), []);
  useRefresh(load, NOTICE_MS);

  function markRead(id) {
    setItems((list) => list.map((item) => (!id || item.id === id ? { ...item, read: true } : item)));
    postRider('/notifications', id ? { id } : {}).catch(() => load());
  }

  return (
    <div className="popover-wrap">
      <button {...toggleProps('notices', `Notifications, ${unread} unread`)}>
        <Icon name="bell" />
        {unread > 0 && <span className="count seller-bar__count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover popover--wide seller-notices panel-pop" id="rider-notices" role="region" aria-label="Notifications">
          <div className="popover__head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="link" type="button" onClick={() => markRead()}>Mark all as read</button>}
          </div>
          {items.map((item) => (
            <article className={`notif${item.read ? '' : ' notif--unread'}`} key={item.id}>
              <strong>{!item.read && <span className="notif__dot" aria-label="Unread" />}{item.title}</strong>
              <span>{item.body}</span>
              <NoticeDetails details={item.details} />
              <div className="notif__actions">
                <small>{item.details ? '' : dateTime(item.at)}</small>
                {item.details && <Link className="link" href={item.link} onClick={() => { if (!item.read) markRead(item.id); close(); }}>View task</Link>}
                {!item.read && <button className="link" type="button" onClick={() => markRead(item.id)}>Mark as read</button>}
              </div>
            </article>
          ))}
          {!items.length && <p className="muted notif">Nothing new yet. New tasks from your courier show up here.</p>}
        </div>
      )}
    </div>
  );
}

// The rider's finished tasks and what they collected, newest first. It only loads while open.
function HistoryList() {
  const [state, setState] = useState({ loading: true });
  const [limit, setLimit] = useState(0);
  const load = useCallback(() => riderFetch(`/history${limit ? `?limit=${limit}` : ''}`).then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), [limit]);
  useRefresh(load);
  const { data, loading, error } = state;

  if (!data) return loading ? <div className="skeleton" role="status" aria-label="Loading task history" /> : <p className="form-error notif" role="alert">{error}</p>;
  if (!data.rows.length) return <p className="muted notif">Finished tasks appear here.</p>;
  return (
    <>
    <p className="muted task-history__summary">{count(data.completedPickups, 'pickup')} and {count(data.completedDeliveries, 'delivery', 'deliveries')} completed</p>
    <ul className="task-history">
      {data.rows.map((row) => (
        <li key={row.id}>
          <div className="task-history__top">
            <strong>{row.orderId}</strong>
            <Badge status={TASK_STATUS[row.status]} />
          </div>
          <dl className="notif__facts">
            <div><dt>Task</dt><dd>{TASK_KIND[row.kind]}{row.kind === 'pickup' && row.seller && ` from ${row.seller}`}</dd></div>
            <div><dt>Customer</dt><dd>{row.customer || '—'}</dd></div>
            <div><dt>Delivery status</dt><dd>{SHIPMENT_STATUS[row.shipmentStatus]?.label || row.shipmentStatus || '—'}</dd></div>
            <div><dt>Assigned</dt><dd>{dateTime(row.assignedAt)}</dd></div>
            <div><dt>{row.status === 'completed' ? 'Completed' : 'Ended'}</dt><dd>{dateTime(row.finishedAt)}</dd></div>
            {row.kind === 'delivery' && row.status === 'completed' && <div><dt>Payment</dt><dd>{row.collected !== null ? `COD, collected ${peso(row.collected)}` : row.cod ? `COD ${peso(row.total)}` : 'Prepaid'}</dd></div>}
            {row.note && <div><dt>Note</dt><dd>{row.note}</dd></div>}
          </dl>
        </li>
      ))}
    </ul>
    {data.more && <button className="btn-mini task-history__more" type="button" onClick={() => setLimit(data.rows.length + data.step)}>Show older tasks</button>}
    </>
  );
}

function TaskHistory({ open, close, toggleProps }) {
  return (
    <div className="popover-wrap">
      <button {...toggleProps('history', 'Task history')}>
        <Icon name="clock" />
      </button>
      {open && (
        <div className="popover popover--wide seller-notices panel-pop" id="rider-history" role="region" aria-label="Task history">
          <div className="popover__head">
            <strong>Task History</strong>
            <Link className="link" href="/rider/collections" onClick={close}>Collections</Link>
          </div>
          <HistoryList />
        </div>
      )}
    </div>
  );
}

function PasswordForm() {
  const [values, setValues] = useState({ current: '', next: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postRider('/auth/password', values);
      Modal.close();
      toast('Password changed.', 'success');
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <TextField id="rider-current" label="Current password" type="password" autoComplete="current-password" required value={values.current} error={errors.current} onChange={(e) => setValues({ ...values, current: e.target.value })} />
      <TextField id="rider-next" label="New password" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters." value={values.next} error={errors.next} onChange={(e) => setValues({ ...values, next: e.target.value })} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Change Password'}</button>
    </form>
  );
}

export function RiderLogin() {
  const [values, setValues] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postRider('/auth/login', values);
      window.location.assign('/rider');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="admin-login">
      <form className="panel" onSubmit={submit}>
        <h1 tabIndex={-1}>Rider Panel</h1>
        <p className="muted">Sign in with the username and password your courier gave you.</p>
        <TextField id="rider-identifier" label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={values.identifier} onChange={(e) => setValues({ ...values, identifier: e.target.value })} />
        <TextField id="rider-password" label="Password" type="password" autoComplete="current-password" required value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Log In'}</button>
      </form>
    </section>
  );
}

function DeclineForm({ task, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postRider(`/tasks/${task.id}`, { action: 'decline', reason });
      Modal.close();
      toast('Task declined. Your dispatcher was told.', 'success');
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <TextField id="decline-reason" label="Why can't you take this task?" required maxLength={200} value={reason} error={error} onChange={(e) => setReason(e.target.value)} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Sending…' : 'Decline Task'}</button>
    </form>
  );
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const loadRiders = () => riderFetch('/riders');

// In the Rider Panel, sending an order to the customer is Mark In Transit: it becomes Out for Delivery.
// Each card leads with its next normal step.
const MAIN_STEPS = ['picked_up', 'out_for_delivery', 'delivered'];
// The three steps that send an order out for delivery, in order. They show as a checklist.
const DISPATCH = [['in_transit', 'Mark In Transit'], ['at_sorting_facility', 'Arrived at Sorting Facility'], ['arrived_delivery_hub', 'Arrived at Delivery Hub']];
const DISPATCH_KEYS = DISPATCH.map(([key]) => key);
const riderLabel = (status) => DISPATCH.find(([key]) => key === status)?.[1] || REPORT_FORMS[status].label;
const riderTitle = (status) => REPORT_FORMS[status].title;
const lastStep = (task, status) => DISPATCH_KEYS.includes(status) && task.dispatchSteps.filter((step) => !step.done).length === 1;

// Each step shows when, where and who once done. The next one is a button. Out for Delivery follows
// on its own once all three are done.
function DispatchChecklist({ task, onReport }) {
  return (
    <section className="dispatch">
      <h3>Before Out for Delivery</h3>
      <ol className="timeline order-timeline">
        {task.dispatchSteps.map((step) => {
          const label = riderLabel(step.status);
          return (
            <li className={step.done ? 'is-done' : 'is-pending'} key={step.status}>
              {step.done ? label : task.actions.includes(step.status) ? <button className="btn btn--primary" type="button" onClick={() => onReport(step.status)}>{label}</button> : label}
              <small>{step.done ? [dateTime(step.at), step.location, step.note].filter(Boolean).join(' · ') : 'Not done yet'}</small>
            </li>
          );
        })}
      </ol>
      <p className="muted">When all three are done, the order moves to your Out for Delivery section by itself.</p>
    </section>
  );
}
const tel = (phone) => <a className="link" href={`tel:${phone}`}>{phone}</a>;
const map = (address) => address && <> <a className="link" href={mapLink(address)} target="_blank" rel="noopener noreferrer">Open map</a></>;
const items = (task) => task.items.map((item) => `${item.qty} × ${item.name}${item.variation ? ` (${item.variation})` : ''}`).join(', ');

// What the rider checks before confirming: the seller and parcel at collection, the buyer when
// heading out, and the buyer and amount at the door.
function TaskCheck({ task, status }) {
  if (status === 'picked_up') {
    return (
      <dl className="order-facts">
        <div><dt>Seller</dt><dd>{task.seller}{task.contactName && `, ${task.contactName}`}</dd></div>
        <div><dt>Contact number</dt><dd>{task.contactPhone ? tel(task.contactPhone) : '—'}</dd></div>
        <div><dt>Pickup address</dt><dd>{task.address || '—'}{map(task.address)}</dd></div>
        <div><dt>Order</dt><dd>{task.orderId}</dd></div>
        <div><dt>Products</dt><dd>{items(task)}</dd></div>
        <div><dt>Package</dt><dd>{task.parcel.parcels || 1} parcel{Number(task.parcel.parcels) > 1 ? 's' : ''}{task.parcel.weight && `, ${task.parcel.weight} kg`}{task.parcel.note && `. ${task.parcel.note}`}</dd></div>
      </dl>
    );
  }
  if (['out_for_delivery', 'delivered', 'failed_delivery'].includes(status)) {
    return (
      <dl className="order-facts">
        <div><dt>Customer</dt><dd>{task.customer}</dd></div>
        <div><dt>Contact number</dt><dd>{tel(task.phone)}</dd></div>
        <div><dt>Delivery address</dt><dd>{task.address}{map(task.address)}</dd></div>
        <div><dt>Payment</dt><dd>{task.cod ? `Collect ${peso(task.total)} cash` : 'Prepaid, collect nothing'}</dd></div>
      </dl>
    );
  }
  return null;
}

function CurrentTask({ task, onChanged }) {
  const [busy, setBusy] = useState(false);
  const pickup = task.kind === 'pickup';

  async function accept() {
    setBusy(true);
    try {
      await postRider(`/tasks/${task.id}`, { action: 'accept' });
      toast(pickup ? 'Accepted. Head to the seller.' : 'Accepted. The parcel is yours to deliver.', 'success');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  }

  const report = (status) => Modal.open({
    title: `${riderTitle(status)}: ${task.orderId}`,
    content: <ReportForm shipment={task} status={status} onDone={onChanged} label={riderLabel(status)} defaultReceivedBy={task.riderId} loadRiders={loadRiders} details={<>{lastStep(task, status) && <p className="muted">This is the last of the three steps, so the order moves to your Out for Delivery section.</p>}{status === 'out_for_delivery' && <p className="muted">The customer is told their parcel is on its way.</p>}<TaskCheck task={task} status={status} /></>} requirePhoto locationRequired defaultLocation={startingLocation(task, status)} send={(values) => postRider(`/tasks/${task.id}`, { action: 'report', status, ...values })} uploadFile={(data) => riderFetch('/uploads', { method: 'POST', body: data })} />,
  });

  return (
    <section className="panel rider-task">
      <div className="panel__head">
        <h2>{pickup ? 'Pickup' : 'Delivery'}: {task.orderId}</h2>
        <Badge status={TASK_STATUS[task.status]} />
      </div>
      {task.sandbox && <p className="admin-banner" role="note"><strong>Sandbox task.</strong> No real parcel exists. Your updates are simulated courier reports.</p>}
      <dl className="order-facts order-facts--row">
        {pickup ? (
          <>
            <div><dt>Collect from</dt><dd>{task.seller}</dd></div>
            <div><dt>Pickup address</dt><dd>{task.address || '—'}{map(task.address)}</dd></div>
            <div><dt>Seller contact</dt><dd>{task.contactName}{task.contactPhone && <>, {tel(task.contactPhone)}</>}</dd></div>
            <div><dt>Schedule</dt><dd>{dateOnly(task.scheduledFor)}{task.slot && `, ${task.slot}`}</dd></div>
            {task.parcel.weight && <div><dt>Parcel</dt><dd>{task.parcel.parcels} parcel{task.parcel.parcels === 1 ? '' : 's'}, {task.parcel.weight} kg{task.parcel.note && `. ${task.parcel.note}`}</dd></div>}
          </>
        ) : (
          <>
            <div><dt>Deliver to</dt><dd>{task.customer}</dd></div>
            <div><dt>Delivery address</dt><dd>{task.address}{map(task.address)}</dd></div>
            <div><dt>Customer contact</dt><dd>{tel(task.phone)}</dd></div>
            <div><dt>Payment</dt><dd>{task.cod ? `Collect ${peso(task.total)} cash` : 'Prepaid, collect nothing'}</dd></div>
            {task.pickedUpAt && <div><dt>Collected</dt><dd>{dateTime(task.pickedUpAt)}</dd></div>}
            {task.outForDeliveryAt && <div><dt>Out for delivery</dt><dd>{dateTime(task.outForDeliveryAt)}</dd></div>}
          </>
        )}
        <div><dt>Tracking</dt><dd>{task.tracking}</dd></div>
        <div><dt>Shipment status</dt><dd>{SHIPMENT_STATUS[task.shipmentStatus]?.label || task.shipmentStatus}</dd></div>
        <div><dt>Assigned</dt><dd>{dateTime(task.assignedAt)}</dd></div>
      </dl>
      {task.items.length > 0 && <p className="muted">Contents: {items(task)}</p>}
      {task.kind === 'delivery' && <p className="muted"><strong>Sorting:</strong> <SortingStatus sorting={task.sorting} /></p>}
      {task.updates.length > 0 && <details><summary>Tracking updates ({task.updates.length})</summary><Updates updates={task.updates} /></details>}
      <div className="order-card__actions">
        {task.actions.includes('accept') && <button className="btn btn--primary" type="button" disabled={busy} onClick={accept}>Accept Task</button>}
        {task.actions.includes('decline') && <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `Decline ${task.orderId}`, content: <DeclineForm task={task} onDone={onChanged} /> })}>Decline</button>}
        {Object.keys(REPORT_FORMS).filter((status) => task.actions.includes(status) && !(DISPATCH_KEYS.includes(status) && task.kind === 'delivery')).sort((a, b) => MAIN_STEPS.includes(b) - MAIN_STEPS.includes(a)).map((status) => (
          <button className={MAIN_STEPS.includes(status) ? 'btn btn--primary' : 'btn-mini'} type="button" key={status} onClick={() => report(status)}>{riderLabel(status)}</button>
        ))}
      </div>
      {task.status === 'accepted' && !task.sandbox && <p className="muted">{task.courier} records collection and delivery in its own system, so update the parcel there.</p>}
      {task.status === 'accepted' && pickup && task.actions.length === 0 && task.sandbox && <p className="muted">Waiting for your courier to confirm this pickup.</p>}
      {task.status === 'accepted' && !pickup && task.sandbox && !['ready_for_delivery', 'out_for_delivery'].includes(task.shipmentStatus) && <DispatchChecklist task={task} onReport={report} />}
      {task.status === 'accepted' && task.shipmentStatus === 'ready_for_delivery' && <p className="muted">Ready for delivery. Click Out for Delivery when you set off, and the customer is told.</p>}
      {task.status === 'accepted' && task.shipmentStatus === 'out_for_delivery' && <p className="muted">On its way. Click Order Delivered at the door, with a photo and who received it.</p>}
    </section>
  );
}

const RIDER_NAV = [
  { label: 'My Tasks', href: '/rider' },
  { label: 'Collections', href: '/rider/collections' },
  { label: 'Remittances', href: '/rider/remittances' },
];

export function RiderShell({ account, children }) {
  const pathname = usePathname();
  const { panel, close, toggleProps } = useHeaderPanel();

  async function logout() {
    await riderFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.assign('/rider/login');
  }

  return (
    <div className="seller admin rider-app">
      <header className="seller-bar">
        <Link className="seller-bar__brand" href="/rider" aria-label="My tasks">
          <img src="/logo.svg" alt="" width="34" height="34" />
          <span>Onetap</span>
        </Link>
        <span className="seller-bar__title">Rider Panel</span>
        <div className="seller-bar__actions">
          <ThemeToggle />
          <TaskHistory open={panel === 'history'} close={close} toggleProps={toggleProps} />
          <RiderNotifications open={panel === 'notices'} close={close} toggleProps={toggleProps} />
          <button className="seller-bar__logout" type="button" onClick={() => Modal.open({ title: 'Change password', content: <PasswordForm /> })}>{account.name}<span className="admin-role"> · {account.partnerName}</span></button>
          <button className="seller-bar__logout" type="button" onClick={logout}>Log Out</button>
        </div>
      </header>
      <nav className="order-tabs rider-nav" aria-label="Rider Panel">
        {RIDER_NAV.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>{item.label}</Link>)}
      </nav>
      <main className="rider-main order-page" id="main">{children}</main>
    </div>
  );
}

function RiderHead({ title, text, children }) {
  return (
    <div className="order-head">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      {children}
    </div>
  );
}

// Where the rider most likely is for each update, so the location field starts filled in.
function startingLocation(task, status) {
  if (['picked_up', 'pickup_failed', 'delivered', 'failed_delivery'].includes(status)) return task.address || '';
  if (['sorting_completed', 'departed_sorting_facility'].includes(status)) return task.sorting?.facility || task.lastLocation || '';
  return task.lastLocation || '';
}

function SortingStatus({ sorting }) {
  if (!sorting) return null;
  if (sorting.state === 'sorted') return <>Sorted at {sorting.facility}, {dateTime(sorting.at)}</>;
  if (sorting.state === 'sorting') return <>Being sorted at {sorting.facility} since {dateTime(sorting.at)}</>;
  return <>Not at a sorting facility yet</>;
}

// The parcel's movements, oldest first, each with where and when.
function Updates({ updates }) {
  if (!updates?.length) return null;
  return (
    <ol className="timeline order-timeline rider-updates">
      {updates.map((update) => (
        <li className="is-done" key={`${update.status}-${update.at}`}>
          {SHIPMENT_STATUS[update.status]?.label || update.status}
          <small>{dateTime(update.at)}{update.location && ` · ${update.location}`}</small>
        </li>
      ))}
    </ol>
  );
}

const CATEGORIES = [
  ['forPickup', 'For Pickup', 'Orders assigned to you to collect from the seller.'],
  ['inTransit', 'In Transit', 'Orders you collected from the seller. Each moves to your Out for Delivery section once it is marked in transit, at a sorting facility and at a delivery hub.'],
  ['outForDelivery', 'Out for Delivery', 'Orders ready at the hub or on their way. Click Out for Delivery when you set off, then Order Delivered at the door.'],
  ['completed', 'Completed', 'Delivered orders with proof of delivery, kept here for reference.'],
];

function BoardRow({ row }) {
  return (
    <li>
      <span>
        <strong>{row.orderId}</strong> · {row.kind === 'pickup' ? `from ${row.seller}` : `to ${row.customer}`}
        <small className="muted">
          {row.tracking}
          {row.deliveredAt ? ` · delivered ${dateTime(row.deliveredAt)}${row.receivedBy ? `, received by ${row.receivedBy}` : ''}${row.receiver ? `, recipient ${row.receiver}` : ''}` : row.pickedUpAt ? ` · collected ${dateTime(row.pickedUpAt)}` : ` · assigned ${dateTime(row.assignedAt)}`}
          {!row.open && row.kind === 'pickup' && ' · you collected it'}
        </small>
        {row.photo && <a className="link" href={row.photo} target="_blank" rel="noopener noreferrer">View delivery photo{row.photos?.length > 1 ? ` (1 of ${row.photos.length})` : ''}</a>}
        {row.sorting && <small><strong>Sorting:</strong> <SortingStatus sorting={row.sorting} /></small>}
        <Updates updates={row.updates} />
      </span>
      <span>
        <Badge status={SHIPMENT_STATUS[row.shipmentStatus]} />
        {row.cod && <small className="muted">COD {peso(row.total)}</small>}
      </span>
    </li>
  );
}

// The four categories. The order the rider is working on shows its full card, with its buttons.
function TaskBoard({ data, onChanged }) {
  const open = Object.fromEntries(data.tasks.map((task) => [task.id, task]));
  const home = CATEGORIES.find(([key]) => data.board[key].some((row) => open[row.taskId]))?.[0] || 'forPickup';
  const [picked, setPicked] = useState(null);
  const tab = picked || home;
  const [, label, text] = CATEGORIES.find(([key]) => key === tab);
  const rows = data.board[tab];
  // Every open order gets its own card and buttons, so each action touches only that order.
  const cards = rows.filter((row) => open[row.taskId]);
  const others = rows.filter((row) => !open[row.taskId]);
  const placed = new Set(Object.values(data.board).flat().map((row) => row.taskId));
  const unplaced = tab === home ? data.tasks.filter((task) => !placed.has(task.id)) : [];

  return (
    <>
      <div className="order-tabs" role="group" aria-label="Task categories">
        {CATEGORIES.map(([key, name]) => (
          <button type="button" key={key} aria-pressed={tab === key} onClick={() => setPicked(key)}>{name} <span>{data.board[key].length}</span></button>
        ))}
      </div>
      <p className="muted">{text}</p>
      {[...cards.map((row) => open[row.taskId]), ...unplaced].map((task) => <CurrentTask task={task} onChanged={onChanged} key={task.id} />)}
      {(others.length > 0 || !cards.length) && (
        <section className="panel">
          <div className="panel__head"><h2>{cards.length ? `Also in ${label}` : label}</h2></div>
          {others.length ? (
            <ul className="rider-list">{others.map((row) => <BoardRow row={row} key={row.orderId} />)}</ul>
          ) : <p className="muted">{tab === 'forPickup' ? `Nothing to collect. You'll get a notification when ${data.rider.partner} assigns you a pickup.` : 'Nothing here right now.'}</p>}
        </section>
      )}
    </>
  );
}

export function RiderHome() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => riderFetch('/home').then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), []);
  useRefresh(load);
  // A new task notification reloads the board straight away.
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, load);
    return () => window.removeEventListener(TASKS_CHANGED, load);
  }, [load]);

  const { data, loading, error } = state;
  return (
    <>
      <RiderHead title="My Tasks" text={data ? `${count(data.rider.completedPickups, 'pickup')} and ${count(data.rider.completedDeliveries, 'delivery', 'deliveries')} completed. Past tasks are under Task History at the top.` : 'Updates every 15 seconds.'}>{data && <Badge status={RIDER_STATUS[data.rider.status]} />}</RiderHead>
      {loading && <div className="skeleton" role="status" aria-label="Loading your tasks" />}
      {error && !data && <p className="form-error" role="alert">{error}</p>}
      {data && <TaskBoard data={data} onChanged={load} />}
    </>
  );
}

const shortDate = (day) => new Date(`${day}T00:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

export function RiderCollections() {
  const [date, setDate] = useState('');
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => riderFetch(`/collections${date ? `?date=${date}` : ''}`).then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), [date]);
  useRefresh(load);

  const { data, loading, error } = state;
  return (
    <>
      <RiderHead title="Daily Collections" text="Cash you collected on delivery, and the tasks you finished, by day.">
        <label className="admin-date">
          <span>Day</span>
          <input type="date" value={date || data?.date || ''} max={data?.today} onChange={(e) => setDate(e.target.value)} />
        </label>
      </RiderHead>
      {loading && <div className="skeleton" role="status" aria-label="Loading collections" />}
      {error && !data && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <>
          <section className="panel">
            <div className="panel__head"><h2>{data.date === data.today ? 'Today' : shortDate(data.date)}</h2></div>
            <StatCards items={[
              { label: 'COD Collected', value: peso(data.summary.collected) },
              { label: 'COD Parcels', value: data.summary.codParcels },
              { label: 'Deliveries', value: data.summary.deliveries },
              { label: 'Failed Deliveries', value: data.summary.failedDeliveries },
              { label: 'Pickups Collected', value: data.summary.pickups },
            ]} />
            {data.summary.collected !== data.summary.expected && <p className="muted">Due on these parcels was {peso(data.summary.expected)}.</p>}
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2>Cash you hold</h2>
              <strong>{peso(data.held.amount)}</strong>
            </div>
            <p className="muted">{data.held.parcels ? `From ${count(data.held.parcels, 'COD parcel')}, on every day you haven't handed over yet.` : 'You have handed over all your COD cash.'}</p>
            {data.held.parcels > 0 && <Link className="btn btn--primary" href="/rider/remittances">Hand Over Cash</Link>}
          </section>
          <section className="panel">
            <div className="panel__head"><h2>COD parcels</h2></div>
            {data.rows.length ? (
              <ul className="rider-list">
                {data.rows.map((row) => (
                  <li key={row.orderId}>
                    <span><strong>{row.orderId}</strong> · {row.customer}<small className="muted">{dateTime(row.collectedAt)}{row.collected !== row.expected && ` · due ${peso(row.expected)}`}</small></span>
                    <span><strong>{peso(row.collected)}</strong><Badge status={HANDOVER_STATUS[row.handover]} /></span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No COD cash collected on this day.</p>}
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Completed deliveries</h2></div>
            {data.transactions.length ? (
              <ul className="rider-list">
                {data.transactions.map((row) => (
                  <li key={row.orderId}>
                    <span>
                      <strong>{row.orderId}</strong> · {row.seller} to {row.customer}
                      <small className="muted">{row.paymentMethod} · {dateTime(row.collectedAt)}</small>
                      <dl className="rider-breakdown">
                        <div><dt>Product total</dt><dd>{peso(row.productTotal)}</dd></div>
                        <div><dt>Rider fee</dt><dd>{peso(row.riderFee)}</dd></div>
                        <div><dt>Admin fee</dt><dd>{peso(row.adminFee)}</dd></div>
                        <div><dt>Total</dt><dd>{peso(row.total)}</dd></div>
                      </dl>
                    </span>
                    <span><strong>{peso(row.collected)}</strong><Badge status={COLLECTION_STATUS[row.status]} /></span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Orders you deliver on this day appear here with their breakdown.</p>}
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Last 7 days</h2></div>
            <ul className="rider-list">
              {data.days.map((day) => (
                <li key={day.date}>
                  <button className="link" type="button" onClick={() => setDate(day.date)}>{day.date === data.today ? 'Today' : shortDate(day.date)}</button>
                  <span>{count(day.parcels, 'parcel')} · <strong>{peso(day.collected)}</strong></span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function HandoverForm({ held, onDone }) {
  const [values, setValues] = useState({ amount: String(held.amount), note: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const short = Number(values.amount) < held.amount;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { reference } = await postRider('/remittances', values);
      Modal.close();
      toast(`Handed over as ${reference}. Your courier will confirm it.`, 'success');
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <p className="muted">This hands over all the cash you hold: {peso(held.amount)} from {count(held.parcels, 'COD parcel')}. Give the cash to your courier&apos;s cashier, who confirms what they receive.</p>
      <TextField id="handover-amount" label="Amount you're handing over (₱)" required inputMode="decimal" value={values.amount} error={errors.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} />
      <TextField id="handover-note" label={short ? 'Why is it short?' : 'Note (optional)'} maxLength={200} value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Sending…' : 'Hand Over Cash'}</button>
    </form>
  );
}

export function RiderRemittances() {
  const [state, setState] = useState({ loading: true });

  const load = useCallback(() => riderFetch('/remittances').then((data) => setState({ data }), (err) => setState((current) => ({ ...current, loading: false, error: err.message }))), []);
  useRefresh(load);

  const { data, loading, error } = state;
  return (
    <>
      <RiderHead title="Remittances" text="Hand your COD cash to your courier, and see what they confirmed." />
      {loading && <div className="skeleton" role="status" aria-label="Loading remittances" />}
      {error && !data && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <>
          <section className="panel">
            <div className="panel__head">
              <h2>Cash you hold</h2>
              <strong>{peso(data.held.amount)}</strong>
            </div>
            {data.held.parcels ? (
              <>
                <ul className="rider-list">
                  {data.held.rows.map((row) => (
                    <li key={row.orderId}>
                      <span><strong>{row.orderId}</strong> · {row.customer}<small className="muted">{dateTime(row.collectedAt)}</small></span>
                      <strong>{peso(row.collected)}</strong>
                    </li>
                  ))}
                </ul>
                {data.pending
                  ? <p className="muted">Your last handover is waiting for your courier. You can hand over this cash once they confirm it.</p>
                  : <button className="btn btn--primary" type="button" onClick={() => Modal.open({ title: 'Hand over cash', content: <HandoverForm held={data.held} onDone={load} /> })}>Hand Over Cash</button>}
              </>
            ) : <p className="muted">You aren&apos;t holding any COD cash.</p>}
          </section>
          <section className="panel">
            <div className="panel__head"><h2>Your handovers</h2></div>
            {data.rows.length ? (
              <ul className="rider-list">
                {data.rows.map((row) => (
                  <li key={row.id}>
                    <span>
                      <strong>{row.reference}</strong> · {count(row.parcels, 'parcel')}
                      <small className="muted">
                        Handed over {peso(row.declared)} of {peso(row.expected)} · {dateTime(row.submittedAt)}
                        {row.status === 'confirmed' && ` · received ${peso(row.received)}${row.difference ? ` (${row.difference < 0 ? 'short' : 'over'} ${peso(Math.abs(row.difference))})` : ''}`}
                        {row.reviewNote && ` · ${row.reviewNote}`}
                      </small>
                    </span>
                    <Badge status={RIDER_REMITTANCE_STATUS[row.status]} />
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Your handovers appear here.</p>}
          </section>
        </>
      )}
    </>
  );
}
