import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { dataApiEnabled, mutateRemoteSingleton, readRemoteSingleton } from '@/lib/dataApiClient.server';
import { isCompleteSimAssignment, isValidSimSerial, type SimAssignment, type SimPrefixOption, type SimUnit } from './simAssignments';

export const SIM_ASSIGNMENTS_FILE = path.join(process.cwd(), '.data', 'sim-assignments.json');
type StoredOrder = { updatedAt:string; assignments:SimAssignment[] };
type Store = { version:1; orders:Record<string,StoredOrder> };
type AssignmentInput = { unitKey:string; prefixId?:string; prefix:string; serial:string };
export type SimAssignmentResponse = { orderId:number; units:SimAssignment[]; complete:number; total:number; prefixOptions?:SimPrefixOption[] };
export class SimAssignmentValidationError extends Error {}
let writeQueue:Promise<void> = Promise.resolve();
const emptyStore = ():Store => ({ version:1, orders:{} });
const corrupt = () => new Error('SIM assignment storage is corrupt.');

function validateStore(value:unknown):Store {
  if (!value || typeof value !== 'object') throw corrupt();
  const source=value as Partial<Store>; if (source.version!==1 || !source.orders || typeof source.orders!=='object' || Array.isArray(source.orders)) throw corrupt();
  for (const record of Object.values(source.orders)) {
    if (!record || typeof record!=='object' || typeof record.updatedAt!=='string' || !Array.isArray(record.assignments)) throw corrupt();
    for (const item of record.assignments) if (!item || typeof item.unitKey!=='string' || typeof item.prefix!=='string' || typeof item.serial!=='string') throw corrupt();
  }
  return source as Store;
}
function parseStore(raw:string):Store { let value:unknown; try { value=JSON.parse(raw); } catch { throw corrupt(); } return validateStore(value); }
async function readStore(file:string):Promise<Store> { try { return parseStore(await readFile(file,'utf8')); } catch (reason:any) { if (reason?.code==='ENOENT') return emptyStore(); throw reason instanceof Error ? reason : corrupt(); } }
async function writeStore(store:Store,file:string) { await mkdir(path.dirname(file),{recursive:true}); const temp=`${file}.${process.pid}.${Date.now()}.tmp`; try { await writeFile(temp,`${JSON.stringify(store,null,2)}\n`,{encoding:'utf8',mode:0o600}); await rename(temp,file); } catch (reason) { try { await unlink(temp); } catch {} throw reason; } }
const useRemote=(file:string)=>file===SIM_ASSIGNMENTS_FILE&&dataApiEnabled();
async function loadStore(file:string){return useRemote(file)?validateStore(await readRemoteSingleton<Store>('sim-assignments',emptyStore)):readStore(file)}
async function mutateStore<T>(file:string,operation:(store:Store)=>Promise<T>|T):Promise<T>{if(!useRemote(file)){const store=await readStore(file);const result=await operation(store);await writeStore(store,file);return result}let result!:T;await mutateRemoteSingleton<Store>('sim-assignments',emptyStore,async value=>{const store=validateStore(value);result=await operation(store);return store});return result}
function merged(orderId:number,units:SimUnit[],store:Store):SimAssignmentResponse { const saved=new Map((store.orders[String(orderId)]?.assignments||[]).map(value=>[value.unitKey,value])); const values=units.map(unit=>{const value=saved.get(unit.unitKey);const prefix=value?.prefix||'';const serial=value?.serial||'';return { ...unit, prefixId:value?.prefixId||'', prefix, serial, locked:Boolean(value?.locked||isCompleteSimAssignment({prefix,serial})) };}); return { orderId, units:values, complete:values.filter(isCompleteSimAssignment).length, total:values.length }; }
function normalize(units:SimUnit[],input:AssignmentInput[],existing:SimAssignment[],prefixOptions?:SimPrefixOption[]):SimAssignment[] {
  if (!Array.isArray(input) || input.length!==units.length) throw new SimAssignmentValidationError(`Submit all ${units.length} SIM units.`);
  const byKey=new Map<string,AssignmentInput>(); for (const value of input) { if (!value || typeof value.unitKey!=='string' || byKey.has(value.unitKey)) throw new SimAssignmentValidationError('SIM assignment unit keys are invalid.'); byKey.set(value.unitKey,value); }
  const saved=new Map(existing.map(value=>[value.unitKey,value]));
  const assignments=units.map(unit=>{ const value=byKey.get(unit.unitKey); if (!value) throw new SimAssignmentValidationError('SIM assignment unit keys are invalid.'); if (typeof value.prefix!=='string' || typeof value.serial!=='string') throw new SimAssignmentValidationError('SIM prefix and serial must be strings.'); const prior=saved.get(unit.unitKey); if (prior?.locked) { if (prior.prefix!==value.prefix.trim() || prior.serial!==value.serial.trim()) throw new SimAssignmentValidationError(`${unit.label} is already saved and cannot be changed.`); return prior; } const prefix=value.prefix.trim(); const prefixId=String(value.prefixId||'').trim(); const serial=value.serial.trim(); if ((prefix || serial) && (!prefix || !serial)) throw new SimAssignmentValidationError(`Please fill both SIM prefix and serial for ${unit.label}.`); if (prefix && !/^\d{9}$/.test(prefix)) throw new SimAssignmentValidationError(`Invalid SIM prefix for ${unit.label}.`); if (serial && !isValidSimSerial(serial)) throw new SimAssignmentValidationError(`SIM serial for ${unit.label} must be exactly 11 digits.`); if (prefixOptions && prefix) { const option=prefixOptions.find(item=>item.id===prefixId && item.prefix===prefix); if (!option) throw new SimAssignmentValidationError(`Invalid SIM prefix for ${unit.label}.`); } return { ...unit,prefixId,prefix,serial,locked:Boolean(prefix&&serial) }; });
  const serials=assignments.map(value=>value.serial).filter(Boolean); if (new Set(serials).size!==serials.length) throw new SimAssignmentValidationError('Duplicate SIM serial in this order.'); return assignments;
}
function serialConflict(store:Store,orderId:number,assignments:SimAssignment[]) { const incoming=new Set(assignments.map(value=>value.serial).filter(Boolean)); for (const [otherOrderId,record] of Object.entries(store.orders)) { if (otherOrderId===String(orderId)) continue; for (const value of record.assignments) if (value.serial && incoming.has(value.serial)) throw new SimAssignmentValidationError(`SIM serial ${value.serial} is already assigned to order ${otherOrderId}.`); } }
function serialized<T>(operation:()=>Promise<T>):Promise<T> { const result=writeQueue.then(operation,operation); writeQueue=result.then(()=>undefined,()=>undefined); return result; }

export async function readOrderSimAssignments(orderId:number,units:SimUnit[],file=SIM_ASSIGNMENTS_FILE) { return merged(orderId,units,await loadStore(file)); }
export async function saveOrderSimAssignments(orderId:number,units:SimUnit[],input:AssignmentInput[],file=SIM_ASSIGNMENTS_FILE,prefixOptions?:SimPrefixOption[]) { return serialized(()=>mutateStore(file,store=>{ const existing=merged(orderId,units,store).units; const assignments=normalize(units,input,existing,prefixOptions); serialConflict(store,orderId,assignments); store.orders[String(orderId)]={updatedAt:new Date().toISOString(),assignments}; return merged(orderId,units,store); })); }
export async function assertOrderSimAssignmentsComplete(orderId:number,units:SimUnit[],file=SIM_ASSIGNMENTS_FILE) { if (!units.length) return; const store=await loadStore(file); const response=merged(orderId,units,store); if (response.complete!==response.total) throw new SimAssignmentValidationError(`Complete SIM prefix and 11-digit serial for all ${response.total} SIM units before shipping.`); const seen=new Map<string,string>(); for (const [storedOrderId,record] of Object.entries(store.orders)) for (const value of record.assignments) if (value.serial) { const prior=seen.get(value.serial); if (prior) throw new SimAssignmentValidationError(`Duplicate SIM serial ${value.serial} exists in saved assignments.`); seen.set(value.serial,storedOrderId); } }
