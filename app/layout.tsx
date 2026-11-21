import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Lumi — Minhas Finanças',description:'Controle financeiro pessoal local com Next.js e SQLite'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
