import { AdminShipments } from '@/components/admin/AdminShipments';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Shipment Monitoring' };

export default async function AdminShipmentsPage({ searchParams }) {
  await pageAdmin('shipments');
  return <AdminShipments initial={await searchParams} />;
}
