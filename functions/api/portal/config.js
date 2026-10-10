import {json} from '../_shared.js';
export function onRequestGet({env}){return json({clientId:env.GOOGLE_CLIENT_ID||null,configured:Boolean(env.GOOGLE_CLIENT_ID)})}
