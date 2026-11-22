import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function GET(_request: NextRequest, {params}: {params:Promise<{entity:string}>}){
 const {entity}=await params;
 if(entity==='month-close-preview'){
  try{const {closingPreview}=await import('@/lib/closing');return NextResponse.json(closingPreview(_request.nextUrl.searchParams.get('period')));}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Falha ao carregar a prévia.'},{status:400});}
 }
 if(entity!=='all') return NextResponse.json({error:'Rota inválida.'},{status:404});
 try{const {readAll}=await import('@/lib/data');return NextResponse.json(readAll(_request.nextUrl.searchParams.get('period')||undefined));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Erro'},{status:400});}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{entity:string}>}){
 const {entity}=await params;
 try {
  if(entity==='month-close'||entity==='month-reopen'){
   const {closeMonth,reopenMonth}=await import('@/lib/closing');
   const payload=await request.json() as Record<string,unknown>;
   const result=entity==='month-close'?closeMonth(payload):reopenMonth(payload.period);
   return NextResponse.json({ok:true,id:Number(result.lastInsertRowid??0)});
  }
  const {updateDb}=await import('@/lib/data');
  const result=updateDb(entity,await request.json());
  return NextResponse.json({ok:true,id:Number(result.lastInsertRowid??0)});
 }
 catch(e){const message=e instanceof Error?e.message:'Erro inesperado';return NextResponse.json({error:message},{status:400});}
}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{entity:string}>}){
 const {entity}=await params;
 try {const {removeDb}=await import('@/lib/data');const id=Number(new URL(request.url).searchParams.get('id'));removeDb(entity,id);return NextResponse.json({ok:true});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Erro inesperado'},{status:400});}
}
