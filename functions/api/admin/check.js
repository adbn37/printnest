import {authorize,json} from '../_shared.js';
export function onRequestGet({request,env}){return authorize(request,env)?json({ok:true}):json({error:'Unauthorized'},401)}
