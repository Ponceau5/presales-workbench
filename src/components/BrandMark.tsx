export function BrandMark({size=32}:{size?:number}){
 return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <rect width="40" height="40" rx="12" fill="currentColor"/>
  <path d="M11 25V16a3 3 0 013-3h10M29 15v9a3 3 0 01-3 3H16" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
  <path d="M16 23l4-6 4 6" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
 </svg>;
}
