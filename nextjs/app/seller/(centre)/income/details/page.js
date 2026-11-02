import { SellerIncome } from '@/components/SellerIncome';

export const metadata = { title: 'Income Details' };

export default async function IncomeDetailsPage({ searchParams }) {
  return <SellerIncome view="details" initial={await searchParams} />;
}
