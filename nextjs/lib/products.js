// Product rules shared by the seller form and the API, so both validate the same way.

import { PRODUCT_CATEGORIES, SHIPPING_ZONES } from './data';

export const PRODUCT_STATUS = {
  live: { label: 'Live', tone: 'ok' },
  violation: { label: 'Violation', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
  unpublished: { label: 'Unpublished', tone: 'neutral' },
};

export const LIMITS = {
  images: 9,
  imageBytes: 5 * 1024 * 1024,
  imageTypes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  videoBytes: 30 * 1024 * 1024,
  videoSeconds: [10, 60],
  description: 3000,
  variationGroups: 2,
  variationOptions: 20,
  preOrderDays: [4, 30],
};

export const DEFAULT_SPECS = ['Brand', 'Volume', 'Pack Size', 'Quantity'];

const IMAGE_URL = /^\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/;
const VIDEO_URL = /^\/api\/uploads\/[a-f0-9-]+\.mp4$/;

export function blankProduct() {
  return {
    name: '',
    code: '',
    images: [],
    video: null,
    category: '',
    subcategory: '',
    specs: DEFAULT_SPECS.map((name) => ({ name, value: '' })),
    description: [],
    variations: { enabled: false, groups: [{ name: '', options: [''] }], rows: {} },
    single: { price: '', promo: '', stock: '', sku: '' },
    shipping: { weight: '', width: '', length: '', height: '', destination: SHIPPING_ZONES[0] },
    preOrder: false,
    preOrderDays: '',
    condition: 'New',
    parentSku: '',
  };
}

export function textBlock(text) {
  return { type: 'p', runs: [{ text }] };
}

function runsText(runs) {
  return runs.map((run) => run.text).join('');
}

export function descriptionText(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'img') return '';
      if (block.items) return block.items.map(runsText).join('\n');
      return runsText(block.runs);
    })
    .filter(Boolean)
    .join('\n');
}

const validRuns = (runs) => Array.isArray(runs) && runs.every((run) => typeof run?.text === 'string');

function validBlocks(blocks) {
  if (!Array.isArray(blocks)) return false;
  return blocks.every((block) => {
    if (block?.type === 'img') return IMAGE_URL.test(block.src);
    if (block?.type === 'ul' || block?.type === 'ol') return Array.isArray(block.items) && block.items.every(validRuns);
    return block?.type === 'p' && validRuns(block.runs);
  });
}

function filledOptions(group) {
  return group.options.map((option) => option.trim()).filter(Boolean);
}

export function variationKeys(variations) {
  const groups = variations.groups.map(filledOptions).filter((options) => options.length);
  if (!groups.length) return [];
  return groups.reduce((keys, options) => keys.flatMap((key) => options.map((option) => (key ? `${key} / ${option}` : option))), ['']);
}

// The rows a buyer can pick from, one when there are no variations.
export function saleRows(product) {
  if (!product.variations.enabled) return [{ key: '', ...product.single }];
  return variationKeys(product.variations).map((key) => ({ key, price: '', promo: '', stock: '', sku: '', ...product.variations.rows[key] }));
}

export function totalStock(product) {
  return saleRows(product).reduce((sum, row) => sum + (Number(row.stock) || 0), 0);
}

export function priceRange(product) {
  const prices = saleRows(product).map((row) => Number(row.promo) || Number(row.price)).filter(Boolean);
  if (!prices.length) return null;
  return [Math.min(...prices), Math.max(...prices)];
}

export function salePrice(row) {
  return Number(row.promo) || Number(row.price);
}

export function findSaleRow(product, variation = '') {
  return saleRows(product).find((row) => row.key === variation);
}

// A copy of the product with one row's stock changed.
export function withStockChange(product, variation, delta) {
  const adjust = (row) => ({ ...row, stock: String(Number(row.stock) + delta) });
  if (!product.variations.enabled) return { ...product, single: adjust(product.single) };
  const rows = { ...product.variations.rows, [variation]: adjust(product.variations.rows[variation]) };
  return { ...product, variations: { ...product.variations, rows } };
}

export function chargeableWeight({ weight, width, length, height }) {
  return Math.max(Number(weight) || 0, ((Number(width) || 0) * (Number(length) || 0) * (Number(height) || 0)) / 5000);
}

// Base rate covers the first kilo, then each started half kilo adds the partner's step.
export function shippingEstimates(shipping, partners) {
  const kg = chargeableWeight(shipping);
  if (!kg) return [];
  return partners.filter((partner) => partner.zones.includes(shipping.destination)).map((partner) => ({
    courier: partner.name,
    fee: partner.base[shipping.destination] + Math.ceil(Math.max(kg - 1, 0) / 0.5) * partner.perHalfKg,
  }));
}

// What a buyer pays to ship one shop's items, and whose rates set it: the cheapest active partner
// offered to customers that delivers to the area and takes Cash on Delivery, for the items' combined
// weight. The default partner wins a tie. lines are { product, qty }. fee is 0 when nobody delivers.
export function checkoutQuote(lines, destination, partners) {
  const weight = lines.reduce((sum, { product, qty }) => sum + chargeableWeight(product.shipping) * qty, 0);
  const best = partners
    .filter((partner) => partner.forCustomers && partner.services?.includes('Cash on Delivery') && (partner.deliveryLocations || partner.zones).includes(destination))
    .map((partner) => ({ partner, fee: shippingEstimates({ weight, destination }, [partner])[0]?.fee }))
    .filter((quote) => quote.fee)
    .sort((a, b) => a.fee - b.fee || Number(Boolean(b.partner.isDefault)) - Number(Boolean(a.partner.isDefault)))[0];
  return best ? { fee: best.fee, partner: { id: best.partner.id, name: best.partner.name } } : { fee: 0, partner: null };
}

function checkAmount(value, label, errors, field) {
  const amount = Number(value);
  if (value === '' || !Number.isFinite(amount) || amount <= 0) errors[field] = `Enter a ${label} above 0.`;
  return amount;
}

function checkRow(row, errors, prefix) {
  const price = checkAmount(row.price, 'price', errors, `${prefix}.price`);
  if (row.promo !== '' && row.promo !== undefined) {
    const promo = Number(row.promo);
    if (!Number.isFinite(promo) || promo <= 0 || promo >= price) errors[`${prefix}.promo`] = 'Promo price must be above 0 and below the price.';
  }
  if (row.stock === '' || !Number.isInteger(Number(row.stock)) || Number(row.stock) < 0) errors[`${prefix}.stock`] = 'Enter a whole number, 0 or more.';
}

function checkVariations(product, errors) {
  const { groups } = product.variations;
  groups.forEach((group, i) => {
    if (!group.name.trim()) errors[`group.${i}.name`] = 'Name this variation, such as Size.';
    const options = filledOptions(group);
    if (!options.length) errors[`group.${i}.options`] = 'Add at least one option.';
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) errors[`group.${i}.options`] = 'Options must be different.';
  });
  saleRows(product).forEach((row) => checkRow(row, errors, `row.${row.key}`));
}

// mode 'draft' is the minimum for Save and Delist, 'publish' is everything.
export function validateProduct(product, mode = 'publish') {
  const errors = {};
  const name = product.name.trim();
  if (!name) errors.name = 'Product name is required.';
  else if (name.length > 120) errors.name = 'Use 120 characters or fewer.';
  if (!product.code.trim()) errors.code = 'Product code is required.';
  else if (!/^[\w.-]{1,40}$/.test(product.code.trim())) errors.code = 'Use letters, numbers, dashes, dots or underscores.';
  if (!product.images.length) errors.images = 'Add at least one product image.';
  else if (product.images.length > LIMITS.images || !product.images.every((url) => IMAGE_URL.test(url))) errors.images = `Use up to ${LIMITS.images} uploaded images.`;
  if (product.video && !VIDEO_URL.test(product.video.url)) errors.video = 'Upload the video again.';
  if (!validBlocks(product.description)) errors.description = 'The description could not be read.';
  else if (descriptionText(product.description).length > LIMITS.description) errors.description = `Use ${LIMITS.description} characters or fewer.`;
  if (mode === 'draft') return errors;

  const category = PRODUCT_CATEGORIES.find((c) => c.name === product.category);
  if (!category) errors.category = 'Choose a category.';
  else if (!category.subcategories.includes(product.subcategory)) errors.subcategory = 'Choose a subcategory.';
  if (!product.specs.find((spec) => spec.name === 'Brand')?.value.trim()) errors['spec.Brand'] = 'Brand is required. Enter No Brand if there is none.';
  product.specs.forEach((spec, i) => {
    if (!spec.name.trim() && spec.value.trim()) errors[`specName.${i}`] = 'Name this specification.';
  });
  if (!descriptionText(product.description).trim()) errors.description = 'Add a product description.';

  if (product.variations.enabled) checkVariations(product, errors);
  else checkRow(product.single, errors, 'single');

  ['weight', 'width', 'length', 'height'].forEach((field) => {
    checkAmount(product.shipping[field], field, errors, `shipping.${field}`);
  });
  if (!SHIPPING_ZONES.includes(product.shipping.destination)) errors['shipping.destination'] = 'Choose a destination.';

  if (product.preOrder) {
    const days = Number(product.preOrderDays);
    const [min, max] = LIMITS.preOrderDays;
    if (!Number.isInteger(days) || days < min || days > max) errors.preOrderDays = `Enter ${min} to ${max} days.`;
  }
  if (!['New', 'Used'].includes(product.condition)) errors.condition = 'Choose a condition.';
  return errors;
}

export const RESTRICTED_TERMS = ['replica', 'counterfeit', 'knockoff', 'fake'];

// A hint for administrators in Product Listings. It never blocks publishing.
export function reviewProduct(product) {
  const text = `${product.name} ${descriptionText(product.description)}`.toLowerCase();
  const term = RESTRICTED_TERMS.find((word) => new RegExp(`\\b${word}\\b`).test(text));
  return term ? `Your listing mentions a restricted term: "${term}".` : null;
}

// Rule-based listing checks for Product AI Optimiser.
export function qualityReport(product) {
  const specs = product.specs.filter((spec) => spec.value.trim()).length;
  const text = descriptionText(product.description);
  const checks = [
    { label: 'Clear product name', ok: product.name.trim().length >= 25, tip: 'Use at least 25 characters. Include the brand, type and key feature.' },
    { label: 'Three or more images', ok: product.images.length >= 3, tip: 'Show the product from different angles.' },
    { label: 'Product video', ok: Boolean(product.video), tip: 'Add a 10 to 60 second MP4 showing the product in use.' },
    { label: 'Detailed description', ok: text.length >= 200, tip: 'Write at least 200 characters on features, materials and care.' },
    { label: 'Four or more specifications', ok: specs >= 4, tip: 'Fill in brand, volume, pack size and quantity.' },
    { label: 'Promotional price', ok: saleRows(product).some((row) => Number(row.promo) > 0), tip: 'Add a promo price so a discount shows on your listing.' },
    { label: 'Stock available', ok: totalStock(product) > 0, tip: 'Add stock so buyers can order.' },
  ];
  return { score: Math.round((checks.filter((check) => check.ok).length / checks.length) * 100), checks };
}
