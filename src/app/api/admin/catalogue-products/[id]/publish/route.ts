import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readBoundedCatalogueJson, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';
export const dynamic='force-dynamic'; export const runtime='nodejs'; type Context={params:{id:string}};
export async function POST(request:NextRequest,{params}:Context){const {session,error}=await readCatalogueAdminSession(request,true);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.publish(params.id,await readBoundedCatalogueJson(request),session!.token),{headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
