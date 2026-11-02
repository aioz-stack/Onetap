// Static content and configuration. Replace placeholders here before launch.

const CONFIG = {
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

const HOT_DEALS = ['Wireless Earbuds', 'Smart Watch', 'Power Bank', 'Korean T-Shirt', 'Tumbler 900ml', 'Arabica Beans'];

const SHOPS = [
  { id: 'shop-soundnest', name: 'SoundNest Gadgets' },
  { id: 'shop-threadline', name: 'Threadline Apparel' },
  { id: 'shop-homely', name: 'Homely Goods' },
  { id: 'shop-kapehan', name: 'Kapehan Roasters' },
];

const CATEGORIES = ['All', 'Electronics', 'Fashion', 'Home', 'Food'];

const PRODUCTS = [
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

const NOTIFICATIONS = [
  { id: 'n1', title: 'Your ₱150 welcome voucher is waiting', body: 'Sign up to use it on your first order.', time: '2h ago' },
  { id: 'n2', title: 'Payday Flash Sale starts tonight', body: 'Up to 60% OFF on Onetap Mall brands.', time: '5h ago' },
  { id: 'n3', title: 'Free shipping nationwide', body: '₱0 minimum spend for VIP members this week.', time: '1d ago' },
];

const FAQS = [
  { topic: 'Orders', q: 'How do I track my order?', a: 'Open Order Tracking in the Help Centre and enter your order number. It starts with OT- and is shown in your order confirmation.' },
  { topic: 'Orders', q: 'Can I cancel an order?', a: 'You can cancel any order the seller has not shipped yet. Once it has shipped, wait for delivery and request a return instead.' },
  { topic: 'Orders', q: 'How long does delivery take?', a: 'Metro areas usually take 2 to 4 days. Provincial deliveries usually take 4 to 8 days, depending on the courier.' },
  { topic: 'Returns', q: 'What is your return policy?', a: 'You have 7 days from delivery to request a free return for damaged, wrong or not-as-described items.' },
  { topic: 'Returns', q: 'When will I get my refund?', a: 'Refunds are released within 3 to 5 business days after the seller receives and confirms the returned item.' },
  { topic: 'Returns', q: 'What does Guaranteed Genuine or 2x Refund mean?', a: 'If an item from Onetap Mall is proven counterfeit, you get back double what you paid for it.' },
  { topic: 'Payments', q: 'What payment methods do you accept?', a: 'OnetapPay, Apple Pay, major debit and credit cards, and cash on delivery on eligible orders.' },
  { topic: 'Payments', q: 'How do I use a voucher?', a: 'Claim the voucher from the home page, then apply it at checkout. Each voucher shows its minimum spend and expiry date.' },
  { topic: 'Account', q: 'I forgot my password. What should I do?', a: 'Choose Forgot Password? on the login screen and enter your email address to receive a reset link.' },
  { topic: 'Selling', q: 'How do I become a seller?', a: 'Choose Start Selling and fill in your account, shop, personal and address details. Your shop opens in Seller Centre right after you register.' },
  { topic: 'Selling', q: 'How do I message my customers?', a: 'Log in to Seller Centre, then open the Chat box at the bottom left and switch to the Seller tab to see your inbox.' },
];

// Sample orders for Order Tracking until a real orders API exists.
const SAMPLE_ORDERS = {
  'OT-100245': { item: 'Wireless Earbuds with Noise Cancelling', steps: [['Order placed', true], ['Packed by seller', true], ['In transit', true], ['Delivered', false]] },
  'OT-100311': { item: 'Insulated Tumbler 900ml', steps: [['Order placed', true], ['Packed by seller', false], ['In transit', false], ['Delivered', false]] },
};

const RETURN_POLICY = [
  ['7-Day Free Returns', 'Request a return within 7 days of delivery if your item is damaged, wrong or not as described. Return shipping is free.'],
  ['How to request a return', 'Contact the seller through Chat or submit a ticket with your order number and a photo of the item.'],
  ['Refund timing', 'Refunds are released within 3 to 5 business days after the seller confirms the returned item.'],
  ['Guaranteed Genuine or 2x Refund', 'Items from Onetap Mall are covered. If an item is proven counterfeit, you receive double the amount paid.'],
];

const SHOP_AUTO_REPLIES = [
  'Hi! Thanks for messaging us. Yes, this is in stock and ready to ship.',
  'Orders placed before 3 PM ship the same day.',
  'Happy to help! Is there anything else you would like to know?',
];

const I18N = {
  en: {
    sellerCentre: 'Seller Centre', startSelling: 'Start Selling', downloadApp: 'Download App', followUs: 'Follow us on',
    notifications: 'Notifications', help: 'Help', signUp: 'Sign Up', login: 'Login', logout: 'Log Out', search: 'Search', hotDeals: 'Hot Deals:',
    searchPlaceholder: 'Sign up & get ₱150 OFF your first order | Search deals, brands & items',
  },
  fil: {
    sellerCentre: 'Seller Centre', startSelling: 'Magbenta', downloadApp: 'I-download ang App', followUs: 'I-follow kami sa',
    notifications: 'Mga Abiso', help: 'Tulong', signUp: 'Mag-sign Up', login: 'Mag-login', logout: 'Mag-log Out', search: 'Hanapin', hotDeals: 'Mainit na Deals:',
    searchPlaceholder: 'Mag-sign up at makakuha ng ₱150 OFF sa unang order | Maghanap ng deals at produkto',
  },
};
