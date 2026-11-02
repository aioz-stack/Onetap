'use client';

// A mobile number verified by a 6-digit code texted to it. Once the code is right, the field holds
// a short-lived token in `phoneToken`, which the server spends when the form saves. Without an SMS
// provider the Sandbox sends nothing, and the code shows here, labelled as a sample.

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const normalize = (value) => {
  const match = String(value ?? '').replace(/[\s()-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
  return match ? `0${match[1]}` : '';
};

async function post(path, data) {
  const response = await fetch(`/api/customer/otp/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => null);
  if (!response) throw new Error('We could not reach the server. Check your connection and try again.');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Something went wrong. Please try again.'), { fields: body.fields || {} });
  return body;
}

export default function MobileOtpField({ field, prefix }) {
  const id = `${prefix}-${field.name}`;
  const { purpose } = field;
  const initial = field.value || '';
  const [number, setNumber] = useState(initial);
  const [stage, setStage] = useState('idle');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [sent, setSent] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);
  const input = useRef(null);
  const error = useRef(null);
  const codeInput = useRef(null);
  // In My Profile the current number is already verified, so nothing is needed until it changes.
  const unchanged = purpose === 'profile' && normalize(number) && normalize(number) === normalize(initial);

  useEffect(() => {
    if (stage !== 'sent') return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage === 'sent') codeInput.current?.focus();
  }, [stage, sent]);

  // The number's error slot is shared with the form's own validation, so it is written directly.
  function showError(message) {
    error.current.textContent = message;
    input.current.setAttribute('aria-invalid', String(Boolean(message)));
  }

  async function send() {
    if (!input.current.checkValidity() || !normalize(number)) {
      showError('Enter a Philippine mobile number, like 0917 123 4567.');
      input.current.focus();
      return;
    }
    setBusy(true);
    showError('');
    setCodeError('');
    try {
      setSent(await post('send', { contact: number, purpose }));
      setCode('');
      setStage('sent');
    } catch (err) {
      showError(err.fields.contact || err.message);
    }
    setBusy(false);
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code.');
      codeInput.current?.focus();
      return;
    }
    setBusy(true);
    setCodeError('');
    try {
      const result = await post('verify', { contact: number, purpose, code });
      setToken(result.token);
      setStage('verified');
      showError('');
    } catch (err) {
      setCodeError(err.fields.code || err.fields.contact || err.message);
    }
    setBusy(false);
  }

  function change(value) {
    setNumber(value);
    if (stage !== 'idle') {
      setStage('idle');
      setToken('');
      setSent(null);
      setCodeError('');
    }
  }

  const wait = sent ? Math.max(0, Math.ceil((sent.resendAt - clock) / 1000)) : 0;
  const onEnter = (action) => (e) => {
    // Enter here verifies the number instead of submitting the whole form.
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    }
  };

  return (
    <div className={`field field--wide otp${stage === 'verified' ? ' otp--verified' : ''}`}>
      <label htmlFor={id}>{field.label}</label>
      <div className="otp__row">
        <input
          ref={input}
          id={id}
          name={field.name}
          type="tel"
          required
          pattern={field.pattern}
          placeholder={field.placeholder}
          autoComplete={field.autocomplete}
          inputMode="tel"
          readOnly={stage === 'verified'}
          value={number}
          aria-describedby={`${id}-error ${id}-hint ${id}-status`}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onEnter(send)}
        />
        {stage === 'verified' ? (
          <button className="btn btn--ghost" type="button" onClick={() => { change(number); input.current.focus(); }}>Change</button>
        ) : !unchanged && (
          <button className="btn btn--primary" type="button" disabled={busy || wait > 0} onClick={send}>
            {stage === 'sent' ? (wait > 0 ? `Resend in ${wait}s` : 'Resend Code') : busy ? 'Sending…' : 'Send Code'}
          </button>
        )}
      </div>
      <small className="field__hint" id={`${id}-hint`}>{field.hint}</small>
      <small className="field__error" id={`${id}-error`} ref={error} />
      <div id={`${id}-status`} role="status">
        {stage === 'verified' && <p className="otp__done"><Icon name="check" /> Mobile number verified</p>}
        {unchanged && stage === 'idle' && purpose === 'profile' && <p className="otp__done otp__done--quiet"><Icon name="check" /> Verified number</p>}
        {stage === 'sent' && sent && (
          <div className="otp__code">
            <p className="otp__sent">We texted a 6-digit code to <strong>{sent.sentTo}</strong>. It expires in 5 minutes.</p>
            {sent.sandboxCode && (
              <p className="otp__sandbox" role="note"><strong>Sandbox:</strong> no SMS provider is connected, so nothing was texted. Your code is <code>{sent.sandboxCode}</code>.</p>
            )}
            <label className="sr-only" htmlFor={`${id}-code`}>Verification code</label>
            <div className="otp__row">
              <input
                ref={codeInput}
                id={`${id}-code`}
                className="otp__input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6-digit code"
                aria-invalid={Boolean(codeError)}
                aria-describedby={`${id}-code-message`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={onEnter(verify)}
              />
              <button className="btn btn--primary" type="button" disabled={busy} onClick={verify}>{busy ? 'Checking…' : 'Verify'}</button>
            </div>
            <small className="field__error" id={`${id}-code-message`}>{codeError}</small>
          </div>
        )}
      </div>
      <input type="hidden" name="phoneToken" value={token} />
    </div>
  );
}
