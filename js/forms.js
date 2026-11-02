// Form schemas, rendering and validation. The two registration flows are built
// from the same sections, so a field change here reaches both.

const SUFFIXES = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];

const ACCOUNT_SECTION = {
  legend: 'Account',
  fields: [
    { name: 'username', label: 'Username', autocomplete: 'username', minlength: 4, maxlength: 30, pattern: '[A-Za-z0-9_.]+', hint: 'Letters, numbers, dots and underscores only.' },
    { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', minlength: 8, hint: 'At least 8 characters.' },
    { name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email' },
    { name: 'contact', label: 'Contact Number', type: 'tel', autocomplete: 'tel', pattern: '\\+?[0-9][0-9 \\-]{9,15}', placeholder: '09171234567', hint: '10 to 16 digits.' },
  ],
};

const STORE_SECTION = {
  legend: 'Store Details',
  fields: [{ name: 'shopName', label: 'Shop Name', autocomplete: 'organization', minlength: 3, maxlength: 60, wide: true }],
};

const PERSONAL_SECTION = {
  legend: 'Personal Info',
  fields: [
    { name: 'firstName', label: 'First Name', autocomplete: 'given-name' },
    { name: 'middleName', label: 'Middle Name', autocomplete: 'additional-name' },
    { name: 'lastName', label: 'Last Name', autocomplete: 'family-name' },
    { name: 'suffix', label: 'Suffix', type: 'select', options: SUFFIXES, optional: true, autocomplete: 'honorific-suffix' },
  ],
};

function addressSection(legend, cityLabel) {
  return {
    legend,
    fields: [
      { name: 'street', label: 'Street', autocomplete: 'address-line1', wide: true },
      { name: 'barangay', label: 'Barangay', autocomplete: 'address-line2' },
      { name: 'city', label: cityLabel, autocomplete: 'address-level2' },
      { name: 'province', label: 'Province', autocomplete: 'address-level1', placeholder: 'e.g., Cagayan' },
      { name: 'country', label: 'Country', autocomplete: 'country-name', value: 'Philippines' },
      { name: 'zip', label: 'Zip Code', autocomplete: 'postal-code', pattern: '[A-Za-z0-9 \\-]{4,10}', placeholder: '3500' },
    ],
  };
}

const SELLER_SCHEMA = [ACCOUNT_SECTION, STORE_SECTION, PERSONAL_SECTION, addressSection('Address', 'City / Municipality')];
const CUSTOMER_SCHEMA = [ACCOUNT_SECTION, PERSONAL_SECTION, addressSection('Shipping Address', 'City')];

const LOGIN_SCHEMA = [{
  fields: [
    { name: 'identifier', label: 'Username / Email', autocomplete: 'username', wide: true },
    { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', wide: true },
  ],
}];

function renderField(field, prefix) {
  const id = `${prefix}-${field.name}`;
  const required = field.optional ? '' : 'required';
  const attrs = ['minlength', 'maxlength', 'pattern', 'placeholder', 'autocomplete']
    .filter((attr) => field[attr] !== undefined)
    .map((attr) => `${attr}="${esc(field[attr])}"`)
    .join(' ');
  const describedBy = `aria-describedby="${id}-error${field.hint ? ` ${id}-hint` : ''}"`;
  const label = `${esc(field.label)}${field.optional ? ' <span class="field__optional">(optional)</span>' : ''}`;

  let control;
  if (field.type === 'select') {
    const options = field.options.map((o) => `<option value="${esc(o)}">${esc(o || 'None')}</option>`).join('');
    control = `<select id="${id}" name="${field.name}" ${attrs} ${required} ${describedBy}>${options}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea id="${id}" name="${field.name}" rows="4" ${attrs} ${required} ${describedBy}></textarea>`;
  } else {
    const value = field.value ? `value="${esc(field.value)}"` : '';
    control = `<input id="${id}" name="${field.name}" type="${field.type || 'text'}" ${value} ${attrs} ${required} ${describedBy}>`;
  }
  if (field.type === 'password') {
    control = `<span class="password">${control}<button class="password__toggle" type="button" data-password-toggle aria-label="Show password" aria-pressed="false">${icon('eye')}</button></span>`;
  }

  return `
    <div class="field ${field.wide ? 'field--wide' : ''}">
      <label for="${id}">${label}</label>
      ${control}
      ${field.hint ? `<small class="field__hint" id="${id}-hint">${esc(field.hint)}</small>` : ''}
      <small class="field__error" id="${id}-error"></small>
    </div>`;
}

function renderSections(schema, prefix) {
  return schema.map((section) => {
    const fields = section.fields.map((f) => renderField(f, prefix)).join('');
    if (!section.legend) return `<div class="form-grid">${fields}</div>`;
    return `<fieldset class="form-section"><legend>${esc(section.legend)}</legend><div class="form-grid">${fields}</div></fieldset>`;
  }).join('');
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
  input.setAttribute('aria-invalid', String(Boolean(message)));
  document.getElementById(`${input.id}-error`).textContent = message;
}

// Wires validation and submission. onSubmit may throw FieldError to flag one field.
function bindForm(form, onSubmit) {
  form.noValidate = true;
  form.addEventListener('focusout', (e) => {
    if (e.target.matches('input, select, textarea') && e.target.getAttribute('aria-invalid') !== null) {
      setFieldError(e.target, messageFor(e.target));
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('input, select, textarea')) setFieldError(e.target, messageFor(e.target));
  });

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
      await onSubmit(Object.fromEntries(new FormData(form)));
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
  });
}

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-password-toggle]');
  if (!toggle) return;
  const input = toggle.previousElementSibling;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(show));
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
