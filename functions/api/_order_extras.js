// Per-order optional accessories/packaging. Never forced by a product template.
export async function orderExtras(db,orderId){
 const record=await db.prepare('SELECT extras_json FROM printnest_order_extras WHERE order_id=?').bind(orderId).first();
 if(!record)return [];
 try{const rows=JSON.parse(record.extras_json);return Array.isArray(rows)?rows:[]}catch{return []}
}
export async function validatedExtras(db,raw){
 if(!Array.isArray(raw)||raw.length>30)throw Error('Choose up to 30 optional accessories');
 const valid=(await db.prepare('SELECT id,name,unit,category FROM printnest_inventory_items WHERE category!=\'Filament\'').all()).results;
 const byId=new Map(valid.map(i=>[i.id,i])),used=new Set(),result=[];
 for(const row of raw){
  const id=String(row?.item_id||''),qty=Number(row?.quantity_units),item=byId.get(id);
  if(!item||used.has(id)||!Number.isSafeInteger(qty)||qty<1||qty>10000000)throw Error('Select a unique accessory with a valid quantity');
  used.add(id);result.push({kind:'item',item_id:id,name:item.name,unit:item.unit,quantity_units:qty});
 }
 return result;
}
