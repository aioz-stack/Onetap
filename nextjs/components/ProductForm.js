'use client';

// Add and edit product. Form state is one plain object, so moving between the steps and
// sections keeps everything, and new products autosave as a draft in this browser.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { RichEditor } from './RichText';
import { confirmModal } from './SellerProducts';
import { PRODUCT_CATEGORIES, SHIPPING_ZONES, STANDARD_PRODUCTS } from '@/lib/data';
import { blankProduct, chargeableWeight, DEFAULT_SPECS, LIMITS, saleRows, shippingEstimates, textBlock, totalStock, validateProduct } from '@/lib/products';
import { logisticsOptions, Products, uploadImage, uploadVideo } from '@/lib/productsApi';
import { Auth, Store } from '@/lib/store';
import { peso, toast } from '@/lib/ui';

function Field({ id, label, hint, error, optional, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional && <> <span className="field__optional">(optional)</span></>}</label>
      {children}
      {hint && <small className="field__hint">{hint}</small>}
      {error && <small className="field__error">{error}</small>}
    </div>
  );
}

function TextInput({ id, label, hint, error, optional, value, onChange, ...props }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional}>
      <input id={id} value={value} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} {...props} />
    </Field>
  );
}

function SelectInput({ id, label, error, value, onChange, options, placeholder, disabled }) {
  return (
    <Field id={id} label={label} error={error}>
      <select id={id} value={value} disabled={disabled} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </Field>
  );
}

function ImagePicker({ id, label, hint, images, max, error, onChange }) {
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState('');
  // Uploads finish one at a time, so each must add to the latest list.
  const latest = useRef(images);
  latest.current = images;

  async function add(files) {
    setProblem('');
    const room = max - latest.current.length;
    if (files.length > room) setProblem(`You can add up to ${max} ${max === 1 ? 'image' : 'images'}.`);
    const chosen = files.slice(0, room);
    setUploading(chosen.length);
    for (const file of chosen) {
      try {
        const url = await uploadImage(file);
        latest.current = [...latest.current, url];
        onChange(latest.current);
      } catch (err) {
        setProblem(err.message);
      }
      setUploading((count) => count - 1);
    }
  }

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>{label}</span>
      <div className="image-picker" role="group" aria-labelledby={`${id}-label`}>
        {images.map((url, i) => (
          <div className="image-slot" key={url}>
            <img src={url} alt={`Product image ${i + 1}`} />
            {i === 0 && max > 1 && <span className="image-slot__tag">Cover</span>}
            <button className="image-slot__remove" type="button" aria-label={`Remove image ${i + 1}`} onClick={() => onChange(images.filter((other) => other !== url))}><Icon name="close" className="icon icon--sm" /></button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => <div className="image-slot image-slot--loading" key={i} role="status">Uploading…</div>)}
        {images.length + uploading < max && (
          <label className="image-slot image-slot--add">
            <input
              className="sr-only"
              id={id}
              type="file"
              multiple={max > 1}
              accept="image/jpeg,image/png,image/webp"
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                const files = [...e.target.files];
                e.target.value = '';
                if (files.length) add(files);
              }}
            />
            <Icon name="box" />
            <span>Add Image</span>
          </label>
        )}
      </div>
      {hint && <small className="field__hint">{hint}</small>}
      {(problem || error) && <small className="field__error">{problem || error}</small>}
    </div>
  );
}

function VideoPicker({ video, error, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState('');

  async function add(file) {
    setProblem('');
    setUploading(true);
    try {
      onChange(await uploadVideo(file));
    } catch (err) {
      setProblem(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field">
      <span className="field__label">Product Video <span className="field__optional">(optional)</span></span>
      {video ? (
        <div className="video-slot">
          <video src={video.url} controls preload="metadata" aria-label="Product video" />
          <div>
            <p className="muted">{video.duration} seconds · {video.width} × {video.height} · {(video.size / 1024 / 1024).toFixed(1)} MB</p>
            <button className="btn-mini btn-mini--danger" type="button" onClick={() => onChange(null)}>Remove Video</button>
          </div>
        </div>
      ) : (
        <label className="image-slot image-slot--add video-slot__add">
          <input
            className="sr-only"
            id="product-video"
            type="file"
            accept="video/mp4"
            disabled={uploading}
            onChange={(e) => {
              const [file] = e.target.files;
              e.target.value = '';
              if (file) add(file);
            }}
          />
          <Icon name="play" />
          <span>{uploading ? 'Uploading…' : 'Add Video'}</span>
        </label>
      )}
      <small className="field__hint">MP4 only, up to 30 MB, 10 to 60 seconds, at least 1 × 1 pixels.</small>
      {(problem || error) && <small className="field__error">{problem || error}</small>}
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section className="panel product-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="panel__head"><h2 id={`${id}-title`}>{title}</h2></div>
      {children}
    </section>
  );
}

function BasicSection({ product, errors, set }) {
  const category = PRODUCT_CATEGORIES.find((c) => c.name === product.category);
  return (
    <Section id="section-basic" title="Basic Information">
      <ImagePicker id="product-images" label="Product Images" hint="Up to 9 square (1:1) JPG, PNG or WebP images, 5 MB each. The first is the cover." images={product.images} max={LIMITS.images} error={errors.images} onChange={(images) => set({ images })} />
      <VideoPicker video={product.video} error={errors.video} onChange={(video) => set({ video })} />
      <div className="form-grid">
        <TextInput id="product-name" label="Product Name" value={product.name} error={errors.name} maxLength={120} onChange={(name) => set({ name })} />
        <TextInput id="product-code" label="Product Code" value={product.code} error={errors.code} maxLength={40} onChange={(code) => set({ code })} />
        <SelectInput id="product-category" label="Category" value={product.category} error={errors.category} options={PRODUCT_CATEGORIES.map((c) => c.name)} placeholder="Choose a category" onChange={(value) => set({ category: value, subcategory: '' })} />
        <SelectInput id="product-subcategory" label="Subcategory" value={product.subcategory} error={errors.subcategory} options={category?.subcategories || []} placeholder="Choose a subcategory" disabled={!category} onChange={(subcategory) => set({ subcategory })} />
      </div>
    </Section>
  );
}

function SpecSection({ product, errors, set }) {
  const update = (i, patch) => set({ specs: product.specs.map((spec, j) => (i === j ? { ...spec, ...patch } : spec)) });
  return (
    <Section id="section-spec" title="Specification">
      <div className="form-grid">
        {product.specs.map((spec, i) => (DEFAULT_SPECS.includes(spec.name) ? (
          <TextInput key={spec.name} id={`spec-${i}`} label={spec.name} value={spec.value} error={errors[`spec.${spec.name}`]} optional={spec.name !== 'Brand'} onChange={(value) => update(i, { value })} />
        ) : (
          <div className="spec-custom" key={i}>
            <TextInput id={`spec-name-${i}`} label="Specification" value={spec.name} error={errors[`specName.${i}`]} placeholder="e.g., Material" onChange={(name) => update(i, { name })} />
            <TextInput id={`spec-value-${i}`} label="Value" value={spec.value} onChange={(value) => update(i, { value })} />
            <button className="icon-btn" type="button" aria-label={`Remove specification ${spec.name}`} onClick={() => set({ specs: product.specs.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
          </div>
        )))}
      </div>
      <button className="btn-mini product-add" type="button" onClick={() => set({ specs: [...product.specs, { name: '', value: '' }] })}>Add Specification</button>
    </Section>
  );
}

function RowInputs({ row, prefix, errors, onChange, compact }) {
  const fields = [['price', 'Price (₱)', 'decimal'], ['promo', 'Promo Price (₱)', 'decimal'], ['stock', 'Stock', 'numeric'], ['sku', 'SKU', 'text']];
  if (compact) {
    return fields.map(([field, label, mode]) => (
      <td key={field} data-label={label}>
        <input aria-label={`${label}, ${row.key}`} inputMode={mode} value={row[field] ?? ''} aria-invalid={Boolean(errors[`${prefix}.${field}`])} onChange={(e) => onChange({ [field]: e.target.value })} />
        {errors[`${prefix}.${field}`] && <small className="field__error">{errors[`${prefix}.${field}`]}</small>}
      </td>
    ));
  }
  return (
    <div className="form-grid">
      {fields.map(([field, label, mode]) => (
        <TextInput key={field} id={`single-${field}`} label={label} inputMode={mode} optional={field === 'promo' || field === 'sku'} value={row[field]} error={errors[`${prefix}.${field}`]} onChange={(value) => onChange({ [field]: value })} />
      ))}
    </div>
  );
}

function VariationGroups({ product, errors, set }) {
  const { variations } = product;
  const setGroups = (groups) => set({ variations: { ...variations, groups } });
  const update = (i, patch) => setGroups(variations.groups.map((group, j) => (i === j ? { ...group, ...patch } : group)));

  return (
    <>
      {variations.groups.map((group, i) => (
        <fieldset className="variation-group" key={i}>
          <legend>Variation {i + 1}</legend>
          <TextInput id={`group-${i}-name`} label="Name" placeholder="e.g., Size, Color or Flavor" value={group.name} error={errors[`group.${i}.name`]} onChange={(name) => update(i, { name })} />
          <div className="variation-group__options">
            {group.options.map((option, j) => (
              <div className="variation-option" key={j}>
                <input
                  aria-label={`Option ${j + 1} for variation ${i + 1}`}
                  value={option}
                  placeholder={`Option ${j + 1}`}
                  onChange={(e) => update(i, { options: group.options.map((other, k) => (k === j ? e.target.value : other)) })}
                />
                {group.options.length > 1 && <button className="icon-btn" type="button" aria-label={`Remove option ${j + 1}`} onClick={() => update(i, { options: group.options.filter((_, k) => k !== j) })}><Icon name="close" className="icon icon--sm" /></button>}
              </div>
            ))}
          </div>
          {errors[`group.${i}.options`] && <small className="field__error">{errors[`group.${i}.options`]}</small>}
          <div className="variation-group__actions">
            {group.options.length < LIMITS.variationOptions && <button className="btn-mini" type="button" onClick={() => update(i, { options: [...group.options, ''] })}>Add Option</button>}
            {variations.groups.length > 1 && <button className="btn-mini btn-mini--danger" type="button" onClick={() => setGroups(variations.groups.filter((_, j) => j !== i))}>Remove Variation</button>}
          </div>
        </fieldset>
      ))}
      {variations.groups.length < LIMITS.variationGroups && <button className="btn-mini product-add" type="button" onClick={() => setGroups([...variations.groups, { name: '', options: [''] }])}>Add Second Variation</button>}
    </>
  );
}

function SalesSection({ product, errors, set }) {
  const { variations } = product;
  const rows = saleRows(product);
  const updateRow = (key, patch) => set({ variations: { ...variations, rows: { ...variations.rows, [key]: { ...variations.rows[key], ...patch } } } });

  return (
    <Section id="section-sales" title="Sales Information">
      <label className="switch">
        <input type="checkbox" checked={variations.enabled} onChange={(e) => set({ variations: { ...variations, enabled: e.target.checked } })} />
        <span>This product has variations</span>
      </label>
      {variations.enabled ? (
        <>
          <VariationGroups product={product} errors={errors} set={set} />
          {rows.length > 0 ? (
            <div className="sales-table">
              <table>
                <thead><tr><th scope="col">Variation</th><th scope="col">Price (₱)</th><th scope="col">Promo Price (₱)</th><th scope="col">Stock</th><th scope="col">SKU</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.key}</th>
                      <RowInputs compact row={row} prefix={`row.${row.key}`} errors={errors} onChange={(patch) => updateRow(row.key, patch)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">Add variation options to set their prices.</p>}
        </>
      ) : (
        <RowInputs row={product.single} prefix="single" errors={errors} onChange={(patch) => set({ single: { ...product.single, ...patch } })} />
      )}
      <p className="sales-total">Total available stock: <strong>{totalStock(product).toLocaleString('en-PH')}</strong></p>
    </Section>
  );
}

function ShippingSection({ product, errors, set }) {
  const { shipping } = product;
  const update = (patch) => set({ shipping: { ...shipping, ...patch } });
  const [partners, setPartners] = useState([]);
  const estimates = shippingEstimates(shipping, partners);

  useEffect(() => {
    logisticsOptions().then(setPartners).catch(() => {});
  }, []);
  const weight = chargeableWeight(shipping);

  return (
    <Section id="section-shipping" title="Shipping">
      <div className="form-grid form-grid--four">
        <TextInput id="ship-weight" label="Weight (kg)" inputMode="decimal" value={shipping.weight} error={errors['shipping.weight']} onChange={(value) => update({ weight: value })} />
        <TextInput id="ship-width" label="Width (cm)" inputMode="decimal" value={shipping.width} error={errors['shipping.width']} onChange={(value) => update({ width: value })} />
        <TextInput id="ship-length" label="Length (cm)" inputMode="decimal" value={shipping.length} error={errors['shipping.length']} onChange={(value) => update({ length: value })} />
        <TextInput id="ship-height" label="Height (cm)" inputMode="decimal" value={shipping.height} error={errors['shipping.height']} onChange={(value) => update({ height: value })} />
      </div>
      <SelectInput id="ship-destination" label="Estimate delivery to" value={shipping.destination} error={errors['shipping.destination']} options={SHIPPING_ZONES} onChange={(destination) => update({ destination })} />
      <div className="ship-estimate" aria-live="polite">
        <strong>Estimated shipping fee</strong>
        {estimates.length ? (
          <>
            <ul>
              {estimates.map((estimate) => <li key={estimate.courier}><span>{estimate.courier}</span><strong>{peso(estimate.fee)}</strong></li>)}
            </ul>
            <small className="muted">Based on {weight.toFixed(2)} kg, the higher of actual and volumetric weight (L × W × H ÷ 5000).</small>
          </>
        ) : (
          <p className="muted">Enter the weight or parcel size to see rates from your active couriers.</p>
        )}
      </div>

      <fieldset className="choice">
        <legend>Pre-Order</legend>
        <label><input type="radio" name="pre-order" checked={!product.preOrder} onChange={() => set({ preOrder: false })} /> No</label>
        <label><input type="radio" name="pre-order" checked={product.preOrder} onChange={() => set({ preOrder: true })} /> Yes</label>
      </fieldset>
      {product.preOrder ? (
        <TextInput id="pre-order-days" label="Days to prepare before shipping" inputMode="numeric" hint="4 to 30 days." value={product.preOrderDays} error={errors.preOrderDays} onChange={(preOrderDays) => set({ preOrderDays })} />
      ) : (
        <p className="muted">You commit to preparing and shipping orders within 1 to 3 days.</p>
      )}
    </Section>
  );
}

function OthersSection({ product, errors, set }) {
  return (
    <Section id="section-others" title="Others">
      <div className="form-grid">
        <SelectInput id="product-condition" label="Product Condition" value={product.condition} error={errors.condition} options={['New', 'Used']} onChange={(condition) => set({ condition })} />
        <TextInput id="product-parent-sku" label="Parent SKU" optional value={product.parentSku} maxLength={40} onChange={(parentSku) => set({ parentSku })} />
      </div>
    </Section>
  );
}

const SECTIONS = [
  ['section-basic', 'Basic Information'],
  ['section-spec', 'Specification'],
  ['section-description', 'Description'],
  ['section-sales', 'Sales Information'],
  ['section-shipping', 'Shipping'],
  ['section-others', 'Others'],
];

function DetailForm({ product, set, title, onBack, onCancel, onSaved, save }) {
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState('');

  useEffect(() => {
    if (Object.keys(errors).length) document.querySelector('.product-form [aria-invalid="true"]')?.focus();
  }, [errors]);

  async function submit(action) {
    const found = validateProduct(product, action === 'publish' ? 'publish' : 'draft');
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Check the highlighted fields.', 'error');
      return;
    }
    setSaving(action);
    try {
      const saved = await save(action);
      toast(saved.status === 'suspended' ? 'Changes saved. This product stays suspended.' : action === 'publish' ? 'Your product is live.' : 'Saved and delisted.', 'success');
      onSaved(saved, action);
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      toast(err.message, 'error');
      setSaving('');
    }
  }

  return (
    <div className="order-page product-form">
      <button className="order-back" type="button" onClick={onBack}><Icon name="arrow-left" className="icon icon--sm" /> {title.back}</button>
      <div className="order-head"><div><h1 tabIndex={-1}>{title.heading}</h1><p className="muted">{title.text}</p></div></div>

      <nav className="order-tabs product-nav" aria-label="Form sections">
        {SECTIONS.map(([id, label]) => <button type="button" key={id} onClick={() => document.getElementById(id).scrollIntoView({ behavior: 'smooth' })}>{label}</button>)}
      </nav>

      <BasicSection product={product} errors={errors} set={set} />
      <SpecSection product={product} errors={errors} set={set} />
      <Section id="section-description" title="Description">
        <RichEditor id="product-description" value={product.description} error={errors.description} onChange={(description) => set({ description })} />
      </Section>
      <SalesSection product={product} errors={errors} set={set} />
      <ShippingSection product={product} errors={errors} set={set} />
      <OthersSection product={product} errors={errors} set={set} />

      <div className="product-actions">
        <button className="btn btn--ghost" type="button" disabled={Boolean(saving)} onClick={onCancel}>Cancel</button>
        <button className="btn btn--ghost" type="button" disabled={Boolean(saving)} onClick={() => submit('delist')}>{saving === 'delist' ? 'Saving…' : 'Save and Delist'}</button>
        <button className="btn btn--primary" type="button" disabled={Boolean(saving)} onClick={() => submit('publish')}>{saving === 'publish' ? 'Saving…' : 'Save and Publish'}</button>
      </div>
    </div>
  );
}

function fromTemplate(id) {
  const template = STANDARD_PRODUCTS.find((t) => t.id === id);
  if (!template) return null;
  const product = blankProduct();
  return {
    ...product,
    name: template.name,
    category: template.category,
    subcategory: template.subcategory,
    specs: product.specs.map((spec) => ({ ...spec, value: template.specs[spec.name] || '' })),
    description: [textBlock(template.description)],
  };
}

export function NewProduct({ template }) {
  const router = useRouter();
  const draftKey = `seller.${Auth.session('seller').username}.productDraft`;
  const [{ product: initial, step: initialStep, restored }] = useState(() => {
    const preset = fromTemplate(template);
    if (preset) return { product: preset, step: 1 };
    const draft = Store.get(draftKey);
    return draft ? { ...draft, restored: true } : { product: blankProduct(), step: 1 };
  });
  const [product, setProduct] = useState(initial);
  const [step, setStep] = useState(initialStep);
  const [errors, setErrors] = useState({});
  const finished = useRef(false);

  const set = (patch) => setProduct((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (restored) toast('We restored your unsaved product.');
  }, [restored]);

  useEffect(() => {
    if (finished.current) return undefined;
    const timer = setTimeout(() => Store.set(draftKey, { product, step }), 300);
    return () => clearTimeout(timer);
  }, [product, step, draftKey]);

  function discard() {
    finished.current = true;
    Store.remove(draftKey);
    router.push('/seller/products');
  }

  function cancel() {
    const untouched = !product.name && !product.code && !product.images.length;
    if (untouched) {
      discard();
      return;
    }
    confirmModal({
      title: 'Discard this product?',
      body: "Everything you've entered will be lost.",
      label: 'Discard Product',
      danger: true,
      run: async () => discard(),
    });
  }

  function next() {
    const { name, code, images } = validateProduct(product, 'draft');
    const found = Object.fromEntries(Object.entries({ images, name, code }).filter(([, message]) => message));
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Check the highlighted fields.', 'error');
      return;
    }
    setStep(2);
    window.scrollTo(0, 0);
  }

  if (step === 2) {
    return (
      <DetailForm
        product={product}
        set={set}
        title={{ back: 'Back to Step 1', heading: 'Product Details', text: 'Step 2 of 2. Your entries stay here as you move around.' }}
        onBack={() => setStep(1)}
        onCancel={cancel}
        save={(action) => Products.create(product, action)}
        onSaved={(saved, action) => {
          finished.current = true;
          Store.remove(draftKey);
          router.push(`/seller/products?tab=${action === 'publish' ? 'live' : 'unpublished'}`);
        }}
      />
    );
  }

  return (
    <div className="order-page product-start">
      <div className="order-head"><div><h1 tabIndex={-1}>Add New Product</h1><p className="muted">Step 1 of 2. Start with the essentials.</p></div></div>
      <section className="panel product-section">
        <ImagePicker id="start-image" label="Product Image" hint="One square (1:1) JPG, PNG or WebP image, up to 5 MB." images={product.images.slice(0, 1)} max={1} error={errors.images} onChange={(images) => set({ images: [...images, ...product.images.slice(1)] })} />
        <TextInput id="start-name" label="Product Name" value={product.name} error={errors.name} maxLength={120} onChange={(name) => set({ name })} />
        <TextInput id="start-code" label="Product Code" value={product.code} error={errors.code} maxLength={40} onChange={(code) => set({ code })} />
        <div className="product-actions product-actions--static">
          <button className="btn btn--ghost" type="button" onClick={cancel}>Cancel</button>
          <button className="btn btn--primary" type="button" onClick={next}>Next Step</button>
        </div>
      </section>
    </div>
  );
}

export function EditProduct({ id }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    Products.get(id).then(
      (product) => setState({ product }),
      (err) => setState({ error: err.message }),
    );
  }, [id]);

  const set = (patch) => setState((current) => ({ product: { ...current.product, ...patch } }));

  if (state.loading) {
    return <div className="order-page"><div className="order-list" role="status" aria-label="Loading product"><div className="skeleton" /><div className="skeleton" /></div></div>;
  }
  if (state.error) {
    return (
      <div className="order-page">
        <div className="panel order-empty" role="alert">
          <Icon name="box" />
          <h1 tabIndex={-1}>We couldn&apos;t open this product</h1>
          <p className="muted">{state.error}</p>
          <Link className="btn-mini" href="/seller/products">Back to My Products</Link>
        </div>
      </div>
    );
  }

  return (
    <DetailForm
      product={state.product}
      set={set}
      title={{ back: 'My Products', heading: 'Edit Product', text: 'Changes to a live product show on the marketplace as soon as you save.' }}
      onBack={() => router.push('/seller/products')}
      onCancel={() => confirmModal({
        title: 'Leave without saving?',
        body: 'Any changes you made here will be lost.',
        label: 'Leave Page',
        danger: true,
        run: async () => router.push('/seller/products'),
      })}
      save={(action) => Products.update(id, state.product, action)}
      onSaved={(saved, action) => router.push(`/seller/products?tab=${saved.status === 'suspended' ? 'violation' : action === 'publish' ? 'live' : 'unpublished'}`)}
    />
  );
}
