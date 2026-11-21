'use client';
import {sortOptions,type SortKey} from '@/lib/sort';
export default function SortSelector({value,onChange,label='Ordenar por'}:{value:SortKey;onChange:(value:SortKey)=>void;label?:string}){
 return <label className="lumi-sort-control">{label}<select aria-label={label} value={value} onChange={event=>onChange(event.target.value as SortKey)}>{sortOptions.map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>;
}
