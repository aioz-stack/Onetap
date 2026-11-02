import { redirect } from 'next/navigation';
import { AdminLogin } from '@/components/admin/AdminShell';
import { currentAccount } from '@/lib/server/auth';

export default async function AdminLoginPage() {
  if (await currentAccount('admin')) redirect('/admin');
  return <AdminLogin />;
}
