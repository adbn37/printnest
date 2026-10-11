// Read-only, authenticated order-level production/Finance reconciliation.
// This does not create, reverse, or post any financial transaction.
import {json} from '../_shared.js';
import {guard,invalid} from './_auth.js';

export async function onRequestGet({request,env}) {
  const g = await guard(request,env,{master:true});
  if(g.response) return g.response;
  if(!env.PRINTNEST_DB) return invalid('PrintNest D1 binding missing',503);
  const id = new URL(request.url).searchParams.get('id');
  if(!id || id.length > 80) return invalid('Order ID required');
  const db = env.PRINTNEST_DB;
  try {
    const order = await db.prepare('SELECT id,customer_name,total_cents,payment_status,fulfillment_status FROM orders WHERE id=?').bind(id).first();
    if(!order) return invalid('Order not found',404);
    const fields = await db.prepare("PRAGMA table_info('printnest_production_runs')").all();
    const hasStock = (fields.results || []).some(x => x.name === 'stock_cost_cents');
    const extraColumn = hasStock ? 'stock_cost_cents' : '0 AS stock_cost_cents';
    const production = await db.prepare('SELECT order_id,occurred_on,printer_name,weight_mg,print_minutes,print_cost_cents,electricity_cents,inventory_state,'+extraColumn+' FROM printnest_production_runs WHERE order_id=?').bind(id).first();
    const charges = await db.prepare('SELECT id,category,description,occurred_on,amount_cents FROM finance_order_costs WHERE order_id=? AND voided_at IS NULL ORDER BY occurred_on,id').bind(id).all();
    const details = await db.prepare(`
      SELECT u.stock_kind,u.stock_id,u.quantity_mg,u.quantity_units,
      COALESCE(
        CASE WHEN u.stock_kind='filament' THEN
          (SELECT label FROM printnest_filament_rolls WHERE id=u.stock_id)
        ELSE (SELECT name FROM printnest_inventory_items WHERE id=u.stock_id) END,
        u.stock_id) AS label
      FROM printnest_material_usage u WHERE u.order_id=?
      ORDER BY u.stock_kind,u.stock_id`).bind(id).all();
    const manual = (charges.results || []).reduce((sum,x) => sum + Number(x.amount_cents||0),0);
    const printing = production ? Number(production.print_cost_cents||0)+Number(production.electricity_cents||0)+Number(production.stock_cost_cents||0) : 0;
    return json({
      id:order.id,customer_name:order.customer_name,
      total_cents:order.total_cents,payment_status:order.payment_status,
      fulfillment_status:order.fulfillment_status,
      production,material_usage:details.results||[],manual_costs:charges.results||[],
      manual_cost_cents:manual,production_cost_cents:printing,direct_cost_cents:manual+printing,
      note:'Direct costs come from the production run plus non-voided manual job costs. No duplicate expense is created by this report.'
    });
  } catch (error) {
    return invalid('Could not read production/Finance details; verify V3/V4 D1 migrations.',503);
  }
}
