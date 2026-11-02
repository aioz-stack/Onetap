import Icon from '@/components/Icon';
import { Carousel, Deals, DealsLink } from '@/components/Storefront';

export default function HomePage() {
  return (
    <>
      <section className="container hero-grid" aria-label="Promotions">
        <Carousel />
        <div className="promo-stack">
          <DealsLink className="promo promo--pay">
            <span className="promo__tag">Fast Pay</span>
            <h2 className="promo__title">Pay with OnetapPay &amp; Apple Pay</h2>
            <p className="promo__text">Instant checkout, 0 transaction fees &amp; 5% cashback.</p>
            <span className="promo__foot">
              <strong className="promo__highlight">₱0 Min. Spend</strong>
              <span className="apple-pay"><Icon name="apple" />Pay</span>
            </span>
          </DealsLink>
          <DealsLink className="promo promo--mall">
            <span className="promo__tag">Onetap Mall</span>
            <h2 className="promo__title">100% Authentic Brands</h2>
            <p className="promo__text">7-Day Free Returns | Guaranteed Genuine or 2x Refund.</p>
            <span className="promo__foot">
              <strong className="promo__badge">Up to 60% OFF</strong>
              <Icon name="shield" className="icon promo__shield" />
            </span>
          </DealsLink>
        </div>
      </section>
      <Deals />
    </>
  );
}
