'use client';

// Rider Management in the Logistics Partner Panel: registering riders, their logins, assigning
// them to pickups and deliveries, and their history and performance. The server limits every
// response to the signed-in user's own partner and decides what can be assigned.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { courierFetch, COURIER_CLIENT, dateTime, DataTable, DateFilter, FilterBar, PageHead, percent, postCourier, SelectFilter, StatCards, Tabs, TextField, useAdminList, useRefresh, Badge } from '../admin/AdminUI';
import { options, RIDER_DUTY, RIDER_REMITTANCE_STATUS, RIDER_STATUS, TASK_KIND, TASK_STATUS } from '@/lib/adminLabels';
import { Modal, peso, toast } from '@/lib/ui';

const LICENSE_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_LICENSE_BYTES = 10 * 1024 * 1024;

const licenseUrl = (id) => `/api/courier/riders/${id}/license`;
// Why a rider went offline, when it wasn't their own switch.
const DUTY_SOURCE = { logout: 'logged out', deactivated: 'deactivated by your team' };

function LicensePreview({ src, mime, name }) {
  if (!src) return null;
  return (
    <figure className="license-preview">
      {mime === 'application/pdf'
        ? <object data={src} type="application/pdf" aria-label={`Driver's license, ${name}`}><a className="link" href={src} target="_blank" rel="noopener noreferrer">Open the PDF</a></object>
        : <img src={src} alt={`Driver's license, ${name}`} />}
      <figcaption className="muted">{name}</figcaption>
    </figure>
  );
}

function RiderForm({ rider, onSaved }) {
  const [values, setValues] = useState({ firstName: rider?.firstName || '', middleName: rider?.middleName || '', lastName: rider?.lastName || '', phone: rider?.phone || '', username: rider?.username || '', ...(rider ? {} : { password: '', confirmPassword: '' }) });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (name) => (e) => setValues({ ...values, [name]: e.target.value });

  useEffect(() => () => preview && URL.revokeObjectURL(preview.src), [preview]);

  function choose(chosen) {
    setErrors((current) => ({ ...current, license: undefined }));
    if (!chosen) return;
    if (!LICENSE_TYPES.split(',').includes(chosen.type)) {
      setErrors((current) => ({ ...current, license: 'Use a JPG, PNG, WebP or PDF file.' }));
      return;
    }
    if (chosen.size > MAX_LICENSE_BYTES) {
      setErrors((current) => ({ ...current, license: 'Files must be 10 MB or smaller.' }));
      return;
    }
    setFile(chosen);
    setPreview({ src: URL.createObjectURL(chosen), mime: chosen.type, name: chosen.name });
  }

  async function submit(e) {
    e.preventDefault();
    const missing = {};
    if (!values.firstName.trim()) missing.firstName = 'Enter the first name.';
    if (!values.lastName.trim()) missing.lastName = 'Enter the last name.';
    if (!values.phone.trim()) missing.phone = 'Enter a mobile number, like 0917 123 4567.';
    if (!/^[A-Za-z0-9_.]{4,30}$/.test(values.username.trim())) missing.username = 'Use 4 to 30 letters, numbers, dots or underscores.';
    if (!rider) {
      if (values.password.length < 12) missing.password = 'Use at least 12 characters.';
      else if (values.password !== values.confirmPassword) missing.confirmPassword = 'The passwords do not match.';
      if (!file) missing.license = "Upload the rider's driver's license.";
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      setError('Check the highlighted fields.');
      return;
    }
    const data = new FormData();
    Object.entries(values).forEach(([name, value]) => data.append(name, value));
    if (file) data.append('license', file);
    setSaving(true);
    setError('');
    try {
      const body = await courierFetch(rider ? `/riders/${rider.id}` : '/riders', { method: rider ? 'PUT' : 'POST', body: data });
      toast(rider ? 'Rider updated.' : `${body.rider.name} registered.`, 'success');
      onSaved(body.rider);
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit} noValidate>
      <TextField id="rider-first" label="First Name" required maxLength={60} autoComplete="off" value={values.firstName} error={errors.firstName} onChange={set('firstName')} />
      <TextField id="rider-middle" label="Middle Name (optional)" maxLength={60} autoComplete="off" value={values.middleName} error={errors.middleName} onChange={set('middleName')} />
      <TextField id="rider-last" label="Last Name" required maxLength={60} autoComplete="off" value={values.lastName} error={errors.lastName} onChange={set('lastName')} />
      <TextField id="rider-phone" label="Contact Number" type="tel" inputMode="tel" required placeholder="0917 123 4567" hint="A Philippine mobile number." value={values.phone} error={errors.phone} onChange={set('phone')} />
      <TextField id="rider-username" label="Username" required autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={30} hint={rider ? 'The rider signs in to the Rider Panel with this. Changing it signs them out.' : 'The rider signs in to the Rider Panel with this. 4 to 30 letters, numbers, dots or underscores.'} value={values.username} error={errors.username} onChange={set('username')} />
      {!rider && (
        <>
          <TextField id="rider-new-password" label="Password" type="password" required autoComplete="new-password" minLength={12} maxLength={128} hint="At least 12 characters. Give it to the rider in person." value={values.password} error={errors.password} onChange={set('password')} />
          <TextField id="rider-confirm-password" label="Confirm Password" type="password" required autoComplete="new-password" value={values.confirmPassword} error={errors.confirmPassword} onChange={set('confirmPassword')} />
        </>
      )}
      <div className="field">
        <label htmlFor="rider-license">{rider ? "Replace Driver's License (optional)" : "Upload Driver's License"}</label>
        <input id="rider-license" type="file" accept={LICENSE_TYPES} aria-invalid={Boolean(errors.license)} aria-describedby="rider-license-hint" onChange={(e) => choose(e.target.files[0])} />
        <small className="field__hint" id="rider-license-hint">JPG, PNG, WebP or PDF, up to 10 MB. Only your company can open it.</small>
        {errors.license && <small className="field__error">{errors.license}</small>}
      </div>
      {preview
        ? <LicensePreview {...preview} />
        : rider && <LicensePreview src={licenseUrl(rider.id)} mime={rider.license.mime} name={rider.license.name} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : rider ? 'Save Changes' : 'Register Rider'}</button>
    </form>
  );
}

function LoginForm({ rider, onSaved }) {
  const [values, setValues] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = await postCourier(`/riders/${rider.id}`, { action: 'login', ...values });
      toast('Password reset. The rider was signed out.', 'success');
      onSaved(body.rider);
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <p className="muted">{rider.name} signs in to the Rider Panel at <strong>/rider</strong> with the username <strong>{rider.username}</strong> and this password. Give it to them in person, and ask them to change it after signing in.</p>
      <TextField id="rider-password" label="Password" type="password" autoComplete="new-password" required minLength={12} hint="At least 12 characters." value={values.password} error={errors.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
      <TextField id="rider-confirm" label="Confirm password" type="password" autoComplete="new-password" required value={values.confirmPassword} error={errors.confirmPassword} onChange={(e) => setValues({ ...values, confirmPassword: e.target.value })} />
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Reset Password'}</button>
    </form>
  );
}

function TaskList({ tasks, showRider }) {
  if (!tasks.length) return <p className="muted">No tasks yet.</p>;
  return (
    <ol className="timeline order-timeline">
      {tasks.map((task) => (
        <li className="is-done" key={task.id}>
          {TASK_KIND[task.kind]} {task.orderId}{showRider && `, ${task.rider}`}: <Badge status={TASK_STATUS[task.status]} />{task.note && ` ${task.note}`}
          <small>Assigned {dateTime(task.assignedAt)} by {task.assignedBy}{task.acceptedAt && ` · accepted ${dateTime(task.acceptedAt)}`}{task.finishedAt && ` · ended ${dateTime(task.finishedAt)}`}</small>
        </li>
      ))}
    </ol>
  );
}

function RiderDetail({ id, onChanged }) {
  const [rider, setRider] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => courierFetch(`/riders/${id}`).then((body) => setRider(body.rider), (err) => setError(err.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!rider) return <div className="skeleton" role="status" aria-label="Loading rider" />;

  const reopen = () => {
    onChanged();
    openRider(id, onChanged);
  };

  async function toggle() {
    setBusy(true);
    try {
      const body = await postCourier(`/riders/${id}`, { action: rider.active ? 'deactivate' : 'activate' });
      setRider(body.rider);
      toast(body.rider.active ? `${rider.name} can take tasks again.` : `${rider.name} is inactive and was signed out.`, 'success');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="assistant-form">
      <dl className="order-facts order-facts--row">
        <div><dt>Status</dt><dd><Badge status={RIDER_STATUS[rider.status]} /></dd></div>
        <div><dt>Signed in</dt><dd>{rider.online ? 'Online' : 'Offline'}{rider.dutyAt && `, since ${dateTime(rider.dutyAt)}`}</dd></div>
        <div><dt>Contact number</dt><dd><a className="link" href={`tel:${rider.phone}`}>{rider.phone}</a></dd></div>
        <div><dt>Rider Panel username</dt><dd>{rider.username}{!rider.hasLogin && ' (no password yet)'}</dd></div>
        <div><dt>Current assignment</dt><dd>{rider.current ? `${TASK_KIND[rider.current.kind]} ${rider.current.orderId} (${TASK_STATUS[rider.current.status].label})` : 'None'}</dd></div>
        <div><dt>Completed deliveries</dt><dd>{rider.completedDeliveries}</dd></div>
        <div><dt>Collected pickups</dt><dd>{rider.completedPickups}</dd></div>
        <div><dt>Pending pickups</dt><dd>{rider.pendingPickups}</dd></div>
        <div><dt>Failed deliveries</dt><dd>{rider.failedDeliveries}</dd></div>
        <div><dt>COD cash held</dt><dd>{peso(rider.cashHeld)}{rider.cashWaiting > 0 && ` (${peso(rider.cashWaiting)} awaiting your confirmation)`}</dd></div>
        <div><dt>Registered</dt><dd>{dateTime(rider.createdAt)}</dd></div>
      </dl>
      <section>
        <h3>Driver&apos;s license</h3>
        <LicensePreview src={licenseUrl(rider.id)} mime={rider.license.mime} name={rider.license.name} />
      </section>
      <div className="order-card__actions">
        <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `Edit ${rider.name}`, content: <RiderForm rider={rider} onSaved={reopen} /> })}>Edit</button>
        <button className="btn-mini" type="button" onClick={() => Modal.open({ title: `Reset password: ${rider.name}`, content: <LoginForm rider={rider} onSaved={reopen} /> })}>Reset Password</button>
        <button className="btn-mini" type="button" disabled={busy} onClick={toggle}>{rider.active ? 'Deactivate' : 'Activate'}</button>
      </div>
      <section>
        <h3>Assignment history</h3>
        <TaskList tasks={rider.history} />
      </section>
      <section>
        <h3>Sign-in log</h3>
        {rider.duty.length ? (
          <ol className="timeline order-timeline">
            {rider.duty.map((event) => <li className="is-done" key={event.at}>{event.online ? 'Signed in, Online' : 'Signed out, Offline'}<small>{dateTime(event.at)}{DUTY_SOURCE[event.source] && ` · ${DUTY_SOURCE[event.source]}`}</small></li>)}
          </ol>
        ) : <p className="muted">Not signed in yet.</p>}
      </section>
    </div>
  );
}

const openRider = (id, onChanged) => Modal.open({ title: 'Rider details', variant: 'wide', content: <RiderDetail id={id} onChanged={onChanged} /> });

export function CourierRiders({ initial }) {
  const list = useAdminList('/riders', initial, COURIER_CLIENT);
  useRefresh(list.reload);
  const counts = list.data?.counts || {};
  const metrics = list.data?.metrics;
  const dutyCounts = list.data?.dutyCounts || {};

  const add = () => Modal.open({
    title: 'Add rider',
    content: <RiderForm onSaved={(rider) => {
      list.reload();
      openRider(rider.id, list.reload);
    }} />,
  });

  return (
    <div className="order-page admin-page">
      <PageHead title="Rider Management" text="Register your riders, then assign them from a pickup or shipment. Updates every 15 seconds.">
        <button className="btn btn--primary" type="button" onClick={add}>Add Rider</button>
      </PageHead>
      {metrics && (
        <section className="panel">
          <StatCards items={[
            { label: 'Total Registered Riders', value: metrics.total },
            { label: 'Online Riders', value: metrics.online, href: '/courier/riders?duty=online' },
            { label: 'Offline Riders', value: metrics.offline, href: '/courier/riders?duty=offline' },
            { label: 'Available Riders', value: metrics.available },
            { label: 'Assigned Riders', value: metrics.assigned },
            { label: 'Pending Pickups', value: metrics.pendingPickups, href: '/courier/pickups' },
            { label: 'Active Deliveries', value: metrics.activeDeliveries, href: '/courier/riders/assignments?kind=delivery&status=accepted' },
            { label: 'Completed Deliveries', value: metrics.completedDeliveries, href: '/courier/riders/assignments?kind=delivery&status=completed' },
            { label: 'Failed Deliveries', value: metrics.failedDeliveries, href: '/courier/riders/assignments?kind=delivery&status=failed' },
          ]} />
          {metrics.pickupsWithoutRider > 0 && <p className="muted"><Link className="link" href="/courier/pickups">{metrics.pickupsWithoutRider === 1 ? '1 pickup has' : `${metrics.pickupsWithoutRider} pickups have`} no rider yet.</Link></p>}
        </section>
      )}
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All Riders'], ...options(RIDER_STATUS).map(([value, label]) => [value, label, counts[value] || 0])]} />
      <FilterBar list={list} placeholder="Rider name, username or contact number">
        <SelectFilter list={list} name="duty" label="Sign-in status" options={options(RIDER_DUTY).map(([value, label]) => [value, `${label} (${dutyCounts[value] || 0})`])} />
      </FilterBar>
      <DataTable
        list={list}
        label="Riders"
        empty="No riders here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Rider Name', render: (row) => <button className="link" type="button" onClick={() => openRider(row.id, list.reload)}>{row.name}</button> },
          { label: 'Contact Number', render: (row) => row.phone },
          { label: "Driver's License", render: (row) => <a className="link" href={licenseUrl(row.id)} target="_blank" rel="noopener noreferrer">View</a> },
          { label: 'Signed In', render: (row) => (row.active ? <>{row.online ? 'Online' : 'Offline'}{row.dutyAt && <small className="admin-cell-note">since {dateTime(row.dutyAt)}</small>}</> : '—') },
          { label: 'Availability', render: (row) => <Badge status={RIDER_STATUS[row.status]} /> },
          { label: 'Current Assignment', render: (row) => (row.current ? <>{TASK_KIND[row.current.kind]} {row.current.orderId}<small className="admin-cell-note">{row.openTasks > 1 ? `${row.openTasks} open orders` : TASK_STATUS[row.current.status].label}</small></> : '—') },
          { label: 'Completed Deliveries', render: (row) => row.completedDeliveries },
          { label: 'Pending Pickups', render: (row) => row.pendingPickups },
          { label: 'Cash Held', render: (row) => (row.cashHeld || row.cashWaiting ? <>{peso(row.cashHeld)}{row.cashWaiting > 0 && <small className="admin-cell-note">{peso(row.cashWaiting)} to confirm</small>}</> : '—') },
          { label: 'Username', render: (row) => row.username },
        ]}
      />
    </div>
  );
}

export function CourierAssignments({ initial }) {
  const list = useAdminList('/assignments', initial, COURIER_CLIENT);
  useRefresh(list.reload);
  const riders = list.data?.riders || [];

  return (
    <div className="order-page admin-page">
      <PageHead title="Assignment History" text="Every pickup and delivery task given to your riders, and how it ended." />
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(TASK_STATUS)]} />
      <FilterBar list={list} placeholder="Order, tracking, rider or contact number">
        <SelectFilter list={list} name="kind" label="Task" options={Object.entries(TASK_KIND)} />
        <SelectFilter list={list} name="rider" label="Rider" options={riders.map((rider) => [rider.id, rider.name])} />
        <DateFilter list={list} name="from" label="From" />
        <DateFilter list={list} name="to" label="To" />
      </FilterBar>
      <DataTable
        list={list}
        label="Rider assignments"
        empty="No assignments here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Order', render: (row) => <>{row.orderId}{row.tracking && <small className="admin-cell-note">{row.tracking}</small>}</> },
          { label: 'Task', render: (row) => TASK_KIND[row.kind] },
          { label: 'Rider', sort: 'rider', render: (row) => <>{row.rider}<small className="admin-cell-note">{row.phone}</small></> },
          { label: 'Status', sort: 'status', render: (row) => <><Badge status={TASK_STATUS[row.status]} />{row.note && <small className="admin-cell-note">{row.note}</small>}</> },
          { label: 'Assigned', sort: 'assigned', render: (row) => <>{dateTime(row.assignedAt)}<small className="admin-cell-note">by {row.assignedBy}</small></> },
          { label: 'Accepted', render: (row) => dateTime(row.acceptedAt) },
          { label: 'Ended', sort: 'finished', render: (row) => dateTime(row.finishedAt) },
        ]}
      />
    </div>
  );
}

const PERIODS = [7, 30, 90];

export function CourierRiderPerformance() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    courierFetch(`/rider-reports?days=${days}`).then((data) => setState({ data }), (err) => setState({ error: err.message }));
  }, [days]);

  const { data, loading, error } = state;
  const minutes = (value) => (value === null ? '—' : value < 90 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} hours`);
  return (
    <div className="order-page admin-page">
      <PageHead title="Rider Performance" text="Based on tasks assigned in the selected period. Delivery time runs from the rider accepting to delivery.">
        <label className="admin-select">
          <span className="sr-only">Period</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((period) => <option key={period} value={period}>Last {period} days</option>)}
          </select>
        </label>
        <a className="btn-mini" href={`/api/courier/rider-reports?days=${days}&format=csv`} download>Export CSV</a>
      </PageHead>
      {loading && <div className="skeleton" role="status" aria-label="Loading report" />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && (
        <>
          <section className="panel">
            <StatCards items={[
              { label: 'Tasks', value: data.totals.tasks },
              { label: 'Pickups Collected', value: data.totals.pickups },
              { label: 'Failed Pickups', value: data.totals.failedPickups },
              { label: 'Delivered', value: data.totals.delivered },
              { label: 'Failed Deliveries', value: data.totals.failedDeliveries },
              { label: 'Delivery Success', value: percent(data.totals.successRate) },
            ]} />
          </section>
          {data.rows.length ? (
            <div className="admin-table" role="region" aria-label="Performance by rider" tabIndex={0}>
              <table>
                <thead>
                  <tr>{['Rider', 'Status', 'Tasks', 'Pickups Collected', 'Failed Pickups', 'Delivered', 'Failed Deliveries', 'Declined', 'Delivery Success', 'Average Delivery Time'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td><Badge status={RIDER_STATUS[row.status]} /></td>
                      <td>{row.tasks}</td>
                      <td>{row.pickups}</td>
                      <td>{row.failedPickups}</td>
                      <td>{row.delivered}</td>
                      <td>{row.failedDeliveries}</td>
                      <td>{row.declined}</td>
                      <td>{percent(row.successRate)}</td>
                      <td>{minutes(row.averageMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="panel order-empty"><h2>No riders registered yet</h2></div>}
        </>
      )}
    </div>
  );
}

// The rider part of a shipment's details: who has each task, and assigning or changing them.
export function RiderSection({ shipment, onChanged }) {
  const { assign, riders, riderTasks } = shipment;
  const [choice, setChoice] = useState({ pickup: '', delivery: '' });
  const [busy, setBusy] = useState(false);

  async function act(data, done) {
    setBusy(true);
    try {
      await postCourier(`/shipments/${shipment.id}`, data);
      toast(done, 'success');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <section>
      <h3>Riders</h3>
      {['pickup', 'delivery'].map((kind) => {
        const task = riders[kind];
        const open = assign.open[kind];
        const label = kind === 'pickup' ? 'Pickup rider' : 'Delivery rider';
        return (
          <div className="rider-slot" key={kind}>
            <p>
              <strong>{label}:</strong> {task ? <>{task.rider}, <a className="link" href={`tel:${task.phone}`}>{task.phone}</a> <Badge status={TASK_STATUS[task.status]} /></> : 'None yet'}
            </p>
            {assign[kind] && (
              assign.riders.length ? (
                <div className="order-card__actions">
                  <label className="admin-select">
                    <span className="sr-only">{`Choose a ${label.toLowerCase()}`}</span>
                    <select value={choice[kind]} onChange={(e) => setChoice({ ...choice, [kind]: e.target.value })}>
                      <option value="">Choose a rider</option>
                      {assign.riders.map((rider) => <option key={rider.id} value={rider.id} disabled={!rider.online}>{rider.name} ({rider.phone}){rider.online ? (rider.openTasks ? `, ${rider.openTasks} open` : ', free') : ', offline'}</option>)}
                    </select>
                  </label>
                  <button className="btn-mini btn-mini--primary" type="button" disabled={busy || !choice[kind]} onClick={() => act({ action: 'assignRider', kind, riderId: choice[kind] }, open ? 'Rider changed. Both riders were notified.' : 'Rider assigned and notified.')}>
                    {open ? 'Change Rider' : 'Assign Rider'}
                  </button>
                </div>
              ) : <p className="muted">No active rider. <Link className="link" href="/courier/riders">Register or activate a rider</Link> first.</p>
            )}
            {assign[kind] && assign.riders.length > 0 && !assign.riders.some((rider) => rider.online) && <p className="muted">All your riders are offline. A rider must sign in to the Rider Panel before you can assign them.</p>}
            {kind === 'pickup' && assign.pickup && shipment.pickup?.status === 'scheduled' && <p className="muted">Assigning a rider also approves this pickup.</p>}
            {open && <button className="btn-mini" type="button" disabled={busy} onClick={() => act({ action: 'removeRider', kind }, 'Rider removed and notified.')}>Remove Rider</button>}
          </div>
        );
      })}
      {riderTasks.length > 0 && (
        <details>
          <summary>Rider history</summary>
          <TaskList tasks={riderTasks} showRider />
        </details>
      )}
    </section>
  );
}

function ReviewForm({ remittance, action, onDone }) {
  const confirm = action === 'confirm';
  const [values, setValues] = useState({ received: confirm ? String(remittance.declared) : '', note: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const short = confirm && Number(values.received) < remittance.expected;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postCourier(`/rider-remittances/${remittance.id}`, { action, ...values });
      Modal.close();
      toast(confirm ? `${remittance.reference} confirmed. The rider was told.` : `${remittance.reference} rejected. The cash is back on the rider.`, 'success');
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit}>
      <p className="muted">{remittance.rider} collected {peso(remittance.expected)} on {remittance.parcels === 1 ? '1 parcel' : `${remittance.parcels} parcels`} and says they handed over {peso(remittance.declared)}.</p>
      {confirm && <TextField id="review-received" label="Amount you received (₱)" required inputMode="decimal" value={values.received} error={errors.received} onChange={(e) => setValues({ ...values, received: e.target.value })} />}
      <TextField id="review-note" label={confirm ? (short ? 'What happened to the shortage?' : 'Note (optional)') : 'Why are you rejecting it?'} required={!confirm || short} maxLength={200} value={values.note} error={errors.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : confirm ? 'Confirm Received' : 'Reject Handover'}</button>
    </form>
  );
}

function RemittanceDetail({ id, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    courierFetch(`/rider-remittances/${id}`).then((body) => setData(body.remittance), (err) => setError(err.message));
  }, [id]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <div className="skeleton" role="status" aria-label="Loading remittance" />;

  const review = (action) => Modal.open({ title: `${action === 'confirm' ? 'Confirm' : 'Reject'} ${data.reference}`, content: <ReviewForm remittance={data} action={action} onDone={onChanged} /> });

  return (
    <div className="assistant-form">
      <dl className="order-facts order-facts--row">
        <div><dt>Status</dt><dd><Badge status={RIDER_REMITTANCE_STATUS[data.status]} /></dd></div>
        <div><dt>Rider</dt><dd>{data.rider}, {data.phone}</dd></div>
        <div><dt>Collected</dt><dd>{peso(data.expected)}</dd></div>
        <div><dt>Handed over</dt><dd>{peso(data.declared)}</dd></div>
        {data.received !== null && <div><dt>Received</dt><dd>{peso(data.received)}{data.difference ? ` (${data.difference < 0 ? 'short' : 'over'} ${peso(Math.abs(data.difference))})` : ''}</dd></div>}
        <div><dt>Submitted</dt><dd>{dateTime(data.submittedAt)}</dd></div>
        {data.reviewedAt && <div><dt>Reviewed</dt><dd>{dateTime(data.reviewedAt)} by {data.reviewedBy}</dd></div>}
        {data.note && <div><dt>Rider note</dt><dd>{data.note}</dd></div>}
        {data.reviewNote && <div><dt>Review note</dt><dd>{data.reviewNote}</dd></div>}
      </dl>
      {data.status === 'submitted' && (
        <div className="order-card__actions">
          <button className="btn-mini btn-mini--primary" type="button" onClick={() => review('confirm')}>Confirm Received</button>
          <button className="btn-mini" type="button" onClick={() => review('reject')}>Reject</button>
        </div>
      )}
      <section>
        <h3>COD parcels</h3>
        {data.orders.length ? (
          <ul className="rider-list">
            {data.orders.map((row) => (
              <li key={row.orderId}>
                <span><strong>{row.orderId}</strong> · {row.customer}<small className="muted">{dateTime(row.collectedAt)}</small></span>
                <strong>{peso(row.collected)}</strong>
              </li>
            ))}
          </ul>
        ) : <p className="muted">These parcels went back to the rider when the handover was rejected.</p>}
      </section>
    </div>
  );
}

const openRemittance = (row, onChanged) => Modal.open({ title: `Remittance ${row.reference}`, variant: 'wide', content: <RemittanceDetail id={row.id} onChanged={onChanged} /> });

export function CourierRiderRemittances({ initial }) {
  const list = useAdminList('/rider-remittances', initial, COURIER_CLIENT);
  useRefresh(list.reload);
  const summary = list.data?.summary;

  return (
    <div className="order-page admin-page">
      <p className="income-eyebrow">Finance · Remittances</p>
      <PageHead title="Rider Remittance" text="Riders hand over the COD cash they collect. Count it, then confirm what you received or reject the handover." />
      {summary && (
        <section className="panel">
          <StatCards items={[
            { label: 'Cash Held by Riders', value: peso(summary.held), href: '/courier/riders' },
            { label: 'Awaiting Confirmation', value: `${peso(summary.waiting)} (${summary.waitingCount})` },
            { label: 'Confirmed Received', value: peso(summary.received) },
            { label: 'Short Handovers', value: summary.shortages },
          ]} />
        </section>
      )}
      <Tabs list={list} name="status" label="Filter by status" tabs={[['', 'All'], ...options(RIDER_REMITTANCE_STATUS)]} />
      <FilterBar list={list} placeholder="Reference, rider or contact number">
        <SelectFilter list={list} name="rider" label="Rider" options={(list.data?.riders || []).map((rider) => [rider.id, rider.name])} />
      </FilterBar>
      <DataTable
        list={list}
        label="Rider remittances"
        empty="No handovers here yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'Reference', render: (row) => <button className="link" type="button" onClick={() => openRemittance(row, list.reload)}>{row.reference}</button> },
          { label: 'Rider', render: (row) => row.rider },
          { label: 'Parcels', render: (row) => row.parcels },
          { label: 'Collected', render: (row) => peso(row.expected) },
          { label: 'Handed Over', sort: 'amount', render: (row) => peso(row.declared) },
          { label: 'Received', render: (row) => (row.received === null ? '—' : <>{peso(row.received)}{row.difference ? <small className="admin-cell-note">{row.difference < 0 ? 'Short' : 'Over'} {peso(Math.abs(row.difference))}</small> : null}</>) },
          { label: 'Status', sort: 'status', render: (row) => <Badge status={RIDER_REMITTANCE_STATUS[row.status]} /> },
          { label: 'Submitted', sort: 'submitted', render: (row) => dateTime(row.submittedAt) },
        ]}
      />
    </div>
  );
}
