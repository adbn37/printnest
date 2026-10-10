import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';

const expenseCategories=['Filament','Packaging','Shipping','Machine maintenance','Equipment','Electricity','Marketing','Other'];
const jobCategories=['Filament','Packaging','Electricity','Labour','Hardware','Finishing','Other'];
const kinds=['operating','inventory'];
const clean=(x,max=160)=>String(x??'').trim().slice(0,max);
function cents(v){if(typeof v!=='string' && typeof v!=='number')return null;const s=String(v).trim();if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(s))return null;const [d,dec='']=s.split('.');const result=Number(d)*100+Number(dec.padEnd(2,'0'));return Number.isSafeInteger(result)&&result>0&&result<=100000000?result:null}
function monthBounds(raw){const month=clean(raw,7);if(!/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(month))return null;const [year,m]=month.split('-').map(Number),next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,7)+'-01';return {month,start:month+'-01',end:next}}
function dateOk(v){return /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}
const log=(env,email,action,id,detail)=>env.PRINTNEST_DB.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(email,action,id,JSON.stringify(detail));
const active="voided_at IS NULL";

export async function onRequestGet({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 const bounds=monthBounds(new URL(request.url).searchParams.get('month'));
 if(!bounds)return invalid('Month must be YYYY-MM');
 const {start,end}=bounds;
 try{
  const db=env.PRINTNEST_DB;
  const [sales,costs,expenses,items,purchases,expenseRows,costRows,orderRows]=await Promise.all([
   db.prepare("SELECT COUNT(*) count,COALESCE(SUM(total_cents),0) cents FROM orders WHERE payment_status='verified' AND total_cents IS NOT NULL AND date(datetime(COALESCE(verified_at,created_at),'+8 hours'))>=? AND date(datetime(COALESCE(verified_at,created_at),'+8 hours'))<?").bind(start,end).first(),
   db.prepare(`SELECT COALESCE(SUM(amount_cents),0) cents FROM finance_order_costs WHERE ${active} AND occurred_on>=? AND occurred_on<?`).bind(start,end).first(),
   db.prepare(`SELECT COALESCE(SUM(amount_cents),0) cents FROM portal_expenses WHERE ${active} AND expense_kind='operating' AND occurred_on>=? AND occurred_on<?`).bind(start,end).first(),
   db.prepare(`SELECT COUNT(*) count FROM finance_order_costs WHERE ${active} AND occurred_on>=? AND occurred_on<?`).bind(start,end).first(),
   db.prepare(`SELECT COALESCE(SUM(amount_cents),0) cents FROM portal_expenses WHERE ${active} AND expense_kind='inventory' AND occurred_on>=? AND occurred_on<?`).bind(start,end).first(),
   db.prepare(`SELECT id,occurred_on,category,description,amount_cents,expense_kind,created_by FROM portal_expenses WHERE ${active} AND occurred_on>=? AND occurred_on<? ORDER BY occurred_on DESC,created_at DESC LIMIT 300`).bind(start,end).all(),
   db.prepare(`SELECT c.id,c.order_id,c.occurred_on,c.category,c.description,c.amount_cents,c.created_by,o.customer_name FROM finance_order_costs c JOIN orders o ON o.id=c.order_id WHERE c.voided_at IS NULL AND c.occurred_on>=? AND c.occurred_on<? ORDER BY c.occurred_on DESC,c.created_at DESC LIMIT 300`).bind(start,end).all(),
   db.prepare(`SELECT o.id,o.customer_name,o.created_at,o.payment_status,o.fulfillment_status,o.total_cents,COALESCE(SUM(CASE WHEN c.voided_at IS NULL THEN c.amount_cents ELSE 0 END),0)+COALESCE((SELECT (r.print_cost_cents+r.electricity_cents+COALESCE(r.stock_cost_cents,0)) FROM printnest_production_runs r WHERE r.order_id=o.id),0) AS direct_cost_cents FROM orders o LEFT JOIN finance_order_costs c ON c.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 300`).all()
  ]);
  const auto=await db.prepare("SELECT r.order_id,r.occurred_on,r.print_cost_cents,r.electricity_cents,r.stock_cost_cents,r.printer_name,o.customer_name FROM printnest_production_runs r JOIN orders o ON o.id=r.order_id WHERE r.occurred_on>=? AND r.occurred_on<? ORDER BY r.occurred_on DESC LIMIT 500").bind(start,end).all();
  const autoRows=auto.results.map(r=>({id:'automatic:'+r.order_id,order_id:r.order_id,customer_name:r.customer_name,occurred_on:r.occurred_on,category:'Creality Print',description:r.printer_name+' auto estimate (incl. electricity where enabled)',amount_cents:r.print_cost_cents+r.electricity_cents+(Number(r.stock_cost_cents)||0),source:'production'}));
  const sale=Number(sales.cents)||0,cost=(Number(costs.cents)||0)+autoRows.reduce((sum,row)=>sum+row.amount_cents,0),operating=Number(expenses.cents)||0;
  return json({month:bounds.month,sales_cents:sale,verified_count:Number(sales.count)||0,direct_cost_cents:cost,job_cost_count:(Number(items.count)||0)+autoRows.length,operating_cents:operating,inventory_purchase_cents:Number(purchases.cents)||0,estimated_result_cents:sale-cost-operating,expenses:expenseRows.results,job_costs:[...costRows.results,...autoRows],orders:orderRows.results,expense_categories:expenseCategories,job_categories:jobCategories,note:'Monthly operating estimate, not audited accounting. Production print costs are automatically posted once on first Printing/Completed status; do not manually add the same Creality cost again. Revenue is recognized by verification date (historic verified orders fall back to created date). Job costs are shown by incurred date. Inventory purchases are excluded from expenses to avoid double counting when consumed. No refunds, partial payments or stock valuation.'});
 }catch(e){return invalid('Finance migration not installed or finance query failed',503)}
}

export async function onRequestPost({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 if(Number(request.headers.get('content-length')||0)>16000)return invalid('Request too large',413);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 if(!d||typeof d!=='object'||Array.isArray(d))return invalid('Invalid JSON object');
 const action=clean(d.action,25),desc=clean(d.description,160),date=clean(d.occurred_on,12),amount=cents(d.amount),category=clean(d.category,40);
 if(!desc||!dateOk(date)||amount===null)return invalid('Check date, description and amount (up to BND 1,000,000)');
 const db=env.PRINTNEST_DB,id=crypto.randomUUID();
 try{
  if(action==='expense'){
   const kind=clean(d.expense_kind,15);
   if(!kinds.includes(kind)||!expenseCategories.includes(category))return invalid('Invalid expense category or type');
   await db.batch([
    db.prepare('INSERT INTO portal_expenses(id,occurred_on,category,description,amount_cents,expense_kind,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,date,category,desc,amount,kind,g.user.email),
    log(env,g.user.email,'finance.expense.add',id,{date,category,kind,amount_cents:amount})
   ]);
  }else if(action==='job_cost'){
   const orderId=clean(d.order_id,80);
   if(!jobCategories.includes(category)||!orderId)return invalid('Select an order and job cost category');
   const order=await db.prepare('SELECT id FROM orders WHERE id=?').bind(orderId).first();if(!order)return invalid('Order not found',404);
   await db.batch([
    db.prepare('INSERT INTO finance_order_costs(id,order_id,occurred_on,category,description,amount_cents,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,orderId,date,category,desc,amount,g.user.email),
    log(env,g.user.email,'finance.cost.add',id,{order_id:orderId,date,category,amount_cents:amount})
   ]);
  }else return invalid('Unknown finance action');
  return json({ok:true,id},201);
 }catch{return invalid('Could not save finance entry. Check migration.',500)}
}

export async function onRequestPatch({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 let d;try{d=await request.json()}catch{return invalid('Invalid JSON')}
 if(!d||typeof d!=='object'||Array.isArray(d))return invalid('Invalid JSON object');
 if(d.action!=='reclassify_expense'||typeof d.id!=='string'||d.id.length>80||!kinds.includes(d.expense_kind))return invalid('Invalid reclassification');
 try{
  const db=env.PRINTNEST_DB,old=await db.prepare('SELECT expense_kind FROM portal_expenses WHERE id=? AND voided_at IS NULL').bind(d.id).first();
  if(!old)return invalid('Expense not found',404);
  await db.batch([
   db.prepare('UPDATE portal_expenses SET expense_kind=? WHERE id=? AND voided_at IS NULL').bind(d.expense_kind,d.id),
   log(env,g.user.email,'finance.expense.reclassify',d.id,{before:old.expense_kind,after:d.expense_kind})
  ]);
  return json({ok:true});
 }catch{return invalid('Could not reclassify expense',500)}
}

export async function onRequestDelete({request,env}){
 const g=await guard(request,env,{master:true});if(g.response)return g.response;
 if(!env.PRINTNEST_DB)return invalid('D1 binding missing',503);
 const url=new URL(request.url),kind=url.searchParams.get('kind'),id=url.searchParams.get('id');
 if(!['expense','job_cost'].includes(kind)||!id||id.length>80)return invalid('Invalid entry');
 const table=kind==='expense'?'portal_expenses':'finance_order_costs',db=env.PRINTNEST_DB;
 try{
  const found=await db.prepare(`SELECT id FROM ${table} WHERE id=? AND voided_at IS NULL`).bind(id).first();
  if(!found)return invalid('Entry not found or already voided',404);
  await db.batch([
   db.prepare(`UPDATE ${table} SET voided_at=datetime('now'),voided_by=? WHERE id=? AND voided_at IS NULL`).bind(g.user.email,id),
   log(env,g.user.email,'finance.'+kind+'.void',id,{})
  ]);
  return json({ok:true});
 }catch{return invalid('Could not void entry',500)}
}
