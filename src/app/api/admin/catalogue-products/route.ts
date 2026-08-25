import { NextRequest, NextResponse } from 'next/server';
import { catalogueAdminError, catalogueAdminRoute, readBoundedCatalogueJson, readCatalogueAdminSession } from '@/lib/admin/catalogueAdminRoute.server';
export const dynamic='force-dynamic'; export const runtime='nodejs';
export async function GET(request:NextRequest){const {error}=await readCatalogueAdminSession(request,false);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.list(),{headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
export async function POST(request:NextRequest){const {error}=await readCatalogueAdminSession(request,true);if(error)return error;try{return NextResponse.json(await catalogueAdminRoute.create(await readBoundedCatalogueJson(request)),{status:201,headers:{'cache-control':'no-store'}});}catch(reason){return catalogueAdminError(reason);}}
