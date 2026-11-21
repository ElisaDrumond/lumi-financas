type Props={name?:string|null;color?:string|null};
export default function CategoryLabel({name,color}:Props){
 return <span className="finance-category-label"><span className="finance-category-dot" style={{backgroundColor:color||'#cfc7dd'}}/>{name||'Sem categoria'}</span>;
}
