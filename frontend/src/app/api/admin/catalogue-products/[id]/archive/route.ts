import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readBoundedCatalogueJson, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';
import { invalidatePublicCatalogueOnSuccess } from '@/lib/catalogueCache.server';
export const dynamic='force-dynamic'; export const runtime='nodejs'; type Context={params:{id:string}};
export async function POST(request:NextRequest,{params}:Context){const {error}=await readCatalogueAdminSession(request,true);if(error)return error;try{return invalidatePublicCatalogueOnSuccess(NextResponse.json(await catalogueAdminRoute.archive(params.id,await readBoundedCatalogueJson(request)),{headers:{'cache-control':'no-store'}}));}catch(reason){return catalogueAdminError(reason);}}