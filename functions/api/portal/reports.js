// PrintNest V10 — read-only operational reports. Authorized Admin / Developer only.
import {json,getCatalog} from '../_shared.js';
import {guard,invalid} from './_auth.js';
import {mergeCatalog} from '../_printing.js';

const monthPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
const usableDate=value=>typeof value==='string'&&monthPattern.test(value);
const sum=rows=>rows.reduce((n,x)=>n+Number(x.amount_cents||0),0);
const rows=async(db,sql,values=[])=>{
  const statement=db.prepare(sql);
  return (await (values.length?statement.bind(...values):statement).all()).results||[];
};

export async function onRequestGet({request,env}){
 const auth=await guard(request,env,{master:true});if(auth.response)return auth.response;
 const db=env.PRINTNEST_DB;if(!db)return invalid('Database binding is missing',503);
 const month=new URL(request.url).searchParams.get('month');
 if(!usableDate(month))return invalid('Select a valid reporting month YYYY-MM');
 const [year,m]=month.split('-').map(Number);
 const first=month+'-01',next=new Date(Date.UTC(year,m,1)).toISOString().slice(0,10);
 try{
  const [catalog,stock,rolls,orderCounts,financeTotals,purchases,consumption,productionRows,manualCosts]=await Promise.all([
   getCatalog(env).then(mergeCatalog).catch(()=>null),
   rows(db,'SELECT id,name,category,unit,quantity,unit_cost_cents FROM printnest_inventory_items ORDER BY name LIMIT 1000'),
   rows(db,'SELECT id,label,material,color,remaining_mg,initial_mg FROM printnest_filament_rolls ORDER BY label LIMIT 1000'),
   db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN payment_status='verified' THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN fulfillment_status IN ('printing','quality_check','packaging') THEN 1 ELSE 0 END) AS active
       FROM orders`).first(),
   Promise.all([
     db.prepare("SELECT COALESCE(SUM(total_cents),0) AS cents FROM orders WHERE payment_status='verified' AND total_cents IS NOT NULL AND date(datetime(COALESCE(verified_at,created_at),'+8 hours'))>=? AND date(datetime(COALESCE(verified_at,created_at),'+8 hours'))<?").bind(first,next).first(),
     db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM finance_order_costs WHERE voided_at IS NULL AND occurred_on>=? AND occurred_on<?").bind(first,next).first(),
     db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM portal_expenses WHERE voided_at IS NULL AND expense_kind='operating' AND occurred_on>=? AND occurred_on<?").bind(first,next).first(),
     db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM portal_expenses WHERE voided_at IS NULL AND expense_kind='inventory' AND occurred_on>=? AND occurred_on<?").bind(first,next).first()
   ]),
   rows(db,`SELECT s.id,s.stock_kind,s.stock_id,s.quantity_units,s.quantity_mg,e.occurred_on,e.description,e.amount_cents,e.voided_at,
    COALESCE(CASE WHEN s.stock_kind='filament' THEN (SELECT label FROM printnest_filament_rolls WHERE id=s.stock_id)
    ELSE (SELECT name FROM printnest_inventory_items WHERE id=s.stock_id) END, s.stock_id) AS stock_name
    FROM printnest_stock_purchases s JOIN portal_expenses e ON e.id=s.expense_id
    ORDER BY e.occurred_on DESC,s.id DESC LIMIT 500`),
   rows(db,`SELECT u.order_id,u.stock_kind,u.stock_id,u.quantity_units,u.quantity_mg,r.occurred_on,
    COALESCE(CASE WHEN u.stock_kind='filament' THEN (SELECT label FROM printnest_filament_rolls WHERE id=u.stock_id)
    ELSE (SELECT name FROM printnest_inventory_items WHERE id=u.stock_id) END,u.stock_id) AS stock_name
    FROM printnest_material_usage u JOIN printnest_production_runs r ON r.order_id=u.order_id
    ORDER BY r.occurred_on DESC,u.order_id DESC LIMIT 500`),
   rows(db,`SELECT r.order_id,r.occurred_on,r.print_cost_cents,r.electricity_cents,r.inventory_state,
    COALESCE(r.stock_cost_cents,0) AS stock_cost_cents,
    (SELECT COUNT(*) FROM printnest_material_usage u WHERE u.order_id=r.order_id) AS consumption_lines
    FROM printnest_production_runs r ORDER BY r.occurred_on DESC,r.order_id DESC LIMIT 1000`),
   rows(db,"SELECT order_id,occurred_on,amount_cents FROM finance_order_costs WHERE voided_at IS NULL AND occurred_on>=? AND occurred_on<?",[first,next])
  ]);
  // Audit history comes from a legacy table and may differ in early deployments.
  // Missing optional audit details should never hide the rest of the report.
  const warnings=[];let adjustments=[];
  try{
   const audits=await rows(db,`SELECT actor_email,action,entity_id,detail,created_at FROM portal_audit
    WHERE action IN ('inventory.item.adjust','production.roll.adjust')
    ORDER BY created_at DESC LIMIT 300`);
   adjustments=audits.map(a=>{
    let d={};try{d=JSON.parse(a.detail||'{}')}catch{}
    const kind=a.action==='production.roll.adjust'?'filament':'item';
    const delta=kind==='filament'?Number(d.delta_mg||0):Number(d.delta||0);
    return {kind:'adjustment',stock_kind:kind,stock_id:a.entity_id,
      stock_name:(kind==='filament'?rolls.find(x=>x.id===a.entity_id)?.label:stock.find(x=>x.id===a.entity_id)?.name)||a.entity_id,
      delta,occurred_on:String(a.created_at||'').slice(0,10),actor:a.actor_email||'',description:'Manual stock correction'};
   });
  }catch{warnings.push('Older manual corrections may be absent from the stock history. Purchase and production records remain available.');}
  const recordedUsage=consumption.map(c=>({kind:'production',stock_kind:c.stock_kind,stock_id:c.stock_id,stock_name:c.stock_name,
    delta:-Number(c.stock_kind==='filament'?c.quantity_mg:c.quantity_units),occurred_on:c.occurred_on,order_id:c.order_id,
    description:'Consumed by production'}));
  const recordedPurchases=purchases.map(p=>({kind:'purchase',stock_kind:p.stock_kind,stock_id:p.stock_id,
    stock_name:p.stock_name,delta:Number(p.stock_kind==='filament'?p.quantity_mg:p.quantity_units),occurred_on:p.occurred_on,
    amount_cents:p.amount_cents,voided:!!p.voided_at,description:p.description||'Linked purchase'}));
  const movements=[...recordedUsage,...recordedPurchases,...adjustments].sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))).slice(0,300);
  const [sales,jobCost,operatingCost,purchaseCost]=financeTotals.map(x=>Number(x?.cents||0));
  const automaticCosts=productionRows.filter(x=>x.occurred_on>=first&&x.occurred_on<next).reduce((n,x)=>n+Number(x.print_cost_cents||0)+Number(x.electricity_cents||0)+Number(x.stock_cost_cents||0),0);
  const directCost=jobCost+automaticCosts;
  const unlinked=await db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(e.amount_cents),0) AS cents
    FROM portal_expenses e WHERE e.voided_at IS NULL AND e.expense_kind='inventory'
    AND e.occurred_on>=? AND e.occurred_on<?
    AND NOT EXISTS (SELECT 1 FROM printnest_stock_purchases s WHERE s.expense_id=e.id)`).bind(first,next).first();
  const productionWithoutUsage=productionRows.filter(x=>x.inventory_state==='deducted'&&Number(x.consumption_lines)===0);
  const mismatch=[];
  if(Number(unlinked?.count||0)>0)mismatch.push({level:'review',text:`${unlinked.count} inventory-category Finance entries have no linked stock receipt this month (BND ${(Number(unlinked.cents||0)/100).toFixed(2)}). These may be legacy classifications; review individually.`});
  if(productionWithoutUsage.length)mismatch.push({level:'review',text:`${productionWithoutUsage.length} production record(s) say stock was deducted but have no material usage lines. Check for legacy production entries.`});
  if(!catalog)warnings.push('Product catalog could not be loaded from R2; product totals are unavailable.');
  const lowRolls=rolls.filter(x=>Number(x.remaining_mg)<=100000),lowItems=stock.filter(x=>Number(x.quantity)<=5);
  const missingPrint=catalog?catalog.filter(x=>x.archived!==true&&x.product_type!=='bundle'&&(x.print_weight_g==null||x.print_minutes==null||x.print_cost_cents==null)).length:null;
  return json({month,generated_at:new Date().toISOString(),warnings,
    catalog:{total:catalog?.length??null,active:catalog?.filter(p=>p.archived!==true&&p.visible!==false).length??null,
      archived:catalog?.filter(p=>p.archived===true).length??null,missing_print:missingPrint},
    inventory:{filament_rolls:rolls.length,low_filament:lowRolls.length,other_items:stock.length,low_other:lowItems.length},
    orders:{total:Number(orderCounts?.total||0),verified:Number(orderCounts?.verified||0),active:Number(orderCounts?.active||0)},
    finance:{sales_cents:sales,manual_job_cents:jobCost,automatic_job_cents:automaticCosts,
      direct_cost_cents:directCost,operating_cents:operatingCost,purchases_cents:purchaseCost,
      estimated_result_cents:sales-directCost-operatingCost,
      unlinked_purchase_count:Number(unlinked?.count||0),unlinked_purchase_cents:Number(unlinked?.cents||0)},
    checks:mismatch,stock_movements:movements,
    note:'Read-only operational report. Opening stock is not a purchase. Purchase amounts are separate from estimated consumed job costs. Historical opening balances and some legacy corrections may not have an itemized movement history. This is not an audited profit report.'});
 }catch(e){return invalid('Could not generate V10 reports. Check existing Inventory and Finance migrations.',503)}
}
