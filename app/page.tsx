import {ConfirmDialogProvider} from '@/components/ConfirmDialog';
import Dashboard from '@/components/Dashboard';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default async function Home(){const {readAll}=await import('@/lib/data');return <ConfirmDialogProvider><Dashboard initialData={readAll()}/></ConfirmDialogProvider>}
