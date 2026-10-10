// Shared server-owned product defaults and printing estimates. Never accept client-supplied costs.
export const seedProducts=[
 {id:'name-clicker',title:'Personalised Name Clicker',price:3.50,category:'Clickers',description:'Custom lettering and colors. A tiny tactile treat.',image:'/assets/product-8.webp'},
 {id:'game-switch',title:'Game Switch Clicker',price:null,category:'Clickers',description:'Playful handheld-inspired clicker. Ask us for a quote.',image:'/assets/product-3.webp'},
 {id:'switch-keychain',title:'Game Switch Clicker Keychain',price:null,category:'Keychains',description:'Gaming-inspired keychain clicker with custom options.',image:'/assets/product-4.webp'},
 {id:'coin-bank',title:'Custom Coin Bank',price:7,category:'Gifts',description:'Fun personalized coin bank for gifting.',image:'/assets/product-7.webp'},
 {id:'license-plate',title:'Custom License Plate Keychain',price:null,category:'Keychains',description:'A miniature custom license plate for your keys.',image:'/assets/product-2.webp'},
 {id:'clicker-color',title:'Neon Game Switch Clicker',price:null,category:'Clickers',description:'Colorful personalized game clicker. Ask for details.',image:'/assets/product-5.webp'},
 {id:'gift-packaging',title:'Custom Name Keychain',price:null,category:'Keychains',description:'Personalised little gift for someone special.',image:'/assets/product-6.webp'},
 {id:'coin-bank-color',title:'Coin Bank — Color Options',price:7,category:'Gifts',description:'Select your favorite colors and wording.',image:'/assets/product-1.webp'}
];
export function isSeed(id){return seedProducts.some(p=>p.id===id)}
export function mergeCatalog(extra=[]){const map=new Map(seedProducts.map(p=>[p.id,{...p,print_weight_g:null,print_minutes:null,print_cost_cents:null,visible:true}]));for(const p of extra){if(!p||typeof p.id!=='string')continue;map.set(p.id,{...(map.get(p.id)||{}),...p})}return [...map.values()]}
export function parsePrintFields(form){const fields=['print_weight_g','print_minutes','print_cost'];const values=fields.map(k=>String(form.get(k)??'').trim());if(values.every(x=>!x))return {print_weight_g:null,print_minutes:null,print_cost_cents:null};if(values.some(x=>!x))return {error:'Enter all three printing fields, or leave all three blank'};
 const [weight,time,cost]=values;
 if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(weight)||!/^\d{1,6}$/.test(time)||!/^\d{1,6}(?:\.\d{1,2})?$/.test(cost))return {error:'Printing weight, minutes or BND cost format invalid'};
 const w=Number(weight),m=Number(time),c=Math.round(Number(cost)*100);
 if(w<=0||w>100000||m<=0||m>100000||c<0||c>100000000)return {error:'Check printing weight, time or cost limits'};
 return {print_weight_g:w,print_minutes:m,print_cost_cents:c};
}
export function snapshot(p){const ok=Number.isFinite(p.print_weight_g)&&p.print_weight_g>0&&Number.isSafeInteger(p.print_minutes)&&p.print_minutes>0&&Number.isSafeInteger(p.print_cost_cents)&&p.print_cost_cents>=0;return {print_weight_g:ok?p.print_weight_g:null,print_minutes:ok?p.print_minutes:null,print_cost_cents:ok?p.print_cost_cents:null}}
export function summarizeItems(items){let weight_mg=0,print_minutes=0,print_cost_cents=0,covered=0;for(const item of items){const q=Number(item.quantity),w=Number(item.print_weight_g),m=Number(item.print_minutes),c=Number(item.print_cost_cents);if(!Number.isSafeInteger(q)||q<1||item.print_weight_g==null||item.print_minutes==null||item.print_cost_cents==null||!Number.isFinite(w)||w<=0||!Number.isSafeInteger(m)||m<=0||!Number.isSafeInteger(c)||c<0)continue;weight_mg+=Math.round(w*1000)*q;print_minutes+=m*q;print_cost_cents+=c*q;covered+=q}const total=items.reduce((n,i)=>n+Number(i.quantity||0),0);return {weight_mg,print_minutes,print_cost_cents,covered,total,complete:covered===total&&total>0}}
