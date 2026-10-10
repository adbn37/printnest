// Order-specific materials. One order may use a different filament colour or
// optional packaging from another order for the very same catalog product.
const key=(a,b)=>String(a).trim().toLowerCase()+'\0'+String(b).trim().toLowerCase();
export async function orderExtras(db,orderId){
 const record=await db.prepare('SELECT extras_json FROM printnest_order_extras WHERE order_id=?').bind(orderId).first();
 if(!record)return [];
 try{const rows=JSON.parse(record.extras_json);return Array.isArray(rows)?rows:[]}catch{return []}
}
export async function validatedExtras(db,raw,expectedMg){
 if(!Array.isArray(raw)||raw.length<1||raw.length>30)throw Error('Select at least one filament colour in Order materials (up to 30 rows).');
 if(!Number.isSafeInteger(expectedMg)||expectedMg<=0)throw Error('Enter the weight, time and cost for every order item first.');
 const [r,i]=await Promise.all([
  db.prepare('SELECT material,color FROM printnest_filament_rolls').all(),
  db.prepare("SELECT id,name,unit,category FROM printnest_inventory_items WHERE category!='Filament'").all()
 ]);
 const rolls=new Map(r.results.map(x=>[key(x.material,x.color),x]));
 const items=new Map(i.results.map(x=>[x.id,x]));
 const seen=new Set(),output=[];let mg=0,filaments=0;
 for(const row of raw){
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid material row');
  if(row.kind==='filament'){
   const mat=String(row.material||'').trim(),col=String(row.color||'').trim();
   const text=String(row.grams??'').trim();
   if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(text))throw Error('Filament grams must be a positive number with up to three decimals.');
   const qty=Math.round(Number(text)*1000),found=rolls.get(key(mat,col));
   if(!found||qty<1||qty>100000000)throw Error('Select an existing filament colour and valid grams.');
   const id='filament:'+key(mat,col);if(seen.has(id))throw Error('Combine duplicate filament colours into one row.');seen.add(id);
   output.push({kind:'filament',material:found.material,color:found.color,quantity_mg:qty});mg+=qty;filaments++;
  }else if(row.kind==='item'||(!row.kind&&row.item_id)){
   const id=String(row.item_id||''),count=Number(row.quantity_units),found=items.get(id);
   if(!found||!Number.isSafeInteger(count)||count<1||count>10000000)throw Error('Select a valid accessory and quantity.');
   if(seen.has('item:'+id))throw Error('Combine duplicate accessories into one row.');seen.add('item:'+id);
   output.push({kind:'item',item_id:id,name:found.name,unit:found.unit,quantity_units:count});
  }else throw Error('Choose filament or an optional inventory item.');
 }
 if(!filaments)throw Error('Assign filament to the order before printing.');
 if(mg!==expectedMg)throw Error('Assigned filament is '+(mg/1000).toFixed(3)+' g. This order needs exactly '+(expectedMg/1000).toFixed(3)+' g.');
 return output;
}
