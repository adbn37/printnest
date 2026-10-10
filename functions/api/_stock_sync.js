// Inventory/Finance linked-purchase operations. All database writes are D1 atomic batches.
export const bndCents=(value,{allowZero=false}={})=>{
 const s=String(value??'').trim();if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))return null;
 const parts=s.split('.');const n=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
 return Number.isSafeInteger(n)&&n<=100000000&&(n>0||allowZero)?n:null;
};
export const positiveWhole=value=>{const s=String(value??'').trim();return /^\d{1,7}$/.test(s)&&+s>0&&+s<=10000000?+s:null};
export const positiveMg=value=>{const s=String(value??'').trim();if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(s))return null;const n=Math.round(+s*1000);return n>0&&n<=100000000?n:null};
const labelFor=category=>['Packaging','Accessories','Supplies','Equipment','Filament','Other'].includes(category)?category:'Other';
const audit=(db,actor,action,id,detail)=>db.prepare('INSERT INTO portal_audit(actor_email,action,entity_id,detail) VALUES(?,?,?,?)').bind(actor,action,id,JSON.stringify(detail));
const bruneiToday=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Brunei'}).format(new Date());
const validDay=s=>/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export async function postStockPurchase(db,{kind,id,quantity,amount_cents,date,description,actor,requestKey}){
 if(!['item','filament'].includes(kind)||typeof id!=='string'||id.length>80||!id)return {error:'Select an inventory item or filament roll'};
 if(!Number.isSafeInteger(amount_cents)||amount_cents<1||amount_cents>100000000)return {error:'Enter a positive purchase total in BND'};
 if(typeof description!=='string'||!description.trim()||description.length>160||!validDay(date))return {error:'Enter description and a valid purchase date'};
 if(typeof requestKey!=='string'||requestKey.length>80||!requestKey)return {error:'Missing purchase request ID'};
 const existing=await db.prepare('SELECT expense_id FROM printnest_stock_purchases WHERE request_key=?').bind(requestKey).first();
 if(existing)return {ok:true,already_saved:true,expense_id:existing.expense_id};
 const units=kind==='item'?positiveWhole(quantity):null,mg=kind==='filament'?positiveMg(quantity):null;
 if(kind==='item'&&units===null||kind==='filament'&&mg===null)return {error:'Stock quantity must be positive and valid'};
 const stock=kind==='item'?await db.prepare('SELECT id,name,category,unit,quantity,unit_cost_cents FROM printnest_inventory_items WHERE id=?').bind(id).first():await db.prepare('SELECT id,label,material,color,remaining_mg FROM printnest_filament_rolls WHERE id=?').bind(id).first();
 if(!stock)return {error:'Selected inventory item or filament roll no longer exists'};
 const expenseId=crypto.randomUUID(),linkId=crypto.randomUUID();const category=kind==='item'?labelFor(stock.category):'Filament';
 const averageCost=kind==='item'?Math.round((((Number(stock.unit_cost_cents)||0)*Number(stock.quantity||0))+amount_cents)/(Number(stock.quantity||0)+units)):null;
 const add=kind==='item'?
  db.prepare("UPDATE printnest_inventory_items SET quantity=CASE WHEN quantity+?<=10000000 THEN quantity+? ELSE -1 END,unit_cost_cents=?,updated_at=datetime('now') WHERE id=?").bind(units,units,averageCost,id):
  db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=remaining_mg+?,initial_mg=initial_mg+? WHERE id=?').bind(mg,mg,id);
 const batch=[
  add,
  db.prepare('INSERT INTO portal_expenses(id,occurred_on,category,description,amount_cents,expense_kind,created_by) VALUES(?,?,?,?,?,\'inventory\',?)').bind(expenseId,date,category,description.trim(),amount_cents,actor),
  db.prepare('INSERT INTO printnest_stock_purchases(id,expense_id,stock_kind,stock_id,quantity_units,quantity_mg,created_by,request_key) VALUES(?,?,?,?,?,?,?,?)').bind(linkId,expenseId,kind,id,units||0,mg||0,actor,requestKey),
  audit(db,actor,'inventory.purchase.linked',expenseId,{kind,stock_id:id,quantity:kind==='item'?units:mg/1000,amount_cents})
 ];
 await db.batch(batch);
 return {ok:true,expense_id:expenseId,stock_kind:kind,stock_id:id};
}
export async function reverseStockPurchase(db,expenseId,actor){
 const link=await db.prepare('SELECT * FROM printnest_stock_purchases WHERE expense_id=?').bind(expenseId).first();
 if(!link)return {linked:false};
 const stock=link.stock_kind==='item'?
  await db.prepare('SELECT quantity AS available FROM printnest_inventory_items WHERE id=?').bind(link.stock_id).first():
  await db.prepare('SELECT remaining_mg AS available FROM printnest_filament_rolls WHERE id=?').bind(link.stock_id).first();
 const qty=link.stock_kind==='item'?link.quantity_units:link.quantity_mg;
 if(!stock||Number(stock.available)<qty)return {error:'Cannot void this linked purchase because some of the purchased stock has already been used. Restock or reconcile it first.'};
 const remove=link.stock_kind==='item'?
  db.prepare("UPDATE printnest_inventory_items SET quantity=CASE WHEN quantity>=? THEN quantity-? ELSE -1 END,updated_at=datetime('now') WHERE id=?").bind(qty,qty,link.stock_id):
  db.prepare('UPDATE printnest_filament_rolls SET remaining_mg=CASE WHEN remaining_mg>=? THEN remaining_mg-? ELSE -1 END,initial_mg=CASE WHEN initial_mg>=? THEN initial_mg-? ELSE -1 END WHERE id=?').bind(qty,qty,qty,qty,link.stock_id);
 return {linked:true,statement:remove,link};
}
export {bruneiToday};
