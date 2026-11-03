'use client';

// The standard address in every form (lib/address.js): a searchable Barangay list, then a
// searchable Street list for that barangay, an optional house, building or unit number, and the
// fixed city. Changing the barangay clears the street. A street that isn't listed can be reported
// from the Street list, and can be used straight away while an administrator checks it.

import { useEffect, useId, useRef, useState } from 'react';
import { CITY, STREET_NAME_MAX } from '@/lib/address';
import { toast } from '@/lib/ui';

const MAX_SHOWN = 60;

// A text box with a filtered list under it (the ARIA combobox pattern). Its value must be one of
// the options; anything else is flagged through the browser's own validation, which Form reads.
export function SearchSelect({ id, name, label, options, value, onChange, disabled, placeholder, hintId, footer, loading }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const listId = `${id}-list`;
  // Typing clears the chosen value; that must not also wipe what is being typed.
  const typed = useRef(false);

  useEffect(() => {
    if (typed.current) typed.current = false;
    else setText(value);
  }, [value]);

  const query = text.trim().toLowerCase();
  const showAll = !query || options.some((option) => option.value === text);
  const matches = (showAll ? options : options.filter((option) => option.value.toLowerCase().includes(query))).slice(0, MAX_SHOWN);

  // The browser's validity carries the message, so Form shows it like any other field error.
  useEffect(() => {
    const exact = options.some((option) => option.value === text);
    input.current?.setCustomValidity(text && !exact ? `Choose a ${label.toLowerCase()} from the list.` : '');
  }, [text, options, label]);

  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(option) {
    setText(option.value);
    onChange(option.value);
    setOpen(false);
    // Let Form re-check the field now that it has a valid value.
    queueMicrotask(() => input.current?.dispatchEvent(new Event('change', { bubbles: true })));
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => Math.max(0, Math.min(matches.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape' && open) {
      // Closes the list only, not a dialog the form sits in.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  function onBlur(e) {
    if (e.relatedTarget && e.currentTarget.parentElement.contains(e.relatedTarget)) return;
    setOpen(false);
    // A typed name that matches an option, in any case, becomes that option.
    const exact = options.find((option) => option.value.toLowerCase() === text.trim().toLowerCase());
    if (exact && exact.value !== value) choose(exact);
  }

  return (
    <div className="search-select" onBlur={onBlur}>
      <input
        ref={input}
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
        aria-describedby={`${id}-error${hintId ? ` ${hintId}` : ''}`}
        autoComplete="off"
        required
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) {
            typed.current = true;
            onChange('');
          }
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <div className="search-select__pop">
          <ul className="search-select__list" id={listId} role="listbox" aria-label={label} ref={list}>
            {loading && <li className="search-select__empty">Loading…</li>}
            {!loading && !matches.length && <li className="search-select__empty">No match for “{text.trim()}”.</li>}
            {!loading && matches.map((option, i) => (
              <li
                key={option.value}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                className={option.value === value ? 'is-chosen' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option)}
              >
                {option.value}
                {option.note && <small>{option.note}</small>}
              </li>
            ))}
          </ul>
          {!loading && !matches.length && footer}
        </div>
      )}
    </div>
  );
}

async function loadStreets(barangay) {
  const response = await fetch(`/api/address/streets?barangay=${encodeURIComponent(barangay)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'We could not load the streets. Try again.');
  return body.streets;
}

function ReportStreet({ barangay, panel, onAdded }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  async function report() {
    if (name.trim().length < 2) {
      setError("Enter the street's name.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/address/street-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ barangay, name, panel }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.fields?.name || body.error || 'We could not send that. Try again.');
      onAdded(body.street);
      toast(body.street.status === 'listed' ? `${body.street.name} is already listed, so we chose it.` : `Thanks. You can use ${body.street.name} now, and we'll check it.`, 'success');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="report-street">
      <label htmlFor={inputId}>Street missing from {barangay}?</label>
      <div className="report-street__row">
        <input
          id={inputId}
          type="text"
          maxLength={STREET_NAME_MAX}
          placeholder="Street name, e.g., Rizal Street"
          value={name}
          aria-invalid={Boolean(error)}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter here reports the street instead of submitting the whole form.
            if (e.key === 'Enter') {
              e.preventDefault();
              report();
            }
          }}
        />
        <button className="btn-mini btn-mini--primary" type="button" disabled={busy} onClick={report}>{busy ? 'Sending…' : 'Report'}</button>
      </div>
      {error ? <small className="field__error" role="alert">{error}</small> : <small className="muted">An administrator checks each report before it joins the list.</small>}
    </div>
  );
}

// Rendered by Sections for a section made with addressSection. `panel` credits street reports to
// the signed-in customer, seller or logistics partner.
export default function AddressFields({ fields, prefix, panel = 'customer' }) {
  const field = (name) => fields.find((f) => f.name === name);
  const [barangay, setBarangay] = useState(field('barangay').value || '');
  const [street, setStreet] = useState(field('street').value || '');
  const [streets, setStreets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!barangay) {
      setStreets([]);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setLoadError('');
    loadStreets(barangay)
      .then((list) => live && setStreets(list))
      .catch((err) => live && setLoadError(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [barangay]);

  const house = field('houseNumber');
  const ids = { barangay: `${prefix}-barangay`, street: `${prefix}-street`, house: `${prefix}-houseNumber` };
  const streetOptions = streets.map((s) => ({ value: s.name, note: s.pending ? 'Awaiting check' : '' }));
  // A saved street still awaiting review is offered even before the list loads.
  if (street && !streetOptions.some((option) => option.value === street) && loading) streetOptions.push({ value: street });

  return (
    <>
      <div className="field">
        <label htmlFor={ids.barangay}>Barangay</label>
        <SearchSelect
          id={ids.barangay}
          name="barangay"
          label="Barangay"
          placeholder="Search 49 barangays"
          options={field('barangay').options.map((value) => ({ value }))}
          value={barangay}
          onChange={(next) => {
            if (next === barangay) return;
            setBarangay(next);
            // A street belongs to its barangay, so a new barangay starts the street again.
            setStreet('');
            setReporting(false);
          }}
        />
        <small className="field__error" id={`${ids.barangay}-error`} />
      </div>
      <div className="field">
        <label htmlFor={ids.street}>Street</label>
        <SearchSelect
          id={ids.street}
          name="street"
          label="Street"
          placeholder={barangay ? 'Search streets' : 'Choose a barangay first'}
          hintId={`${ids.street}-hint`}
          disabled={!barangay}
          loading={loading}
          options={streetOptions}
          value={street}
          onChange={setStreet}
          footer={barangay && !loading && (
            <button className="search-select__report" type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setReporting(true)}>
              Can&apos;t find your street? Report it
            </button>
          )}
        />
        <small className="field__hint" id={`${ids.street}-hint`}>{loadError || (barangay ? `${streets.length} streets listed in ${barangay}.` : 'Streets load after you choose a barangay.')}</small>
        <small className="field__error" id={`${ids.street}-error`} />
        {barangay && !reporting && <button className="link field__link" type="button" onClick={() => setReporting(true)}>Street not listed?</button>}
        {barangay && reporting && (
          <ReportStreet
            key={barangay}
            barangay={barangay}
            panel={panel}
            onAdded={(added) => {
              setStreets((list) => (list.some((s) => s.name === added.name) ? list : [...list, { name: added.name, pending: added.status === 'pending' }].sort((a, b) => a.name.localeCompare(b.name))));
              setStreet(added.name);
              setReporting(false);
            }}
          />
        )}
      </div>
      <div className="field">
        <label htmlFor={ids.house}>{house.label} <span className="field__optional">(optional)</span></label>
        <input id={ids.house} name="houseNumber" type="text" maxLength={house.maxlength} placeholder={house.placeholder} defaultValue={house.value} autoComplete="address-line2" aria-describedby={`${ids.house}-error`} />
        <small className="field__error" id={`${ids.house}-error`} />
      </div>
      <div className="field">
        <span className="field__label">City</span>
        <p className="address-fixed">{CITY.city}, {CITY.province} {CITY.zip}</p>
        <small className="field__hint">Onetap serves Tuguegarao City only.</small>
        <input type="hidden" name="city" value={CITY.city} />
        <input type="hidden" name="province" value={CITY.province} />
        <input type="hidden" name="zip" value={CITY.zip} />
      </div>
    </>
  );
}
