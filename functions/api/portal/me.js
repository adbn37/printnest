import {json} from '../_shared.js';import {guard} from './_auth.js';
export async function onRequestGet({request,env}){const g=await guard(request,env);return g.response||json({email:g.user.email,role:g.user.role})}
