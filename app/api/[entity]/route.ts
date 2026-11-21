import { NextRequest, NextResponse } from 'next/server';
import { readAll, updateDb, removeDb } from '@/lib/data';
export const runtime = 'nodejs';
export async function GET(_request: NextRequest, {params}: {params:Promise<{entity:string}>}){
 const {entity}=await params;
 if(entity!=='all') return NextResponse.json({error:'Rota inválida.'},{status:404});
 try{return NextResponse.json(readAll(_request.nextUrl.searchParams.get('period')||undefined));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Erro'},{status:400});}
}
export async function POST(request:NextRequest,{params}:{params:Promise<{entity:string}>}){
 const {entity}=await params;
 try {const result=updateDb(entity,await request.json());return NextResponse.json({ok:true,id:Number(result.lastInsertRowid??0)});}
 catch(e){const message=e instanceof Error?e.message:'Erro inesperado';return NextResponse.json({error:message},{status:400});}
}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{entity:string}>}){
 const {entity}=await params;
 try {const id=Number(new URL(request.url).searchParams.get('id'));removeDb(entity,id);return NextResponse.json({ok:true});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Erro inesperado'},{status:400});}
}
