'use client';

// Audit log and administrator management.

import { useCallback, useEffect, useState } from 'react';
import { confirmModal } from '../SellerProducts';
import { adminFetch, Badge, dateTime, DataTable, FilterBar, PageHead, postAdmin, TextField, useAdminList } from './AdminUI';
import { ADMIN_ROLES } from '@/lib/adminRoles';
import { Modal, toast } from '@/lib/ui';

export function AdminAudit() {
  const list = useAdminList('/audit');
  return (
    <div className="order-page admin-page">
      <PageHead title="Audit Log" text="Every sensitive administrator action. Entries can't be edited." />
      <FilterBar list={list} placeholder="Person, action or target" />
      <DataTable
        list={list}
        label="Audit log"
        empty="No activity yet"
        rowKey={(row) => row.id}
        columns={[
          { label: 'When', sort: 'at', render: (row) => dateTime(row.at) },
          { label: 'Who', sort: 'admin', render: (row) => row.admin },
          { label: 'Role', render: (row) => ADMIN_ROLES[row.role]?.label || row.role },
          { label: 'Action', sort: 'action', render: (row) => row.action },
          { label: 'Target', render: (row) => `${row.target_type}: ${row.target_id}` },
          { label: 'Detail', render: (row) => (row.detail === '{}' ? '' : row.detail) },
        ]}
      />
    </div>
  );
}

function AddAdmin({ onDone }) {
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', adminRole: 'moderator' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const field = (name) => ({ value: form[name], error: errors[name], onChange: (e) => setForm({ ...form, [name]: e.target.value }) });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await postAdmin('/team', form);
      Modal.close();
      toast('Administrator added.', 'success');
      onDone();
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
      setSaving(false);
    }
  }

  return (
    <form className="assistant-form" onSubmit={submit} autoComplete="off">
      <TextField id="team-username" label="Username" required {...field('username')} />
      <TextField id="team-name" label="Name" required {...field('name')} />
      <TextField id="team-email" label="Email" type="email" required {...field('email')} />
      <TextField id="team-password" label="Temporary password" type="password" autoComplete="new-password" hint="At least 12 characters." required {...field('password')} />
      <div className="field">
        <label htmlFor="team-role">Role</label>
        <select id="team-role" value={form.adminRole} onChange={(e) => setForm({ ...form, adminRole: e.target.value })}>
          {Object.entries(ADMIN_ROLES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <button className="btn btn--primary btn--block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Administrator'}</button>
    </form>
  );
}

export function AdminTeam({ self }) {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => adminFetch('/team').then((body) => setAdmins(body.admins), (err) => setError(err.message)), []);

  useEffect(() => {
    load();
  }, [load]);

  const change = async (username, changes, message) => {
    try {
      await postAdmin(`/team/${encodeURIComponent(username)}`, changes, 'PATCH');
      toast(message, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="order-page admin-page">
      <PageHead title="Team" text="Who can open the Admin Console, and what they can do.">
        <button className="btn-mini btn-mini--primary" type="button" onClick={() => Modal.open({ title: 'Add administrator', content: <AddAdmin onDone={load} /> })}>Add Administrator</button>
      </PageHead>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!admins && !error && <div className="skeleton" role="status" aria-label="Loading team" />}
      {admins && (
        <div className="admin-table" role="region" aria-label="Administrators" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.username}>
                  <td>{admin.name}</td>
                  <td>{admin.username}</td>
                  <td>{admin.email}</td>
                  <td>
                    {admin.username === self ? ADMIN_ROLES[admin.adminRole].label : (
                      <label>
                        <span className="sr-only">Role for {admin.username}</span>
                        <select value={admin.adminRole} onChange={(e) => change(admin.username, { adminRole: e.target.value }, 'Role updated.')}>
                          {Object.entries(ADMIN_ROLES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                    )}
                  </td>
                  <td><Badge status={admin.disabled ? { label: 'Disabled', tone: 'danger' } : { label: 'Active', tone: 'ok' }} /></td>
                  <td>{dateTime(admin.createdAt)}</td>
                  <td>
                    {admin.username !== self && (admin.disabled
                      ? <button className="btn-mini" type="button" onClick={() => change(admin.username, { disabled: false }, 'Administrator enabled.')}>Enable</button>
                      : <button className="btn-mini btn-mini--danger" type="button" onClick={() => confirmModal({ title: `Disable ${admin.name}`, body: 'They are signed out and can no longer log in.', label: 'Disable', danger: true, run: () => change(admin.username, { disabled: true }, 'Administrator disabled.') })}>Disable</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
