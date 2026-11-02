# AGENTS.md

Guide for coding agents working on Onetap, a mall and marketplace storefront.

This file covers the static version in this folder. `nextjs/` holds a Next.js port with its own [AGENTS.md](nextjs/AGENTS.md). The two do not share code, so a change in one does not reach the other.

## What this is

A static front-end prototype in plain HTML, CSS and JavaScript. There is no framework, package manager, bundler or backend.

## Run it

```bash
node serve.js
```

Then open http://localhost:5173. Opening `index.html` directly also works, and must keep working: this is why the scripts are classic `<script>` tags rather than ES modules.

There are no automated tests or linters. Verify changes in a browser, in both themes and at phone width (375px).

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, SVG icon sprite, header, home view, chat and modal containers |
| `css/styles.css` | All styles. Theme tokens are at the top |
| `js/data.js` | Content and config: store links, products, FAQs, translations |
| `js/store.js` | `Store` (localStorage wrapper) and `Auth` (mock backend) |
| `js/ui.js` | `esc`, `icon`, `peso`, `toast`, `Modal`, `Popovers`, `Theme` |
| `js/forms.js` | Registration schemas, form rendering, `bindForm` validation |
| `js/auth-views.js` | Customer login, sign-up and forgot password; Seller Centre views |
| `js/support.js` | Help Centre, FAQ search, live chat and tickets, tracking, policy |
| `js/chat.js` | Bottom-left customer and seller chat (`Threads`, `Chat`) |
| `js/app.js` | Router, storefront, cart, carousel, top bar, `ACTIONS` map |
| `vendor/qrcode.js` | qrcode-generator 1.4.4 (MIT), do not edit |

Script order in `index.html` matters. Each file uses globals from the ones before it.

## Routes

Hash routes are handled by `Router` in `js/app.js`:

- `#/` home
- `#/seller/login` and `#/seller/register` Seller Centre portal
- `#/seller/dashboard` requires a seller session
- `#/help` Help Centre

Customer login and sign-up are modals, not routes. `#products` is a same-page anchor.

## Conventions

- **Actions:** add a `data-action="name"` attribute and a matching entry in `ACTIONS` (`js/app.js`) instead of a new click listener.
- **Forms:** define fields as schema sections in `js/forms.js`, render with `renderSections`, and wire with `bindForm`. Throw `FieldError` to flag a field. Customer and seller registration share `ACCOUNT_SECTION`, `PERSONAL_SECTION` and `addressSection`. Only sellers get `STORE_SECTION`.
- **Modals:** use `Modal.open` (a single native `<dialog>`). It handles focus and Escape.
- **User content:** wrap it in `esc()` for template strings, or use `textContent`. Chat messages must never pass through `innerHTML`.
- **Colours:** use tokens from `:root`. Add a token to both `:root` and `[data-theme="dark"]`. Text and controls must meet WCAG AA (4.5:1) in both themes, including on hero gradients. Use `--link`, not `--primary`, for coloured text.
- **Icons:** add a `<symbol id="i-name">` to the sprite in `index.html`, then call `icon('name')`.
- **Storage:** always go through `Store`, never call `localStorage` directly. Keys are prefixed `onetap.`. The one exception is the theme bootstrap in `<head>`, which runs first.
- **Copy:** the brand is Onetap. The reference design's "Largo" name must not reappear.

## Mocked parts

Everything persists in the visitor's browser only.

- **Auth:** `Auth` in `js/store.js` keeps salted PBKDF2 hashes in localStorage. This is for prototyping and provides no real security. Replace it with server-side auth before launch, keeping the method signatures so views need few changes.
- **Password reset:** shows a confirmation but sends no email.
- **Chat:** `Threads` shares conversations between tabs of one browser through the `storage` event. Connecting different devices needs a realtime backend. Sample shops and the sample buyer reply automatically.
- **Support live chat:** a bot that matches FAQ text. Tickets are saved locally.
- **Order tracking:** reads `SAMPLE_ORDERS` in `js/data.js`.
- **Checkout, vouchers and products:** checkout is a stub, vouchers set a flag, and products are static data using emoji in place of photos.
- **Translation:** Filipino covers the header only.

## Replace before launch

All in `js/data.js` unless noted:

- `CONFIG.appLinks`: placeholder store URLs. Download App generates a QR code from the selected store's URL, so test each one by scanning.
- The store logos in the `index.html` sprite are simplified. Swap in the official badge artwork.
- `CONFIG.social`: currently the platform home pages.
- `CONFIG.supportEmail` and `CONFIG.supportHours`.
- `RETURN_POLICY` and `FAQS`: placeholder wording that needs legal and business review.
- Promotional claims in `index.html` (cashback, 2x refund, free shipping).
