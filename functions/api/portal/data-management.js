import {json,getCatalog,putCatalog} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {mergeCatalog,isSeed} from '../_printing.js';
const validKinds=['orders','products','filament','inventory'];
const clean=v=>String(v??'').trim();
const audit=(db,user,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(user,action,id,JSON.stringify(detail));
function rowsToIds(v){if(!Array.isArray(v)||!v.length||v.length>250)return null;const list=v.map(clean);return list.every(x=>x.length>0&&x.length<=100)&&new Set(list).size===list.length?list:null}
const dbTables={orders:'orders',filament:'printnest_filament_rolls',inventory:'printnest_inventory_items'};
export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB||!env.PRINTNEST_BUCKET)return invalid('D1 / R2 bindings missing',503);
 try{
  const mode=new URL(request.url).searchParams.get('mode'),db=env.PRINTNEST_DB;
  if(mode==='backup'){
   // Privacy: protected by server-side Google Master Admin auth; data should be kept offline.
   const tables=['orders','printnest_order_extras','printnest_roll_usage','printnest_production_jobs','printnest_production_runs','printnest_material_usage','printnest_filament_rolls','printnest_inventory_items','printnest_stock_purchases','printnest_bulk_roll_purchase_lines','finance_order_costs','portal_expenses','portal_audit','printnest_printer_settings'];
   const available=await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
   const known=new Set((available.results||[]).map(x=>x.name)),data={};
   for(const table of tables)if(known.has(table)){const r=await db.prepare('SELECT * FROM '+table+' LIMIT 20000').all();data[table]=r.results||[];}
   return json({notice:'Sensitive operational backup. Receipt files and product image binaries are NOT included. For complete backup use wrangler d1 export and back up R2.',exported_at:new Date().toISOString(),data,catalog:await getCatalog(env)});
  }
  const [a,b,c,d]=await Promise.all([
   db.prepare('SELECT id,customer_name AS label,fulfillment_status AS status FROM orders ORDER BY created_at DESC LIMIT 500').all(),
   db.prepare('SELECT id,label,material,color,remaining_mg FROM printnest_filament_rolls ORDER BY created_at DESC LIMIT 500').all(),
   db.prepare('SELECT id,name AS label,category,quantity FROM printnest_inventory_items ORDER BY name LIMIT 500').all(),
   getCatalog(env)
  ]);
  return json({orders:a.results,filament:b.results,inventory:c.results,products:mergeCatalog(d).map(p=>({id:p.id,label:p.title,archived:p.archived===true,visible:p.visible!==false}))});
 }catch{return invalid('Unable to list or export records',500)}
}
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB||!env.PRINTNEST_BUCKET)return invalid('D1 / R2 bindings missing',503);
 let data;try{data=await request.json()}catch{return invalid('Invalid JSON')}
 const kind=clean(data?.kind),mode=data?.mode==='all'?'all':'selected',db=env.PRINTNEST_DB;
 if(!validKinds.includes(kind))return invalid('Choose a section to delete');
 if(data?.confirmation!=='DELETE '+kind.toUpperCase())return invalid('Deletion confirmation phrase is incorrect');
 if(data?.backup_ack!==true)return invalid('Download and confirm a backup before deleting records');
 try{
  const catalog=kind==='products'?await getCatalog(env):null;
  const available=kind==='products'?mergeCatalog(catalog):((await db.prepare('SELECT id FROM '+dbTables[kind]+' LIMIT 5000').all()).results||[]);
  const ids=mode==='all'?available.map(x=>x.id):rowsToIds(data?.ids);
  if(!ids||!ids.length||ids.length>5000)return invalid('No matching records or request too large',400);
  if(mode==='all'&&(!Number.isSafeInteger(data?.expected_count)||data.expected_count!==ids.length))return invalid('Record count changed since preview. Refresh before deleting all.',409);
  if(mode==='selected'&&ids.length>250)return invalid('Select no more than 250 at a time');
  const found=new Set(available.map(x=>x.id));if(ids.some(id=>!found.has(id)))return invalid('One or more records no longer exist. Refresh and retry',409);
  if(kind==='products'){
   // Product snapshots remain in historical orders. Never break a live bundle recipe.
   const doomed=new Set(ids),active=available.filter(p=>!doomed.has(p.id));
   for(const p of active)if(p.product_type==='bundle'&&p.components?.some(c=>doomed.has(c.id)))return invalid('One of these products is used by a remaining gift bundle. Remove or delete the bundle first.',409);
   const next=catalog.filter(p=>!doomed.has(p.id));
   // Built-in seed products cannot be removed from code; persist hidden tombstones.
   for(const p of available)if(doomed.has(p.id)&&isSeed(p.id))next.push({...p,visible:false,archived:true,deleted:true});
   await putCatalog(env,next);
   await audit(db,g.user.email,'data.delete.products',kind,{ids,mode}).run();
   // Delete image binaries only when no remaining product refers to them.
   const still=new Set(next.map(p=>p.image));let deletedImages=0;
   for(const p of available)if(doomed.has(p.id)&&!isSeed(p.id)&&p.image?.startsWith('/images/')&&!still.has(p.image)){
    try{await env.PRINTNEST_BUCKET.delete(p.image.slice(1));deletedImages++}catch{};
   }
   return json({ok:true,count:ids.length,deleted_images:deletedImages,seed_note:'Built-in products are permanently hidden, not removed from source code.'});
  }
  const statements=[];const receiptKeys=[];
  for(const id of ids){
   if(kind==='orders'){
    const order=await db.prepare('SELECT id,payment_status,fulfillment_status,receipt_key FROM orders WHERE id=?').bind(id).first();
    if(!order)return invalid('Order no longer exists',409);
    if(!['unpaid','rejected'].includes(order.payment_status)||!['new','confirmed','cancelled'].includes(order.fulfillment_status))return invalid('Cannot delete order '+id+' because payment or production history exists. Use the backup-first full operational reset for test data.',409);
    const refs=await Promise.all([
     db.prepare('SELECT 1 AS x FROM printnest_production_runs WHERE order_id=? LIMIT 1').bind(id).first(),
     db.prepare('SELECT 1 AS x FROM printnest_production_jobs WHERE order_id=? LIMIT 1').bind(id).first(),
     db.prepare('SELECT 1 AS x FROM printnest_material_usage WHERE order_id=? LIMIT 1').bind(id).first(),
     db.prepare('SELECT 1 AS x FROM finance_order_costs WHERE order_id=? LIMIT 1').bind(id).first()
    ]);
    if(refs.some(Boolean))return invalid('Order '+id+' has linked production or finance records. It cannot be safely deleted individually.',409);
    statements.push(db.prepare('DELETE FROM printnest_order_extras WHERE order_id=?').bind(id));
    statements.push(db.prepare('DELETE FROM orders WHERE id=?').bind(id));
    if(order.receipt_key)receiptKeys.push(order.receipt_key);
   }else if(kind==='filament'){
    const [usage,purchase,bulk,legacy]=await Promise.all([
     db.prepare("SELECT 1 AS x FROM printnest_material_usage WHERE stock_kind='filament' AND stock_id=? LIMIT 1").bind(id).first(),
     db.prepare("SELECT 1 AS x FROM printnest_stock_purchases WHERE stock_kind='filament' AND stock_id=? LIMIT 1").bind(id).first(),
     db.prepare("SELECT 1 AS x FROM printnest_bulk_roll_purchase_lines WHERE roll_id=? LIMIT 1").bind(id).first(),
     db.prepare('SELECT 1 AS x FROM printnest_roll_usage WHERE roll_id=? LIMIT 1').bind(id).first()
    ]);
    if(usage||legacy)return invalid('Cannot delete '+id+': this roll has been used in production. Keep its historical usage record.',409);
    // Unlink the deleted roll from stock-purchase mappings before deleting it.
    // Keep the original financial expense and audit trail for accounting history.
    if(purchase)statements.push(db.prepare("DELETE FROM printnest_stock_purchases WHERE stock_kind='filament' AND stock_id=?").bind(id));
    if(bulk)statements.push(db.prepare('DELETE FROM printnest_bulk_roll_purchase_lines WHERE roll_id=?').bind(id));
    statements.push(db.prepare('DELETE FROM printnest_filament_rolls WHERE id=?').bind(id));
   }else if(kind==='inventory'){
    const [usage,purchase]=await Promise.all([
     db.prepare("SELECT 1 AS x FROM printnest_material_usage WHERE stock_kind='item' AND stock_id=? LIMIT 1").bind(id).first(),
     db.prepare("SELECT 1 AS x FROM printnest_stock_purchases WHERE stock_kind='item' AND stock_id=? LIMIT 1").bind(id).first()
    ]);
    if(usage)return invalid('Cannot delete '+id+': this inventory item has been used in production. Keep its historical usage record.',409);
    if(purchase)statements.push(db.prepare("DELETE FROM printnest_stock_purchases WHERE stock_kind='item' AND stock_id=?").bind(id));
    statements.push(db.prepare('DELETE FROM printnest_inventory_items WHERE id=?').bind(id));
   }
  }
  statements.push(audit(db,g.user.email,'data.delete.'+kind,kind,{ids,mode}));
  await db.batch(statements);
  for(const key of receiptKeys)try{await env.PRINTNEST_RECEIPTS?.delete(key)}catch{};
  return json({ok:true,count:ids.length});
 }catch(e){return invalid('Delete cancelled or database failure: '+e.message,409)}
}
