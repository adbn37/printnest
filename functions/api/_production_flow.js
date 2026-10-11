// Shared, explicit production flow. Printing and customer handover are different steps.
export const productionStageLabels = Object.freeze({
 new:'New',confirmed:'Confirmed',awaiting_materials:'Awaiting materials',
 ready_to_print:'Ready to print',printing:'Printing',quality_check:'Quality check',
 packaging:'Packaging',ready:'Ready (legacy)',ready_for_collection:'Ready for collection',
 ready_for_delivery:'Ready for delivery',collected:'Collected',delivered:'Delivered',
 completed:'Completed',cancelled:'Cancelled'
});
export const productionSteps = Object.freeze(Object.keys(productionStageLabels));
export const postPrintStages = Object.freeze(['quality_check','packaging','ready','ready_for_collection','ready_for_delivery','collected','delivered','completed']);
export const prePrintStages = Object.freeze(['new','confirmed','awaiting_materials','ready_to_print']);
export function nextProductionStage(stage,method='collection'){
 const handover=method==='delivery';
 const next={new:'confirmed',confirmed:'ready_to_print',awaiting_materials:'ready_to_print',
 ready_to_print:'printing',printing:'quality_check',quality_check:'packaging',
 packaging:handover?'ready_for_delivery':'ready_for_collection',
 ready:handover?'ready_for_delivery':'ready_for_collection',
 ready_for_collection:'collected',ready_for_delivery:'delivered',
 collected:'completed',delivered:'completed'};
 return next[stage]||null;
}
export function productionLane(stage){
 if(stage==='cancelled')return 'cancelled';
 if(stage==='completed')return 'completed';
 if(['new','confirmed'].includes(stage))return 'queued';
 if(stage==='awaiting_materials')return 'materials';
 if(stage==='ready_to_print')return 'ready';
 if(['printing','quality_check','packaging'].includes(stage))return 'active';
 return 'handover';
}
