// Static content and configuration. Replace placeholders here before launch.

export const CONFIG = {
  // Placeholder listings. Download App shows a QR code for the selected store's URL.
  appLinks: [
    { store: 'App Store', icon: 'apple', url: 'https://apps.apple.com/app/onetap-shop/id0000000000' },
    { store: 'Google Play', icon: 'google-play', url: 'https://play.google.com/store/apps/details?id=com.onetap.shop' },
    { store: 'AppGallery', icon: 'appgallery', url: 'https://appgallery.huawei.com/app/C000000000' },
  ],
  social: {
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/',
  },
  supportEmail: 'support@onetap.example',
  supportHours: 'Monday to Sunday, 8:00 AM to 10:00 PM',
};

export const HOT_DEALS = ['Wireless Earbuds', 'Smart Watch', 'Power Bank', 'Korean T-Shirt', 'Tumbler 900ml', 'Arabica Beans'];

export const SHOPS = [
  { id: 'shop-soundnest', name: 'SoundNest Gadgets' },
  { id: 'shop-threadline', name: 'Threadline Apparel' },
  { id: 'shop-homely', name: 'Homely Goods' },
  { id: 'shop-kapehan', name: 'Kapehan Roasters' },
];

export const CATEGORIES = ['All', 'Electronics', 'Fashion', 'Home', 'Food'];

export const PRODUCTS = [
  { id: 'p1', name: 'Wireless Earbuds with Noise Cancelling', category: 'Electronics', price: 899, was: 1999, sold: '12.4k', rating: 4.8, emoji: '🎧', tint: '#dbeafe', shop: 'shop-soundnest' },
  { id: 'p2', name: 'Smart Watch Fitness Tracker', category: 'Electronics', price: 1299, was: 2499, sold: '8.1k', rating: 4.7, emoji: '⌚', tint: '#e0e7ff', shop: 'shop-soundnest' },
  { id: 'p3', name: 'Power Bank 20000mAh Fast Charge', category: 'Electronics', price: 749, was: 1299, sold: '21k', rating: 4.9, emoji: '🔋', tint: '#dcfce7', shop: 'shop-soundnest' },
  { id: 'p4', name: 'Korean T-Shirt Oversized Cotton', category: 'Fashion', price: 249, was: 450, sold: '33k', rating: 4.6, emoji: '👕', tint: '#fce7f3', shop: 'shop-threadline' },
  { id: 'p5', name: 'Everyday Canvas Sneakers', category: 'Fashion', price: 699, was: 1199, sold: '5.2k', rating: 4.5, emoji: '👟', tint: '#ffedd5', shop: 'shop-threadline' },
  { id: 'p6', name: 'Commuter Backpack with Laptop Sleeve', category: 'Fashion', price: 599, was: 999, sold: '9.7k', rating: 4.7, emoji: '🎒', tint: '#fef3c7', shop: 'shop-threadline' },
  { id: 'p7', name: 'Insulated Tumbler 900ml', category: 'Home', price: 349, was: 699, sold: '41k', rating: 4.9, emoji: '🥤', tint: '#cffafe', shop: 'shop-homely' },
  { id: 'p8', name: 'Rechargeable Desk Fan', category: 'Home', price: 549, was: 899, sold: '6.3k', rating: 4.4, emoji: '🌀', tint: '#e0f2fe', shop: 'shop-homely' },
  { id: 'p9', name: 'Non-Stick Frying Pan 28cm', category: 'Home', price: 459, was: 799, sold: '3.9k', rating: 4.6, emoji: '🍳', tint: '#f1f5f9', shop: 'shop-homely' },
  { id: 'p10', name: 'Arabica Beans Medium Roast 500g', category: 'Food', price: 399, was: 550, sold: '14k', rating: 4.9, emoji: '☕', tint: '#f5e6d3', shop: 'shop-kapehan' },
  { id: 'p11', name: 'Barako Ground Coffee 250g', category: 'Food', price: 189, was: 260, sold: '7.8k', rating: 4.8, emoji: '🫘', tint: '#ede0d4', shop: 'shop-kapehan' },
  { id: 'p12', name: 'Dark Chocolate Tablea Pack', category: 'Food', price: 149, was: 220, sold: '4.1k', rating: 4.7, emoji: '🍫', tint: '#f0dfd2', shop: 'shop-kapehan' },
];

export const NOTIFICATIONS = [
  { id: 'n1', title: 'Your ₱150 welcome voucher is waiting', body: 'Sign up to use it on your first order.', time: '2h ago' },
  { id: 'n2', title: 'Payday Flash Sale starts tonight', body: 'Up to 60% OFF on Onetap Mall brands.', time: '5h ago' },
  { id: 'n3', title: 'Free shipping nationwide', body: '₱0 minimum spend for VIP members this week.', time: '1d ago' },
];

export const FAQS = [
  { topic: 'Orders', q: 'How do I track my order?', a: 'Open Order Tracking in the Help Centre and enter your order number. It starts with OT- and is shown in your order confirmation.' },
  { topic: 'Orders', q: 'Can I cancel an order?', a: 'You can cancel any order the seller has not shipped yet. Once it has shipped, wait for delivery and request a return instead.' },
  { topic: 'Orders', q: 'How long does delivery take?', a: 'Metro areas usually take 2 to 4 days. Provincial deliveries usually take 4 to 8 days, depending on the courier.' },
  { topic: 'Returns', q: 'What is your return policy?', a: 'You have 7 days from delivery to request a free return for damaged, wrong or not-as-described items.' },
  { topic: 'Returns', q: 'When will I get my refund?', a: 'Refunds are released within 3 to 5 business days after the seller receives and confirms the returned item.' },
  { topic: 'Returns', q: 'What does Guaranteed Genuine or 2x Refund mean?', a: 'If an item from Onetap Mall is proven counterfeit, you get back double what you paid for it.' },
  { topic: 'Payments', q: 'What payment methods do you accept?', a: 'OnetapPay, Apple Pay, major debit and credit cards, and cash on delivery on eligible orders.' },
  { topic: 'Payments', q: 'How do I use a voucher?', a: 'Claim the voucher from the home page, then apply it at checkout. Each voucher shows its minimum spend and expiry date.' },
  { topic: 'Account', q: 'I forgot my password. What should I do?', a: 'Choose Forgot Password? on the login screen and enter your email address to receive a reset link.' },
  { topic: 'Selling', q: 'How do I become a seller?', a: 'Choose Start Selling and fill in your account, shop, personal and address details. Upload your documents too. Seller Centre opens once an administrator approves your application.' },
  { topic: 'Selling', q: 'How do I message my customers?', a: 'Log in to Seller Centre, then open the Chat box at the bottom left and switch to the Seller tab to see your inbox.' },
];

// Seller Centre sidebar. An item with `href` or `action` opens something real, the rest show a notice.
export const SELLER_NAV = [
  { label: 'Order', icon: 'cart', open: true, items: [{ label: 'My Orders', href: '/seller/orders' }, { label: 'To Ship', href: '/seller/orders/to-ship' }, { label: 'Pickup Requests', href: '/seller/orders/pickups' }, { label: 'Return / Refunds / Cancel', href: '/seller/orders/returns' }] },
  { label: 'Product', icon: 'box', open: true, items: [{ label: 'My Products', href: '/seller/products' }, { label: 'Add New Product', href: '/seller/products/new' }, { label: 'Onetap Standard Product', href: '/seller/products/standard' }, { label: 'Product AI Optimiser', href: '/seller/products/optimiser' }] },
  { label: 'Fulfilment', icon: 'truck', open: true, items: [{ label: 'Fulfilled by Onetap' }] },
  { label: 'Marketing Centre', icon: 'megaphone', open: true, items: [{ label: 'Marketing Centre' }, { label: 'Onetap Ads' }, { label: 'External Traffic Ads' }, { label: 'Affiliate Marketing' }, { label: 'Live & Video' }, { label: 'Discount' }, { label: "My Shop's Flash Deals" }, { label: 'Vouchers' }, { label: 'Campaign' }, { label: 'Best Price on Onetap' }] },
  { label: 'Customer Service', icon: 'chat', open: true, items: [{ label: 'Chat Management', href: '/seller/chat' }, { label: 'Chat AI Assistant' }, { label: 'Review Management' }] },
  { label: 'Finance', icon: 'wallet', open: true, items: [{ label: 'My Income' }, { label: 'My Balance' }, { label: 'Bank Accounts' }, { label: 'Seller Loans' }] },
  { label: 'Data', icon: 'chart', open: true, items: [{ label: 'Business Insights' }, { label: 'Account Health' }] },
  { label: 'Shop', icon: 'store', open: true, items: [{ label: 'Shop Information', action: 'shop' }, { label: 'Shop Decoration' }, { label: 'Shop Setting' }, { label: 'Appeal Management' }] },
];

export const SELLER_INSIGHTS = [
  { label: 'Sales', value: '₱0', hint: 'Total value of paid orders.' },
  { label: 'Visitors', value: '0', hint: 'Unique shoppers who viewed your shop or products.' },
  { label: 'Product Clicks', value: '0', hint: 'Times shoppers opened one of your products.' },
  { label: 'Orders', value: '0', hint: 'Orders placed with your shop.' },
  { label: 'Order Conversion Rate', value: '0.00%', hint: 'Orders divided by visitors.' },
];

// Placeholder figures for the Best Price, ads and affiliate promotions.
export const BEST_PRICE = {
  stats: [['Impressions', '82.59x'], ['Orders', '64.84x'], ['Sales', '1.33x']],
  products: ['p3', 'p7', 'p10', 'p1', 'p4'],
};

export const AFFILIATE = {
  stats: [['Sales', '₱0'], ['New Buyers', '0'], ['ROI', '—']],
  shops: '9,000+',
  products: ['p2', 'p6', 'p11'],
  potential: '+23%',
};

export const SELLER_ANNOUNCEMENTS = [
  { title: 'Electronic invoices for sellers', body: 'Keep your business details up to date so invoices can be issued to buyers on request.', time: 'Yesterday, 2:00 PM' },
  { title: 'Reminder on regulated products', body: 'Make sure you hold the licences and permits needed to sell regulated products.', time: 'Yesterday, 2:00 PM' },
];

export const SELLER_CAMPAIGNS = [
  { id: 'best-price', mark: 'Best Price', tone: 'mall', title: 'Best Price on Onetap', note: 'Valid for long term', tag: 'Cheapest on Onetap' },
  { id: 'payday', mark: '11.13', tone: 'flash', title: '11.13-15 Payday Sale', note: 'Nominations open', period: '13 Nov 2026 to 15 Nov 2026', tag: 'Big Campaign' },
  { id: 'boost', mark: 'Boost', tone: 'seller', title: 'Campaign Sales Boost', note: '1 Nov 2026 to 16 Nov 2026', tag: 'Campaign Sales Boost', view: true },
  { id: 'live', mark: 'Live', tone: 'pay', title: 'Live Xtra', note: 'Valid for long term', tag: 'Livestream' },
];

// What a seller's chat tools start with until they edit them.
export const DEFAULT_CHAT_SETTINGS = {
  greeting: { enabled: true, text: 'Hi! Thanks for reaching out. How can we help you today?' },
  shortcuts: [
    { title: 'In stock', text: 'Yes, this item is in stock and ready to ship.' },
    { title: 'Shipping time', text: 'We ship within 1 to 3 days. Delivery usually takes 2 to 8 days, depending on your location.' },
    { title: 'Thank you', text: 'Thank you for shopping with us! Let us know if you need anything else.' },
  ],
  faq: {
    enabled: false,
    items: [
      { q: 'How long does shipping take?', a: 'We ship within 1 to 3 days. Delivery usually takes 2 to 8 days, depending on your location.' },
      { q: 'Do you offer cash on delivery?', a: 'Yes, you can choose Cash on Delivery at checkout.' },
    ],
  },
};

export const CHAT_EDUCATION = [
  { q: 'What is Onetap Seller Chat?', a: 'Seller Chat is how buyers reach your shop. Messages appear in your Chat Inbox, and buyers read your replies in their chat box.' },
  { q: 'How to improve Chat Response Rate?', a: 'Reply to every buyer, even with a short answer. Turn on Agent Greetings and FAQ for quick help, and use Shortcuts for common questions. Automatic messages do not count as replies.' },
  { q: 'What is the FAQ assistant?', a: 'FAQ sends up to five questions when a buyer first opens a chat. Buyers tap a question and get your answer straight away.' },
  { q: 'What is Agent Greetings?', a: 'A message sent automatically the first time a buyer opens a chat with your shop.' },
  { q: 'What is Shortcut?', a: 'Saved replies you can drop into a chat from the inbox, so you don\'t have to type common answers.' },
  { q: 'What is chat violation and chat spam?', a: 'Sending abuse, misleading claims or repeated unwanted messages can count as a violation. Use Block if a buyer misuses chat with you.' },
  { q: 'How is Response Time measured?', a: 'It is the average time from a buyer\'s message to your next reply, across the last 30 days.' },
  { q: 'What does Resolve do?', a: 'Resolve moves a conversation to your Resolved tab. It reopens automatically if the buyer writes again.' },
];

export const PRODUCT_CATEGORIES = [
  { name: 'Food & Beverages', store: 'Food', subcategories: ['Coffee & Tea', 'Snacks', 'Pantry Staples', 'Drinks'] },
  { name: 'Electronics', store: 'Electronics', subcategories: ['Mobile Accessories', 'Audio', 'Wearables', 'Computer Accessories'] },
  { name: 'Fashion', store: 'Fashion', subcategories: ["Men's Clothing", "Women's Clothing", 'Shoes', 'Bags'] },
  { name: 'Home & Living', store: 'Home', subcategories: ['Kitchen', 'Appliances', 'Storage', 'Decor'] },
  { name: 'Health & Beauty', store: 'Home', subcategories: ['Skincare', 'Hair Care', 'Personal Care'] },
  { name: 'Toys & Hobbies', store: 'Home', subcategories: ['Toys', 'Books', 'Crafts'] },
];

// First-run logistics partners, in seed order. Rates are placeholders until contracts are signed,
// and every partner starts on the built-in sandbox. Admins manage them from then on.
export const SHIPPING_ZONES = ['Tuguegarao'];
// Where orders can be delivered. `cities` are the accepted spellings, in lower case.
export const SERVICE_AREA = { city: 'Tuguegarao City', cities: ['tuguegarao', 'tuguegarao city', 'city of tuguegarao'], province: 'Cagayan', zip: '3500' };
export const LOGISTICS_PARTNERS = [
  { id: 'jnt', name: 'J&T Express', contact: 'partners@jtexpress.example', trackingUrl: '', services: ['Standard', 'Cash on Delivery'], zones: SHIPPING_ZONES, pickupLocations: SHIPPING_ZONES, deliveryLocations: SHIPPING_ZONES, base: { Tuguegarao: 75 }, perHalfKg: 15, remittanceDays: 3, forSellers: true, forCustomers: true },
  { id: 'ninjavan', name: 'Ninja Van', contact: 'partners@ninjavan.example', trackingUrl: '', services: ['Standard', 'Cash on Delivery'], zones: SHIPPING_ZONES, pickupLocations: SHIPPING_ZONES, deliveryLocations: SHIPPING_ZONES, base: { Tuguegarao: 80 }, perHalfKg: 18, remittanceDays: 5, forSellers: true, forCustomers: true },
  { id: 'lbc', name: 'LBC Express', contact: 'partners@lbcexpress.example', trackingUrl: '', services: ['Standard', 'Next Day', 'Cash on Delivery'], zones: SHIPPING_ZONES, pickupLocations: SHIPPING_ZONES, deliveryLocations: SHIPPING_ZONES, base: { Tuguegarao: 78 }, perHalfKg: 12, remittanceDays: 7, forSellers: true, forCustomers: true },
];

// Starting points for Onetap Standard Product. The seller adds their own images, price and stock.
export const STANDARD_PRODUCTS = [
  { id: 'std-arabica', name: 'Arabica Coffee Beans Medium Roast', emoji: '☕', tint: '#f5e6d3', category: 'Food & Beverages', subcategory: 'Coffee & Tea', specs: { Volume: '500g', 'Pack Size': '1 bag', Quantity: '1' }, description: 'Whole Arabica beans roasted to a balanced medium profile. Grind just before brewing for the best flavour.' },
  { id: 'std-earbuds', name: 'Wireless Earbuds with Charging Case', emoji: '🎧', tint: '#dbeafe', category: 'Electronics', subcategory: 'Audio', specs: { 'Pack Size': '1 set', Quantity: '1' }, description: 'Bluetooth earbuds with a pocket charging case, touch controls and a built-in microphone for calls.' },
  { id: 'std-powerbank', name: 'Power Bank 20000mAh Fast Charge', emoji: '🔋', tint: '#dcfce7', category: 'Electronics', subcategory: 'Mobile Accessories', specs: { 'Pack Size': '1 piece', Quantity: '1' }, description: 'High-capacity power bank with two output ports. Charges most phones several times on a single charge.' },
  { id: 'std-shirt', name: 'Oversized Cotton T-Shirt', emoji: '👕', tint: '#fce7f3', category: 'Fashion', subcategory: "Men's Clothing", specs: { 'Pack Size': '1 piece', Quantity: '1' }, description: 'Soft cotton shirt with a relaxed oversized fit. Machine wash cold and tumble dry low.' },
  { id: 'std-tumbler', name: 'Insulated Stainless Tumbler', emoji: '🥤', tint: '#cffafe', category: 'Home & Living', subcategory: 'Kitchen', specs: { Volume: '900ml', 'Pack Size': '1 piece', Quantity: '1' }, description: 'Double-wall stainless steel tumbler that keeps drinks cold for hours. Includes a lid and straw.' },
  { id: 'std-soap', name: 'Natural Glow Bath Soap', emoji: '🧼', tint: '#ffedd5', category: 'Health & Beauty', subcategory: 'Personal Care', specs: { Volume: '90g', 'Pack Size': '3 bars', Quantity: '3' }, description: 'Gentle daily bath soap with a light scent. Suitable for all skin types.' },
];

export const RETURN_POLICY = [
  ['7-Day Free Returns', 'Request a return within 7 days of delivery if your item is damaged, wrong or not as described. Return shipping is free.'],
  ['How to request a return', 'Contact the seller through Chat or submit a ticket with your order number and a photo of the item.'],
  ['Refund timing', 'Refunds are released within 3 to 5 business days after the seller confirms the returned item.'],
  ['Guaranteed Genuine or 2x Refund', 'Items from Onetap Mall are covered. If an item is proven counterfeit, you receive double the amount paid.'],
];

export const SHOP_AUTO_REPLIES = [
  'Hi! Thanks for messaging us. Yes, this is in stock and ready to ship.',
  'Orders placed before 3 PM ship the same day.',
  'Happy to help! Is there anything else you would like to know?',
];

export const I18N = {
  en: {
    sellerCentre: 'Seller Centre', startSelling: 'Start Selling', downloadApp: 'Download App', followUs: 'Follow us on',
    notifications: 'Notifications', help: 'Help', signUp: 'Sign Up', login: 'Login', logout: 'Log Out', myPurchases: 'My Purchases', myProfile: 'My Profile', search: 'Search', hotDeals: 'Hot Deals:',
    searchPlaceholder: 'Sign up & get ₱150 OFF your first order | Search deals, brands & items',
  },
  fil: {
    sellerCentre: 'Seller Centre', startSelling: 'Magbenta', downloadApp: 'I-download ang App', followUs: 'I-follow kami sa',
    notifications: 'Mga Abiso', help: 'Tulong', signUp: 'Mag-sign Up', login: 'Mag-login', logout: 'Mag-log Out', myPurchases: 'Aking mga Binili', myProfile: 'Aking Profile', search: 'Hanapin', hotDeals: 'Mainit na Deals:',
    searchPlaceholder: 'Mag-sign up at makakuha ng ₱150 OFF sa unang order | Maghanap ng deals at produkto',
  },
};
