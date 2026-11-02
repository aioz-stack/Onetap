'use client';

// Form rendering and validation. Validation uses the browser's constraint API, so a
// field's rules live in its schema attributes.

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { toast } from '@/lib/ui';

function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <span className="password">
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        className="password__toggle"
        type="button"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        onClick={() => setShow(!show)}
      >
        <Icon name="eye" />
      </button>
    </span>
  );
}

function Field({ field, prefix }) {
  const id = `${prefix}-${field.name}`;
  const attrs = {
    id,
    name: field.name,
    required: !field.optional,
    minLength: field.minlength,
    maxLength: field.maxlength,
    pattern: field.pattern,
    placeholder: field.placeholder,
    autoComplete: field.autocomplete,
    inputMode: field.inputmode,
    accept: field.accept,
    'aria-describedby': `${id}-error${field.hint ? ` ${id}-hint` : ''}`,
  };

  let control;
  if (field.type === 'select') {
    control = (
      <select {...attrs} defaultValue={field.value}>
        {field.options.map((o) => <option key={o} value={o}>{o || 'None'}</option>)}
      </select>
    );
  } else if (field.type === 'textarea') {
    control = <textarea {...attrs} rows={4} />;
  } else if (field.type === 'password') {
    control = <PasswordInput {...attrs} />;
  } else {
    control = <input {...attrs} type={field.type || 'text'} defaultValue={field.value} />;
  }

  return (
    <div className={`field ${field.wide ? 'field--wide' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {field.optional && <> <span className="field__optional">(optional)</span></>}
      </label>
      {control}
      {field.hint && <small className="field__hint" id={`${id}-hint`}>{field.hint}</small>}
      <small className="field__error" id={`${id}-error`} />
    </div>
  );
}

export function Sections({ schema, prefix }) {
  return schema.map((section, i) => {
    const fields = section.fields.map((f) => <Field key={f.name} field={f} prefix={prefix} />);
    if (!section.legend) return <div className="form-grid" key={i}>{fields}</div>;
    return (
      <fieldset className="form-section" key={section.legend}>
        <legend>{section.legend}</legend>
        <div className="form-grid">{fields}</div>
      </fieldset>
    );
  });
}

function messageFor(input) {
  const { validity } = input;
  if (validity.valid) return '';
  const label = input.labels[0]?.firstChild.textContent.trim() || 'This field';
  if (validity.valueMissing) return `${label} is required.`;
  if (validity.typeMismatch) return `Enter a valid ${label.toLowerCase()}.`;
  if (validity.tooShort) return `Use at least ${input.minLength} characters.`;
  if (validity.patternMismatch) return document.getElementById(`${input.id}-hint`)?.textContent || `Enter a valid ${label.toLowerCase()}.`;
  return input.validationMessage;
}

function setFieldError(input, message) {
  // Controls outside a schema, such as radio choices, have no error slot.
  const slot = document.getElementById(`${input.id}-error`);
  if (!slot) return;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  slot.textContent = message;
}

// Wires validation and submission. onSubmit may throw FieldError to flag one field.
export function Form({ onSubmit, children, ...props }) {
  const formRef = useRef(null);
  const submitRef = useRef(onSubmit);

  useEffect(() => {
    submitRef.current = onSubmit;
  });

  useEffect(() => {
    const form = formRef.current;
    const controller = new AbortController();
    const { signal } = controller;

    form.addEventListener('focusout', (e) => {
      if (e.target.matches('input, select, textarea') && e.target.getAttribute('aria-invalid') !== null) {
        setFieldError(e.target, messageFor(e.target));
      }
    }, { signal });
    form.addEventListener('change', (e) => {
      if (e.target.matches('input, select, textarea')) setFieldError(e.target, messageFor(e.target));
    }, { signal });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputs = [...form.querySelectorAll('input[id], select[id], textarea[id]')];
      inputs.forEach((input) => setFieldError(input, messageFor(input)));
      const firstInvalid = inputs.find((input) => !input.validity.valid);
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      const formError = form.querySelector('.form-error');
      if (formError) formError.textContent = '';
      submit.disabled = true;
      try {
        await submitRef.current(Object.fromEntries(new FormData(form)));
      } catch (err) {
        const input = err.field && form.elements[err.field];
        if (input) {
          setFieldError(input, err.message);
          input.focus();
        } else if (formError) {
          formError.textContent = err.message;
        } else {
          toast(err.message, 'error');
        }
      } finally {
        submit.disabled = false;
      }
    }, { signal });

    return () => controller.abort();
  }, []);

  return <form ref={formRef} noValidate {...props}>{children}</form>;
}
