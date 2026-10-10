import {mergeCatalog,snapshot} from './_printing.js';
import {recipeFromCatalog} from './_materials.js';
import {getCatalog} from './_shared.js';

export async function loadTrustedProducts(env){return mergeCatalog(await getCatalog(env))}
export function makeOrderItems(catalog,selected){
 if(!Array.isArray(selected)||!selected.length||selected.length>40)throw Error('Select 1–40 order lines');
 const products=new Map(catalog.map(p=>[p.id,p]));const lines=[];let total=0,unpriced=false;
 for(const request of selected){
  const id=String(request.id||''),quantity=Number(request.qty??request.quantity),p=products.get(id);
  if(!p||p.visible===false||!Number.isInteger(quantity)||quantity<1||quantity>100)throw Error('Invalid product or order quantity');
  let detail,materials,print,price;
  if(p.product_type==='bundle'){
   if(!Array.isArray(p.components)||!p.components.length)throw Error('Bundle components are missing');
   let grams=0,minutes=0,cents=0;materials=[];
   for(const comp of p.components){const component=products.get(comp.id),units=Number(comp.quantity);if(!component||component.product_type==='bundle'||!Number.isInteger(units)||units<1)throw Error('Bundle component is unavailable');
    const snap=snapshot(component);if(snap.print_weight_g==null)throw Error('Bundle component lacks Creality estimates');
    grams+=snap.print_weight_g*units;minutes+=snap.print_minutes*units;cents+=snap.print_cost_cents*units;
    materials.push(...recipeFromCatalog(component).filter(m=>m.kind==='filament').map(m=>({...m,quantity_mg:m.quantity_mg*units})));
   }
   // Packaging and accessories are chosen per order, not inherited from bundle defaults.
   materials=materials.filter(m=>m.kind==='filament');
   print={print_weight_g:grams,print_minutes:minutes,print_cost_cents:cents};
   detail='bundle';
  }else{materials=recipeFromCatalog(p).filter(m=>m.kind==='filament');print=snapshot(p);detail='single'}
  price=p.price===null?null:Math.round(Number(p.price)*100);
  if(price!==null&&(!Number.isSafeInteger(price)||price<0))throw Error('Invalid product price');
  if(price===null)unpriced=true;else total+=price*quantity;
  lines.push({id,title:p.title,quantity,price_cents:price,...print,materials,product_type:detail,recipe_version:1});
 }
 if(total>100000000)throw Error('Order exceeds price limit');
 return {items:lines,total_cents:unpriced?null:total};
}
