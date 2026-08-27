import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readBoundedCatalogueJson, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';
export const dynamic='force-dynamic'; export const runtime='nodejs'; type Context={params:{id:string}};
export async function GET(request:NextRequest,{params}:Context){const {error}=await readCatalogueAdminSession(request,false);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.get(params.id),{headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
export async function PATCH(request:NextRequest,{params}:Context){const {error}=await readCatalogueAdminSession(request,true);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.update(params.id,await readBoundedCatalogueJson(request)),{headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
