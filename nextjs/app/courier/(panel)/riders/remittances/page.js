import { redirect } from 'next/navigation';

// Rider remittances moved to Finance > Remittances. Older links and notifications still land there.
export default function OldRiderRemittancesPage() {
  redirect('/courier/finance/remittances/riders');
}
