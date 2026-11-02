import { AdminAudit } from '@/components/admin/AdminTeam';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Audit Log' };

export default async function AdminAuditPage() {
  await pageAdmin('audit');
  return <AdminAudit />;
}
