import {json} from '../_shared.js';import {guard,invalid} from './_auth.js';
const categories=['Filament','Packaging','Shipping','Machine maintenance','Equipment','Electricity','Marketing','Other'];
export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 try{const [sales,expenses,rows]=await Promise.all([
 env.PRINTNEST_DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(total_cents),0) cents FROM orders WHERE payment_status='verified' AND total_cents IS NOT NULL").first(),
 env.PRINTNEST_DB.prepare('SELECT COALESCE(SUM(amount_cents),0) cents FROM portal_expenses').first(),
 env.PRINTNEST_DB.prepare('SELECT * FROM portal_expenses ORDER BY occurred_on DESC,created_at DESC LIMIT 200').all()]);
 return json({sales_cents:sales.cents,verified_count:sales.count,expenses_cents:expenses.cents,net_cents:sales.cents-expenses.cents,expenses:rows.results,categories,note:'Revenue counts all-time verified orders, excluding unpriced orders. Expenses are manually recorded.'})}catch{return invalid('Finance migration not installed',503)}
}
export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 const label=String(d.description||'').trim().slice(0,160),category=String(d.category||''),date=String(d.occurred_on||'');const cents=Math.round(Number(d.amount)*100);
 if(!label||!categories.includes(category)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(cents)||cents<1||cents>100000000)return invalid('Invalid expense data');
 try{await env.PRINTNEST_DB.prepare('INSERT INTO portal_expenses (id,occurred_on,category,description,amount_cents,created_by) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),date,category,label,cents,g.user.email).run();return json({ok:true},201)}catch{return invalid('Unable to save expense',500)}
}
export async function onRequestDelete({request,env}){const g=await guard(request,env,{master:true});if(g.response)return g.response;const id=new URL(request.url).searchParams.get('id');if(!id||id.length>80)return invalid('Invalid ID');try{const r=await env.PRINTNEST_DB.prepare('DELETE FROM portal_expenses WHERE id=?').bind(id).run();return json({ok:!!r.meta?.changes})}catch{return invalid('Unable to delete expense',500)}}
