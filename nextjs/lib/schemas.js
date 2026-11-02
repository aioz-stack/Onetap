// Form schemas. The two registration flows are built from the same sections,
// so a field change here reaches both.

import { SERVICE_AREA, SHIPPING_ZONES } from './data';

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

const BUSINESS_TYPES = ['Individual', 'Sole Proprietor', 'Partnership', 'Corporation'];
const DOCUMENT_TYPES = 'image/jpeg,image/png,application/pdf';

function businessSection(seller) {
  return {
    legend: 'Business Details',
    fields: [
      { name: 'businessType', label: 'Business Type', type: 'select', options: BUSINESS_TYPES, value: seller?.businessType },
      { name: 'businessName', label: 'Registered Business Name', optional: true, maxlength: 100, hint: 'Leave blank if you sell as an individual.', value: seller?.businessName },
      { name: 'tin', label: 'Tax Identification Number', pattern: '[0-9]{3}-?[0-9]{3}-?[0-9]{3}(-?[0-9]{3,5})?', placeholder: '123-456-789-000', hint: '9 to 14 digits.', value: seller?.tin },
    ],
  };
}

const documentField = (name, label, hint, optional) => ({ name, label, type: 'file', accept: DOCUMENT_TYPES, hint, optional, wide: true });

const DOCUMENTS_SECTION = {
  legend: 'Documents',
  fields: [
    documentField('governmentId', 'Government ID', 'JPG, PNG or PDF, up to 10 MB.'),
    documentField('businessPermit', 'Business Permit or Registration', 'DTI, SEC or Mayor\'s Permit. Required unless you sell as an individual.', true),
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

export const SELLER_SCHEMA = [ACCOUNT_SECTION, STORE_SECTION, businessSection(), PERSONAL_SECTION, addressSection('Address', 'City / Municipality'), DOCUMENTS_SECTION];

// What an applicant can change when resubmitting. Saved values fill the form, and documents
// are only replaced if a new file is chosen.
export function applicationSchema(seller) {
  const address = addressSection('Address', 'City / Municipality');
  return [
    { legend: 'Store Details', fields: [{ ...STORE_SECTION.fields[0], value: seller?.shopName }, { ...ACCOUNT_SECTION.fields[3], value: seller?.contact }] },
    businessSection(seller),
    { ...address, fields: address.fields.map((field) => ({ ...field, value: seller?.[field.name] ?? field.value })) },
    { legend: 'Replace Documents', fields: DOCUMENTS_SECTION.fields.map((field) => ({ ...field, optional: true, hint: 'Leave empty to keep your current file.' })) },
  ];
}
// A customer's valid ID: a clear photo and its number. Both are checked by an administrator in
// Customer Approval before the account can buy.
export const VALID_ID_TYPES = 'image/jpeg,image/png,image/webp';
export const ID_NUMBER = { name: 'idNumber', label: 'ID Number', private: true, minlength: 4, maxlength: 30, pattern: '[A-Za-z0-9][A-Za-z0-9 \\-]*', placeholder: 'e.g., 1234-5678-9012-3456', hint: 'As printed on your ID. Letters, numbers, spaces and hyphens.' };
export const VALID_ID = { name: 'validId', label: 'Valid ID', type: 'file', accept: VALID_ID_TYPES, hint: 'A clear photo of the front of a government-issued ID. JPG, PNG or WebP, up to 10 MB.', wide: true };

const IDENTITY_SECTION = { legend: 'Identity Verification', fields: [VALID_ID, { ...ID_NUMBER, wide: true }] };

export const CUSTOMER_SCHEMA = [ACCOUNT_SECTION, PERSONAL_SECTION, addressSection('Complete Address', 'City / Municipality'), IDENTITY_SECTION];

// A rejected customer applies again with a new photo of their ID and its number.
export const CUSTOMER_RESUBMIT_SCHEMA = [{ fields: [VALID_ID, { ...ID_NUMBER, wide: true }] }];

export const LOGIN_SCHEMA = [{
  fields: [
    { name: 'identifier', label: 'Username / Email', autocomplete: 'username', wide: true },
    { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', wide: true },
  ],
}];

export const FORGOT_SCHEMA = [{
  fields: [{ name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email', wide: true }],
}];

export const PICKUP_METHODS = ['Pickup', 'Drop-off'];
export const PICKUP_SLOTS = ['9:00 AM to 12:00 PM', '1:00 PM to 5:00 PM'];

export function pickupRequestSchema(couriers, seller, today) {
  return [
    {
      legend: 'Schedule',
      fields: [
        { name: 'method', label: 'Handover', type: 'select', options: PICKUP_METHODS },
        { name: 'courier', label: 'Preferred courier', type: 'select', options: ['Let Onetap choose', ...couriers], hint: 'Onetap makes the final choice.' },
        { name: 'date', label: 'Preferred date', type: 'date', value: today },
        { name: 'slot', label: 'Preferred time', type: 'select', options: PICKUP_SLOTS },
        { name: 'area', label: 'Pickup area', type: 'select', options: SHIPPING_ZONES },
      ],
    },
    {
      legend: 'Contact at pickup',
      fields: [
        { name: 'contactName', label: 'Contact name', maxlength: 100, value: [seller?.firstName, seller?.lastName].filter(Boolean).join(' ') },
        { name: 'contactPhone', label: 'Contact number', type: 'tel', pattern: '\\+?[0-9][0-9 \\-]{9,15}', hint: '10 to 16 digits.', value: seller?.contact },
      ],
    },
    {
      legend: 'Parcel',
      fields: [
        { name: 'weight', label: 'Total weight (kg)', inputmode: 'decimal', pattern: '[0-9]+(\\.[0-9]+)?', hint: 'Up to 50 kg.', value: '1' },
        { name: 'parcels', label: 'Number of parcels', inputmode: 'numeric', pattern: '[0-9]+', hint: '1 to 20.', value: '1' },
        { name: 'note', label: 'Note for the courier', type: 'textarea', optional: true, maxlength: 200, wide: true },
      ],
    },
  ];
}

export function pickupScheduleSchema(pickup, today) {
  return [{
    fields: [
      { name: 'date', label: 'New date', type: 'date', value: today },
      { name: 'slot', label: 'New time', type: 'select', options: PICKUP_SLOTS, value: pickup.slot || undefined },
    ],
  }];
}

export const SELLER_CANCEL_SCHEMA = [{
  fields: [{ name: 'reason', label: 'Reason', type: 'select', options: ['Out of stock', 'Price error', 'Unable to reach buyer', 'Delivery address not covered'], wide: true }],
}];

export const REJECT_SCHEMA = [{
  fields: [{ name: 'note', label: 'Reason for rejecting', type: 'textarea', minlength: 10, maxlength: 300, hint: 'The buyer sees this message.', wide: true }],
}];

export function commissionSchema(value) {
  return [{
    fields: [{ name: 'commission', label: 'Commission rate (%)', inputmode: 'numeric', pattern: '[0-9]{1,2}', value, hint: 'Suggested: 11% to 16%', wide: true }],
  }];
}

export const TICKET_SCHEMA = [{
  fields: [
    { name: 'name', label: 'Your Name', autocomplete: 'name' },
    { name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email' },
    { name: 'topic', label: 'Topic', type: 'select', options: ['Order issue', 'Return or refund', 'Payment', 'Account', 'Selling on Onetap', 'Something else'] },
    { name: 'order', label: 'Order Number', optional: true, placeholder: 'OT-100245' },
    { name: 'message', label: 'How can we help?', type: 'textarea', minlength: 10, maxlength: 1000, wide: true },
  ],
}];

export const TRACK_SCHEMA = [{
  fields: [{ name: 'order', label: 'Order Number', placeholder: 'OT-1A2B3C4D', hint: 'You can find it in My Purchases.', wide: true }],
}];

// Filled from the customer's profile, and editable for each order.
export function checkoutSchema(customer) {
  return [{
    legend: 'Delivery Address',
    fields: [
      { name: 'name', label: 'Full Name', autocomplete: 'name', maxlength: 100, value: customer && `${customer.firstName} ${customer.lastName}`, wide: true },
      { name: 'contact', label: 'Contact Number', type: 'tel', autocomplete: 'tel', pattern: '\\+?[0-9][0-9 \\-]{9,15}', hint: '10 to 16 digits.', value: customer?.contact, wide: true },
      { name: 'street', label: 'Street', autocomplete: 'address-line1', maxlength: 150, value: customer?.street, wide: true },
      { name: 'barangay', label: 'Barangay', autocomplete: 'address-line2', maxlength: 100, value: customer?.barangay },
      { name: 'city', label: 'City', autocomplete: 'address-level2', maxlength: 100, hint: `We deliver within ${SERVICE_AREA.city} only.`, value: customer?.city },
      { name: 'province', label: 'Province', autocomplete: 'address-level1', maxlength: 100, value: customer?.province },
      { name: 'zip', label: 'Zip Code', autocomplete: 'postal-code', pattern: '[A-Za-z0-9 \\-]{4,10}', value: customer?.zip },
    ],
  }];
}

const plainText = (value) => String(value ?? '').trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');

// Shared by checkout and the server, which has the final say. Returns errors by field name.
export function serviceAddressErrors({ city, province, zip }) {
  const errors = {};
  if (!SERVICE_AREA.cities.includes(plainText(city))) errors.city = `Sorry, we only deliver within ${SERVICE_AREA.city}.`;
  if (plainText(province) !== SERVICE_AREA.province.toLowerCase()) errors.province = `${SERVICE_AREA.city} is in ${SERVICE_AREA.province}.`;
  if (plainText(zip) !== SERVICE_AREA.zip) errors.zip = `The zip code for ${SERVICE_AREA.city} is ${SERVICE_AREA.zip}.`;
  return errors;
}

export const PAYMENT_METHODS = ['Cash on Delivery', 'OnetapPay', 'Credit / Debit Card'];

export const BUYER_CANCEL_SCHEMA = [{
  fields: [{ name: 'reason', label: 'Reason', type: 'select', options: ['Ordered the wrong item', 'Changed my mind', 'Found a better price', 'Delivery is taking too long'], wide: true }],
}];

export const RETURN_REQUEST_SCHEMA = [{
  fields: [
    { name: 'type', label: 'Request', type: 'select', options: ['Return and Refund', 'Refund Only'], wide: true },
    { name: 'reason', label: 'Reason', type: 'select', options: ['Item is damaged', 'Item does not work', 'Wrong item received', 'Item is missing'], wide: true },
    { name: 'detail', label: 'Tell the seller what happened', type: 'textarea', minlength: 10, maxlength: 500, wide: true },
  ],
}];
