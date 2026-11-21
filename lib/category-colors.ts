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
