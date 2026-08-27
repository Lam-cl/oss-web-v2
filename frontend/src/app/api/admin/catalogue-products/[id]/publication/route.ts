import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';
export const dynamic='force-dynamic'; export const runtime='nodejs'; type Context={params:{id:string}};
export async function GET(request:NextRequest,{params}:Context){const {error}=await readCatalogueAdminSession(request,false);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.publication(params.id),{headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
