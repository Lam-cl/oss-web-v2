import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, requestIsSameOrigin, safeError } from '@/lib/admin/server';
import { createSimProductBundleAdapter, SimProductBundleAdapterError } from '@/lib/admin/simProductBundleAdapter.server';
import { SimProductUpdateError, updateSimProductInPlace } from '@/lib/admin/simProductUpdate.server';
import { catalogueMediaRequestError, readBoundedCatalogueMediaForm } from '@/lib/admin/catalogueMediaRoute.server';
export const dynamic='force-dynamic';export const runtime='nodejs';
const text=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==='string'?value:null;};
export async function POST(request:NextRequest,{params}:{params:{productId:string}}){
 const session=await getAdminSession(request);if(!session)return safeError(401);if(!requestIsSameOrigin(request))return safeError(403);
 const productId=Number(params.productId);if(productId!==39&&productId!==40)return safeError(404);
 try{const form=await readBoundedCatalogueMediaForm(request),keys=Array.from(form.keys());if(keys.includes('image')||keys.includes('imageSha256'))return safeError(400,{message:'SIM image is locked read-only for this release; image uploads are not allowed.'});const allowed=new Set(['expectedFingerprint','description','productDetails','price','variants']);if(keys.some(key=>!allowed.has(key))||new Set(keys).size!==keys.length||!['expectedFingerprint','description','productDetails','price','variants'].every(key=>keys.includes(key)))return safeError(400);const price=Number(text(form,'price'));let variants:unknown;try{variants=JSON.parse(text(form,'variants')??'')}catch{return safeError(400,{message:'Exact two-row SIM variant matrix is required.'})}const result=await updateSimProductInPlace({productId,expectedFingerprint:text(form,'expectedFingerprint')??'',description:text(form,'description')??'',productDetails:text(form,'productDetails')??'',price,variants:variants as any},createSimProductBundleAdapter(session.token));return NextResponse.json(result,{headers:{'cache-control':'no-store'}});
 }catch(reason){if(reason instanceof SimProductUpdateError||reason instanceof SimProductBundleAdapterError)return safeError(reason.status,{message:reason.message});return catalogueMediaRequestError(reason);}
}
