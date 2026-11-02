import { redirect } from 'next/navigation';

// Bank Accounts moved to its own Finance section. Older links and notifications still land there.
export default function OldBankAccountsPage() {
  redirect('/seller/bank-accounts');
}
