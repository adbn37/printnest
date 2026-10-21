// PrintNest V14: authenticated, explicit and guarded data deletion UI.
(() => {
 const $=id=>document.getElementById(id);
 const token=()=>sessionStorage.getItem('printnest_google_credential')||'';
 const kinds={orders:'Orders',products:'Products',filament:'Filament Stock',inventory:'Other Inventory'};
 let records={},backupDownloaded=false;
 async function api(path,options={}){
  if(!token())throw Error('Sign in with your authorized Google account first');
  const res=await fetch('/api/portal/'+path,{...options,headers:{Authorization:'Bearer '+token(),...options.headers},cache:'no-store'});
  const data=await res.json().catch(()=>({error:'Invalid response'}));if(!res.ok)throw Error(data.error||'Request failed');return data;
 }
 function report(text,error=false){$('dmStatus').textContent=text;$('dmStatus').classList.toggle('finance-error',error)}
 function selectedIds(){return [...$('dmList').querySelectorAll('input:checked')].map(el=>el.value)}
 function render(){
  const kind=$('dmKind').value,list=$('dmList');list.replaceChildren();
  for(const r of records[kind]||[]){
   const label=document.createElement('label'),ck=document.createElement('input'),text=document.createElement('span');
   ck.type='checkbox';ck.value=r.id;ck.onchange=()=>{$('dmSelectedCount').textContent=selectedIds().length+' selected'};
   text.textContent=r.label||r.name||r.id;
   if(kind==='orders')text.textContent+=' · '+String(r.status||'new');
   if(kind==='filament')text.textContent+=' · '+r.material+' · '+r.color+' · '+(Number(r.remaining_mg)/1000).toFixed(1)+' g';
   if(kind==='inventory')text.textContent+=' · '+r.quantity+' remaining';
   label.append(ck,text);list.append(label);
  }
  $('dmSelectedCount').textContent='0 selected';$('dmCount').textContent=(records[kind]||[]).length+' records';
  $('dmConfirmation').value='';$('dmBackupAck').checked=false;
 }
 async function load(){report('Loading record list…');try{records=await api('data-management');render();report('Select the records you want to remove. Linked payment, production and stock history is protected.')}catch(e){report(e.message,true)}}
 async function open(kind,id=''){
  $('dmKind').value=kind;
  document.querySelector('[data-section="data-management"]')?.click();
  await load();
  if(id){const checkbox=[...$('dmList').querySelectorAll('input')].find(c=>c.value===id);if(checkbox){checkbox.checked=true;checkbox.dispatchEvent(new Event('change'))}}
  $('data-management').scrollIntoView({behavior:'smooth',block:'start'});
 }
 function attach(kind,at){if(!at)return;const button=document.createElement('button');button.type='button';button.className='pn-delete-action';button.textContent='Delete records';button.onclick=()=>open(kind);at.append(button)}
 attach('orders',document.querySelector('#orders .toolbar'));
 attach('products',document.querySelector('#products .pn-workspace-actions'));
 attach('filament',document.querySelector('#inventory .pn-workspace-actions'));
 const nav=document.querySelector('[data-section="data-management"]');nav?.addEventListener('click',load);
 $('dmKind').addEventListener('change',render);
 $('dmRefresh').onclick=load;
 $('dmSelectAll').onclick=()=>{for(const ck of $('dmList').querySelectorAll('input'))ck.checked=true;$('dmSelectedCount').textContent=selectedIds().length+' selected'};
 $('dmClear').onclick=()=>{for(const ck of $('dmList').querySelectorAll('input'))ck.checked=false;$('dmSelectedCount').textContent='0 selected'};
 $('dmBackup').onclick=async()=>{
  report('Exporting a protected operational snapshot…');try{
   const data=await api('data-management?mode=backup');
   const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download='PrintNest-V14-Backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
   backupDownloaded=true;$('dmBackupAck').checked=true;
   report('Backup downloaded. This JSON snapshot does not contain R2 image or receipt file binaries. For full restore capability also export Cloudflare D1 and R2.');
  }catch(e){report(e.message,true)}
 };
 $('dmDelete').onclick=async()=>{
  const kind=$('dmKind').value,all=$('dmDeleteMode').value==='all',ids=selectedIds();
  const count=all?(records[kind]||[]).length:ids.length;
  if(!count)return report('No records selected',true);
  if(!backupDownloaded||!$('dmBackupAck').checked)return report('Download the backup and acknowledge it before deletion',true);
  const phrase='DELETE '+kind.toUpperCase();if($('dmConfirmation').value!==phrase)return report('Type exactly '+phrase+' to confirm',true);
  if(!confirm('PERMANENT deletion of '+count+' '+kind+' record(s). Linked records may block this action. Continue?'))return;
  $('dmDelete').disabled=true;try{
   const result=await api('data-management',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,mode:all?'all':'selected',ids:all?undefined:ids,expected_count:all?count:undefined,confirmation:phrase,backup_ack:true})});
   report('Deleted '+result.count+' records. Original backup remains in your Downloads.');backupDownloaded=false;await load();
  }catch(e){report(e.message,true)}finally{$('dmDelete').disabled=false}
 };
 window.PrintNestV14={open,load};
})();
