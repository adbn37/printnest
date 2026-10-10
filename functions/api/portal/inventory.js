import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {postStockPurchase,bndCents,positiveWhole} from '../_stock_sync.js';

const categories=['Packaging','Accessories','Supplies','Equipment','Filament','Other'];
const units=['pcs','packs','sets','boxes','rolls','metres'];
const clean=(v,n=100)=>String(v??'').trim().slice(0,n);
const whole=(v,max=10000000)=>{const t=String(v??'').trim();return /^\d{1,8}$/.test(t)&&Number(t)<=max?Number(t):null};
const optionalCents=(v)=>{
 const t=String(v??'').trim();if(!t)return null;
 if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(t))return undefined;
 return Math.round(Number(t)*100);
};
const audit=(db,email,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES (?,?,?,?)').bind(email,action,id,JSON.stringify(detail));

export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 try{
  const result=await env.PRINTNEST_DB.prepare('SELECT id,name,category,unit,quantity,unit_cost_cents,notes,created_at,updated_at FROM printnest_inventory_items ORDER BY category,name LIMIT 500').all();
  return json({items:result.results,categories,units});
 }catch{return invalid('General inventory migration is missing. Run inventory-v2.sql in Cloudflare D1.',503)}
}

export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 if(!d||typeof d!=='object'||Array.isArray(d))return invalid('Invalid JSON');
 const name=clean(d.name,100),category=clean(d.category,30),unit=clean(d.unit,20),quantity=whole(d.quantity),unitCost=optionalCents(d.unit_cost),notes=clean(d.notes,300);
 if(!name||!categories.includes(category)||!units.includes(unit)||quantity===null||unitCost===undefined)return invalid('Check item name, category, unit, quantity and optional cost');
 const db=env.PRINTNEST_DB,id=crypto.randomUUID();
 const asPurchase=d.record_purchase===true;
 const purchaseTotal=asPurchase?bndCents(d.purchase_total):null;
 if(asPurchase&&(quantity<1||purchaseTotal===null))return invalid('For a linked stock purchase, enter quantity and the total paid in BND');
 const effectiveUnitCost=asPurchase&&unitCost===null&&quantity>0?Math.round(purchaseTotal/quantity):unitCost;
 try{
  const actions=[db.prepare('INSERT INTO printnest_inventory_items(id,name,category,unit,quantity,unit_cost_cents,notes,created_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,name,category,unit,quantity,effectiveUnitCost,notes,g.user.email)];
  let expenseId=null;
  if(asPurchase){
   expenseId=crypto.randomUUID();const linkId=crypto.randomUUID(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Brunei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   actions.push(db.prepare("INSERT INTO portal_expenses(id,occurred_on,category,description,amount_cents,expense_kind,created_by) VALUES(?,?,?,?,?,'inventory',?)").bind(expenseId,date,category,'Stock purchase: '+name,purchaseTotal,g.user.email));
   actions.push(db.prepare('INSERT INTO printnest_stock_purchases(id,expense_id,stock_kind,stock_id,quantity_units,quantity_mg,created_by,request_key) VALUES(?,?,?,?,?,?,?,?)').bind(linkId,expenseId,'item',id,quantity,0,g.user.email,crypto.randomUUID()));
  }
  actions.push(audit(db,g.user.email,'inventory.item.add',id,{name,category,unit,quantity,unit_cost_cents:unitCost,linked_purchase:expenseId}));
  await db.batch(actions);
  return json({ok:true,id,expense_id:expenseId},201);
 }catch{return invalid('Could not add inventory item or linked Finance purchase. Check V4 migration.',500)}
}

export async function onRequestPatch({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 if(d?.action==='purchase'){
  const result=await (async()=>{
   try{return await postStockPurchase(env.PRINTNEST_DB,{kind:d.stock_kind||'item',id:String(d.id||''),quantity:d.quantity,amount_cents:bndCents(d.amount),date:String(d.occurred_on||''),description:String(d.description||'').trim(),actor:g.user.email,requestKey:String(d.request_key||'')});}
   catch{return {error:'Could not save linked purchase. Check V4 migration and available stock limits.'}}
  })();return result.error?invalid(result.error,400):json(result,201);
 }
 if(d?.action!=='adjust')return invalid('Invalid inventory action');
 const id=clean(d.id,80),raw=String(d.delta??'').trim();
 if(!id||!/^[-+]?\d{1,8}$/.test(raw))return invalid('Enter a valid quantity change');
 const delta=Number(raw);if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>10000000)return invalid('Quantity change must be a non-zero whole number');
 const db=env.PRINTNEST_DB;
 try{
  const result=await db.prepare("UPDATE printnest_inventory_items SET quantity=quantity+?,updated_at=datetime('now') WHERE id=? AND quantity+? BETWEEN 0 AND 10000000").bind(delta,id,delta).run();
  if(!result.meta?.changes)return invalid('Stock not found or quantity would become negative / too large',409);
  await audit(db,g.user.email,'inventory.item.adjust',id,{delta}).run();
  return json({ok:true});
 }catch{return invalid('Could not adjust inventory',500)}
}
