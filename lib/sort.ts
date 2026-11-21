export type SortKey='date-asc'|'date-desc'|'name-asc'|'name-desc'|'amount-asc'|'amount-desc';
export const sortOptions:[SortKey,string][]=[
 ['date-asc','Data: mais antiga'],['date-desc','Data: mais recente'],
 ['name-asc','Nome: A–Z'],['name-desc','Nome: Z–A'],
 ['amount-asc','Valor: menor primeiro'],['amount-desc','Valor: maior primeiro']
];
export function sortRecords<T>(rows:T[],choice:SortKey,getters:{date:(row:T)=>string;name:(row:T)=>string;amount:(row:T)=>number}):T[]{
 const [field,direction]=choice.split('-') as ['date'|'name'|'amount','asc'|'desc'];
 return [...rows].sort((a,b)=>{
  const result=field==='date'?getters.date(a).localeCompare(getters.date(b)):
   field==='name'?getters.name(a).localeCompare(getters.name(b),'pt-BR',{sensitivity:'base'}):
    getters.amount(a)-getters.amount(b);
  return direction==='asc'?result:-result;
 });
}
