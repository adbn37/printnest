import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {allocatePendingProduction} from '../_production.js';
const clean=(s,n=80)=>String(s??'').trim().slice(0,n);
const dec=(s,max,places=2)=>{const x=String(s??'').trim();if(!new RegExp('^\\d{1,7}(?:\\.\\d{1,'+places+'})?$').test(x))return null;const v=Number(x);return Number.isFinite(v)&&v>=0&&v<=max?v:null};
const audit=(db,email,action,id,data)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES (?,?,?,?)').bind(email,action,id,JSON.stringify(data));
export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 try{const db=env.PRINTNEST_DB;const [settings,rolls,runs]=await Promise.all([
 db.prepare('SELECT * FROM printnest_printer_settings WHERE id=1').first(),
 db.prepare('SELECT * FROM printnest_filament_rolls ORDER BY is_default DESC,created_at DESC LIMIT 250').all(),
 db.prepare("SELECT r.*,o.customer_name FROM printnest_production_runs r JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 150").all()
 ]);return json({settings,rolls:rolls.results,runs:runs.results})}catch{return invalid('Production migration not installed. Apply migration.sql.',503)}
}
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')};if(!d||typeof d!=='object'||Array.isArray(d))return invalid('Invalid JSON');
 const db=env.PRINTNEST_DB,action=clean(d.action,24);
 try{
  if(action==='settings'){
   const name=clean(d.printer_name,100),power=Number(d.average_watts),rate=dec(d.tariff_bnd_per_kwh,10);
   const cents=rate===null?null:Math.round(rate*100);
   if(!name||!Number.isSafeInteger(power)||power<0||power>3000||cents===null)return invalid('Enter printer name, average watts (0–3000), and tariff in BND/kWh');
   await db.batch([
    db.prepare('UPDATE printnest_printer_settings SET printer_name=?,average_watts=?,tariff_cents_per_kwh=?,add_electricity=?,updated_at=datetime(\'now\') WHERE id=1').bind(name,power,cents,d.add_electricity===true?1:0),
    audit(db,g.user.email,'production.settings','printer', {printer_name:name,average_watts:power,tariff_cents_per_kwh:cents,add_electricity:d.add_electricity===true})
   ]);return json({ok:true});
  }
  if(action==='add_roll'){
   const label=clean(d.label,90),material=clean(d.material,40),color=clean(d.color,40),grams=dec(d.grams,100000,3),price=String(d.purchase_cost??'').trim()?dec(d.purchase_cost,100000):null;
   if(!label||!material||!color||grams===null||grams<=0||price===null&&String(d.purchase_cost??'').trim())return invalid('Check roll name, material, colour, grams and optional purchase price');
   const mg=Math.round(grams*1000);const cost=price===null?null:Math.round(price*100),id=crypto.randomUUID();
   await db.batch([
    db.prepare('INSERT INTO printnest_filament_rolls(id,label,material,color,initial_mg,remaining_mg,purchase_cost_cents,is_default,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,label,material,color,mg,mg,cost,0,g.user.email),
    audit(db,g.user.email,'production.roll.add',id,{label,material,color,grams,purchase_cost_cents:cost})
   ]);return json({ok:true,id},201);
  }
  if(action==='default_roll'){
   const id=clean(d.id,80),roll=await db.prepare('SELECT id FROM printnest_filament_rolls WHERE id=?').bind(id).first();if(id&& !roll)return invalid('Roll not found',404);
   // Clear default, then select the selected roll in the same transaction.
   const qs=[db.prepare('UPDATE printnest_filament_rolls SET is_default=0 WHERE is_default=1')];if(id)qs.push(db.prepare('UPDATE printnest_filament_rolls SET is_default=1 WHERE id=?').bind(id));qs.push(audit(db,g.user.email,'production.roll.default',id||'none',{}));
   await db.batch(qs);return json({ok:true});
  }
  if(action==='allocate'){
   const order=clean(d.order_id,80);if(!order)return invalid('Order ID required');try{return json(await allocatePendingProduction(db,order,g.user.email))}catch(e){return invalid(e.message||'Unable to allocate inventory',409)}
  }
  return invalid('Unsupported production action');
 }catch{return invalid('Could not save inventory or printer settings. Check D1 migration.',500)}
}
