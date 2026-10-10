// Server-owned material recipes. All gram quantities are stored as integer milligrams.
const plain=x=>String(x??'').trim();
const maxQty=10000000;
const gramsAsMg=v=>{const s=plain(v);if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(s))return null;const n=Math.round(Number(s)*1000);return n>0&&n<=100000000? n:null};
const qtyAsInt=v=>{const s=plain(v);if(!/^\d{1,7}$/.test(s))return null;const n=Number(s);return n>0&&n<=maxQty?n:null};
const key=(m,c)=>plain(m).toLocaleLowerCase()+'\0'+plain(c).toLocaleLowerCase();
export const readableMaterials=arr=>(Array.isArray(arr)?arr:[]).map(x=>x.kind==='filament'?`${x.material} ${x.color}: ${(x.quantity_mg/1000).toFixed(3)} g`:`${x.name||'Accessory'}: ${x.quantity_units} ${x.unit||'pcs'}`).join(' · ');
export function recipeFromCatalog(p){return Array.isArray(p.materials)?p.materials:[]}
export async function validateRecipe(db,raw,{printWeightG=null,requireFilament=true}={}){
 if(!Array.isArray(raw)||raw.length>30)throw Error('Choose up to 30 material rows');
 const rolls=(await db.prepare('SELECT material,color FROM printnest_filament_rolls').all()).results;
 const items=(await db.prepare('SELECT id,name,category,unit FROM printnest_inventory_items').all()).results;
 const filaments=new Map();for(const r of rolls)filaments.set(key(r.material,r.color),r);
 const availableItems=new Map(items.map(x=>[x.id,x]));
 const out=[],seen=new Set();let total_mg=0,filamentCount=0;
 for(const row of raw){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid material row');
  if(row.kind==='filament'){
   const material=plain(row.material),color=plain(row.color),q=gramsAsMg(row.grams??row.quantity_mg/1000);
   const found=filaments.get(key(material,color));
   if(!found||q===null)throw Error(`Select an existing filament colour and enter grams`);
   const identity='filament:'+key(material,color);if(seen.has(identity))throw Error('Duplicate filament colour—combine its weight into one line');seen.add(identity);
   out.push({kind:'filament',material:found.material,color:found.color,quantity_mg:q});total_mg+=q;filamentCount++;
  }else if(row.kind==='item'){
   const id=plain(row.item_id),item=availableItems.get(id),q=qtyAsInt(row.quantity_units);
   if(!item||q===null)throw Error('Select an existing accessory/packaging item and quantity');
   const identity='item:'+id;if(seen.has(identity))throw Error('Duplicate item—combine its quantity into one line');seen.add(identity);
   out.push({kind:'item',item_id:id,name:item.name,unit:item.unit,quantity_units:q});
  }else throw Error('Choose filament or an inventory item');
 }
 if(requireFilament&&filamentCount<1)throw Error('Assign at least one filament to this printed product');
 if(requireFilament&&printWeightG!==null){
  const target=Math.round(Number(printWeightG)*1000);
  if(target!==total_mg)throw Error(`Filament grams must total the Creality weight (${(target/1000).toFixed(3)} g). Assigned: ${(total_mg/1000).toFixed(3)} g`);
 }
 return out;
}
export function expandMaterials(lines){
 const out=[];
 for(const line of lines){const multiplier=Number(line.quantity)||0;if(multiplier<1)continue;
  for(const mat of Array.isArray(line.materials)?line.materials:[]){
   if(mat.kind==='filament'){const q=Number(mat.quantity_mg)*multiplier;out.push({...mat,quantity_mg:q})}
   if(mat.kind==='item'){const q=Number(mat.quantity_units)*multiplier;out.push({...mat,quantity_units:q})}
  }
 }
 const combined=new Map();for(const m of out){const id=m.kind==='filament'?'filament:'+key(m.material,m.color):'item:'+m.item_id;
  if(!combined.has(id))combined.set(id,{...m});else{const dest=combined.get(id),f=m.kind==='filament'?'quantity_mg':'quantity_units';dest[f]+=m[f]}
 }
 return [...combined.values()];
}
export async function checkAvailability(db,lines){
 const needs=expandMaterials(lines),rolls=(await db.prepare('SELECT id,label,material,color,remaining_mg,created_at FROM printnest_filament_rolls ORDER BY created_at ASC,id ASC').all()).results;
 const items=(await db.prepare('SELECT id,name,unit,quantity,unit_cost_cents FROM printnest_inventory_items').all()).results;
 const byItem=new Map(items.map(i=>[i.id,i]));const allocations=[],shortages=[];let stockCost=0;
 for(const need of needs){
  if(need.kind==='filament'){
   const eligible=rolls.filter(r=>key(r.material,r.color)===key(need.material,need.color));
   // Prefer an entire print run from ONE compatible roll. Never assume the printer can hot-swap/splice.
   const r=eligible.find(r=>r.remaining_mg>=need.quantity_mg);
   if(r)allocations.push({kind:'filament',id:r.id,label:r.label,quantity_mg:need.quantity_mg});
   else {const available=Math.max(0,...eligible.map(r=>r.remaining_mg));shortages.push({kind:'filament',label:need.material+' '+need.color,required:need.quantity_mg/1000,available:available/1000,shortfall:(need.quantity_mg-available)/1000,unit:'g',reason:'No single compatible roll has enough for this print'});}
  }else{
   const item=byItem.get(need.item_id),have=Number(item?.quantity)||0;
   if(!item||have<need.quantity_units)shortages.push({kind:'item',label:item?.name||need.name||need.item_id,required:need.quantity_units,available:have,shortfall:need.quantity_units-have,unit:item?.unit||need.unit||'pcs'});
   else {allocations.push({kind:'item',id:item.id,label:item.name,quantity_units:need.quantity_units});stockCost+=(Number(item.unit_cost_cents)||0)*need.quantity_units;}
  }
 }
 return {needs,allocations,shortages,available:shortages.length===0,stock_cost_cents:stockCost};
}
