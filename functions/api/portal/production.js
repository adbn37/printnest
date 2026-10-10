import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';
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
   const purchase=d.record_purchase===true||String(d.record_purchase)==='true';
   if(purchase&&(cost===null||cost<1))return invalid('Enter a positive roll purchase total when recording Finance purchase');
   const steps=[db.prepare('INSERT INTO printnest_filament_rolls(id,label,material,color,initial_mg,remaining_mg,purchase_cost_cents,is_default,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,label,material,color,mg,mg,cost,0,g.user.email)];
   let expenseId=null;
   if(purchase){
    expenseId=crypto.randomUUID();const date=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
    steps.push(db.prepare("INSERT INTO portal_expenses(id,occurred_on,category,description,amount_cents,expense_kind,created_by) VALUES(?,?,?,?,?,'inventory',?)").bind(expenseId,date,'Filament','Filament purchase: '+label,cost,g.user.email));
    steps.push(db.prepare('INSERT INTO printnest_stock_purchases(id,expense_id,stock_kind,stock_id,quantity_units,quantity_mg,created_by,request_key) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),expenseId,'filament',id,0,mg,g.user.email,crypto.randomUUID()));
   }
   steps.push(audit(db,g.user.email,'production.roll.add',id,{label,material,color,grams,purchase_cost_cents:cost,linked_purchase:expenseId}));
   await db.batch(steps);return json({ok:true,id,expense_id:expenseId},201);
  }
  if(action==='adjust_roll'){
   const id=clean(d.id,80),raw=String(d.delta_grams??'').trim();
   if(!id||!/^[-+]?\d{1,6}(?:\.\d{1,3})?$/.test(raw))return invalid('Enter a gram adjustment (up to 3 decimal places)');
   const mg=Math.round(Number(raw)*1000);
   if(!mg||Math.abs(mg)>100000000)return invalid('Gram adjustment must be non-zero and within limits');
   const result=await db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=remaining_mg+? WHERE id=? AND remaining_mg+? BETWEEN 0 AND initial_mg').bind(mg,id,mg).run();
   if(!result.meta?.changes)return invalid('Roll not found or adjustment exceeds its capacity / remaining stock',409);
   await audit(db,g.user.email,'production.roll.adjust',id,{delta_mg:mg}).run();
   return json({ok:true});
  }
  if(action==='default_roll'||action==='allocate')return invalid('Global default roll allocation has been retired. Adjust stock manually.',409);
  return invalid('Unsupported production action');
 }catch{return invalid('Could not save inventory or printer settings. Check D1 migration.',500)}
}
