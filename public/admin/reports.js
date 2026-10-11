// PrintNest V10 — read-only reporting client; authenticated through existing Google session.
(() => {
 const $=id=>document.getElementById(id);
 const money=c=>'BND '+(Number(c||0)/100).toFixed(2);
 const el=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;return node};
 const stockLabel=m=>m.stock_kind==='filament'?`${(Math.abs(Number(m.delta||0))/1000).toFixed(3)} g`:`${Math.abs(Number(m.delta||0))} units`;
 let report=null;
 const cell=(row,value)=>row.append(el('td',String(value??'')));
 function draw(r){
  $('reportDate').textContent='Reporting month: '+r.month;
  const cards=$('reportKPIs');cards.replaceChildren();
  for(const [name,value] of [['Visible products',r.catalog.active??'—'],['Archived products',r.catalog.archived??'—'],['Missing Creality details',r.catalog.missing_print??'—'],['Low / empty rolls',r.inventory.low_filament],['Low / empty other stock',r.inventory.low_other],['Verified sales',money(r.finance.sales_cents)],['Direct job costs',money(r.finance.direct_cost_cents)],['Estimated result',money(r.finance.estimated_result_cents)]]){
   const card=el('article','','pn-v10-kpi');card.append(el('small',name),el('strong',String(value)));cards.append(card);
  }
  const integrity=$('reportChecks');integrity.replaceChildren();
  if(!r.checks.length)integrity.append(el('p','No reconciliation warnings detected by the automated checks. This does not establish that bank payments or physical stock were independently verified.','pn-v10-ok'));
  else r.checks.forEach(item=>integrity.append(el('p',item.text,'pn-v10-warning')));
  r.warnings.forEach(w=>integrity.append(el('p',w,'pn-v10-warning')));
  const table=$('reportMovementRows');table.replaceChildren();
  const q=$('reportStockSearch').value.trim().toLowerCase(),type=$('reportStockType').value;
  const entries=r.stock_movements.filter(m=>(type==='all'||m.kind===type)&&(!q||[m.stock_name,m.order_id,m.description,m.stock_kind].join(' ').toLowerCase().includes(q)));
  for(const m of entries){const tr=document.createElement('tr');
   [m.occurred_on,m.kind==='purchase'?'Purchase':m.kind==='production'?'Production use':'Adjustment',m.stock_name,
    `${m.delta<0?'−':'+'}${stockLabel(m)}`,m.voided?'Purchase voided':(m.order_id||m.description||''),
    m.kind==='purchase'?money(m.amount_cents):'—'].forEach(x=>cell(tr,x));table.append(tr);
  }
  if(!entries.length){const row=document.createElement('tr');const td=el('td','No matching stock movements in available history.');td.colSpan=6;row.append(td);table.append(row)}
  $('reportCount').textContent=entries.length+' visible of '+r.stock_movements.length+' loaded movements';
  $('reportPurchaseNote').textContent='Inventory purchases: '+money(r.finance.purchases_cents)+' · automatic production costs: '+money(r.finance.automatic_job_cents)+' · manual job costs: '+money(r.finance.manual_job_cents)+'. Purchases are not deducted again from estimated results.';
 }
 async function load(){
  const month=$('reportMonth').value;if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))return;
  const button=$('reportRefresh');button.disabled=true;$('reportFeedback').textContent='Loading read-only report…';
  try{
   const token=sessionStorage.getItem('printnest_google_credential');if(!token)throw Error('Sign in again to open reports');
   const response=await fetch('/api/portal/reports?month='+encodeURIComponent(month),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   let body;try{body=await response.json()}catch{throw Error('Unexpected report response')}
   if(response.status===401){window.PrintNestHandleAuthExpired?.();throw Error('Your Google session expired. Sign in again.')}
   if(!response.ok)throw Error(body.error||'Report failed');
   report=body;draw(body);$('reportFeedback').textContent='Report loaded — read-only';
  }catch(e){$('reportFeedback').textContent=e.message}finally{button.disabled=false}
 }
 const csvCell=x=>'"'+String(x??'').replaceAll('"','""').replace(/^[=+@-]/,m=>"'"+m)+'"';
 function exportCsv(){if(!report)return;$('reportFeedback').textContent='';
  const header=['Date','Type','Stock item','Quantity change','Order / notes','Purchase BND'];
  const data=[header,...report.stock_movements.map(m=>[m.occurred_on,m.kind,m.stock_name,(m.delta<0?'-':'+')+stockLabel(m),m.order_id||m.description||'',m.kind==='purchase'?(Number(m.amount_cents||0)/100).toFixed(2):''])];
  const blob=new Blob(['\ufeff'+data.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='PrintNest-Stock-History-'+report.month+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const nowParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Brunei',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const year=nowParts.find(p=>p.type==='year')?.value,month=nowParts.find(p=>p.type==='month')?.value;
 $('reportMonth').value=(year&&month)?year+'-'+month:new Date().toISOString().slice(0,7);
 $('reportMonth').onchange=load;$('reportRefresh').onclick=load;
 $('reportStockSearch').oninput=()=>{if(report)draw(report)};$('reportStockType').onchange=()=>{if(report)draw(report)};
 $('reportCsv').onclick=exportCsv;
 window.PrintNestReports={load};
})();
