import { Inter } from 'next/font/google';
import ChatBox from '@/components/ChatBox';
import Header from '@/components/Header';
import { CustomerApprovalBanner, CustomerSession, Footer, ModalHost, RouteFocus, Toasts } from '@/components/Overlays';
import { StorefrontProvider } from '@/components/Storefront';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata = {
  title: { default: 'Onetap | Mall & Marketplace', template: '%s | Onetap' },
  description: 'Onetap is a mall and marketplace for daily deals, authentic brands and free shipping nationwide.',
  icons: { icon: { url: '/logo.svg', type: 'image/svg+xml' } },
};

// Runs before first paint so a saved dark theme never flashes light.
const themeScript = `(function () {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem('onetap.theme')); } catch (e) {}
  var prefersDark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <StorefrontProvider>
          <Header />
          <CustomerApprovalBanner />
          <main id="main">{children}</main>
          <Footer />
          <ChatBox />
          <ModalHost />
          <Toasts />
          <RouteFocus />
          <CustomerSession />
        </StorefrontProvider>
      </body>
    </html>
  );
}
