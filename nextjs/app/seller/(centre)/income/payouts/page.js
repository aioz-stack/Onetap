import { redirect } from 'next/navigation';

// My Balance moved to its own Finance section. Older links and notifications still land there.
export default function OldBalancePage() {
  redirect('/seller/balance');
}
