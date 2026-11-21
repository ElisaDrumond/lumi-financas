import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const runtime='nodejs';
export async function GET(){
 // Access the database only when the endpoint is invoked, never while Next.js
 // collects route metadata in parallel build workers.
 const {default:db}=await import('@/lib/db');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lumi-backup-'));
 const filename=path.join(dir,'financas.db');
 try{
  db.exec(`VACUUM INTO '${filename.replaceAll("'","''")}'`);
  const contents=fs.readFileSync(filename);
  return new Response(new Uint8Array(contents),{headers:{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="lumi-backup-${new Date().toISOString().slice(0,10)}.db"`,'Cache-Control':'no-store'}});
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
}
