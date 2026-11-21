import Dashboard from '@/components/Dashboard';
import { readAll } from '@/lib/data';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default function Home(){return <Dashboard initialData={readAll()}/>}
