import { AdminShell } from '@/components/admin/AdminShell';
import { pageAdmin } from '@/lib/server/admin';

export default async function AdminConsoleLayout({ children }) {
  const admin = await pageAdmin();
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
