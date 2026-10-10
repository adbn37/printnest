import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';

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
 try{
  await db.batch([
   db.prepare('INSERT INTO printnest_inventory_items(id,name,category,unit,quantity,unit_cost_cents,notes,created_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,name,category,unit,quantity,unitCost,notes,g.user.email),
   audit(db,g.user.email,'inventory.item.add',id,{name,category,unit,quantity,unit_cost_cents:unitCost})
  ]);
  return json({ok:true,id},201);
 }catch{return invalid('Could not add item. Check the inventory migration.',500)}
}

export async function onRequestPatch({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
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
