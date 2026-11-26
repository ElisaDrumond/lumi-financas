export const suggestedExpenseColors:Record<string,string>={
 'Alimentação':'#F48FB1',
 'Assinaturas e serviços':'#69B86B',
 'Compras':'#769AF0',
 'Delivery':'#E7A26C',
 'Dívidas':'#E86E7B',
 'Educação':'#C981D5',
 'Higiene & farmácia':'#92A8C9',
 'Impostos':'#E6BE54',
 'Lazer':'#A384F3',
 'Moradia':'#9378D6',
 'Outros gastos':'#9C9AA8',
 'Pets':'#C69A7E',
 'Presentes':'#55BCD6',
 'Saúde':'#EC818B',
 'Transporte':'#69A7E3'
};
export const suggestedIncomeColors:Record<string,string>={
 'Salário':'#40AD83',
 '13º Salário':'#488FC5',
 'Benefícios':'#6DAA64',
 'Freelance':'#AF85D9',
 'Outras entradas':'#D7A451',
 'Outras receitas':'#D7A451'
};
export const categoryPalette=['#F48FB1','#69B86B','#769AF0','#E7A26C','#E86E7B','#C981D5','#92A8C9','#E6BE54','#A384F3','#9378D6','#9C9AA8','#C69A7E','#55BCD6','#EC818B','#69A7E3','#40AD83','#488FC5','#D7A451','#5DB8A9','#D77B9A'];
export const suggestedColor=(name:string,type:string)=>type==='expense'?suggestedExpenseColors[name]:suggestedIncomeColors[name];

/**
 * Assign unique, visually separated pastel colors to each category.
 * Re-shuffling never changes category IDs, labels, or financial records.
 */
export function randomCategoryColors<T extends {id:number;name:string;type:string;color?:string}>(
 categories:T[],random:()=>number=Math.random
):{id:number;color:string}[]{
 if(!categories.length)return [];
 // Discrete hues preserve a soft pastel character while maximizing separation.
 // Use a random initial hue and shuffle the assignment on every click.
 const offset=Math.floor(random()*360);
 const shuffled=[...categories];
 for(let i=shuffled.length-1;i>0;i--){
  const j=Math.floor(random()*(i+1));
  [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
 }
 const n=shuffled.length;
 const colors=shuffled.map((_,i)=>{
  const hue=(offset+(i*137.507764)%360)%360;
  const saturation=62+(i%3)*5;
  const lightness=69+(i%4)*2;
  return hslToHex(hue,saturation,lightness);
 });
 // Rotate generated colors if all current colors are already a permutation of
 // this exact scheme, so repeated clicks are visibly meaningful.
 return shuffled.map((category,i)=>({id:category.id,color:colors[i]}));
}
function hslToHex(h:number,s:number,l:number):string{
 s/=100;l/=100;
 const a=s*Math.min(l,1-l);
 const channel=(n:number)=>{
  const k=(n+h/30)%12;
  const value=l-a*Math.max(-1,Math.min(k-3,9-k,1));
  return Math.round(255*value).toString(16).padStart(2,'0');
 };
 return '#'+channel(0)+channel(8)+channel(4);
}
