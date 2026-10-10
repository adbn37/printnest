// Google ID token validation for Google Identity Services. Server-side authorization is mandatory.
import {json} from '../_shared.js';
const DEVELOPER='zardeerwandy@gmail.com';
const MASTER='amni.zafirah19@gmail.com';
const jwkUrl='https://www.googleapis.com/oauth2/v3/certs';
const utf8=new TextEncoder();
function decodeBase64Url(x){const b=atob(x.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(b,c=>c.charCodeAt(0))}
function parsePart(x){return JSON.parse(new TextDecoder().decode(decodeBase64Url(x)))}
export async function roleFor(request,env){
 const client=env.GOOGLE_CLIENT_ID;
 if(!client)return {error:'Google sign-in is not configured',status:503};
 const m=/^Bearer (\S+)$/.exec(request.headers.get('Authorization')||'');if(!m)return {error:'Sign in with Google',status:401};
 try{
  const parts=m[1].split('.');if(parts.length!==3)return {error:'Invalid session',status:401};
  const head=parsePart(parts[0]),body=parsePart(parts[1]);
  if(head.alg!=='RS256'||!head.kid||body.aud!==client||!['accounts.google.com','https://accounts.google.com'].includes(body.iss)||body.email_verified!==true||!body.sub||typeof body.exp!=='number'||body.exp<=Math.floor(Date.now()/1000)||typeof body.iat!=='number'||body.iat>Math.floor(Date.now()/1000)+60)return {error:'Google session invalid or expired',status:401};
  const email=String(body.email||'').toLowerCase();
  const role=email===DEVELOPER?'developer':email===MASTER?'master_admin':null;
  if(!role)return {error:'Account not authorized for PrintNest',status:403};
  const res=await fetch(jwkUrl,{cf:{cacheTtl:300,cacheEverything:true}});
  if(!res.ok)throw Error('Google keys unavailable');
  const jwks=await res.json();const jwk=jwks.keys?.find(k=>k.kid===head.kid&&k.kty==='RSA'&&k.use==='sig');if(!jwk)throw Error('Unknown signing key');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(parts[2]),utf8.encode(parts[0]+'.'+parts[1]));
  return ok?{email,role,sub:body.sub}:{error:'Invalid Google signature',status:401};
 }catch{return {error:'Could not verify Google login',status:401}}
}
export async function guard(request,env,{master=false}={}){const user=await roleFor(request,env);if(user.error)return {response:json({error:user.error},user.status)};if(master&&!['developer','master_admin'].includes(user.role))return {response:json({error:'Master admin only'},403)};return {user}}
export const invalid=(message,status=400)=>json({error:message},status);
export const permittedPayments=['unpaid','awaiting_review','verified','rejected'];
export const permittedStages=['new','confirmed','printing','ready','completed','cancelled'];
