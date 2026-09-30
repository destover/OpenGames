import { readFileSync } from 'node:fs';
import { parseResult } from './ai.ts';
import { donorRequest, DONOR_LEASE_MS, DONOR_MAX_RESULT_BYTES } from './donor-protocol.ts';
import type { AIProvider, AIRequestOptions } from './ai.ts';
import type { GamePackage, Session, Action } from './types.ts';
import type { StaticDonorNode } from './donor-pool.ts';

export class DonorUnavailableError extends Error {}

export class DonorAIProvider implements AIProvider {
  private node:StaticDonorNode;
  constructor(node:StaticDonorNode){this.node=node}
  async generate(game: GamePackage, session: Session, action: Action, correction?: string, options?: AIRequestOptions) {
    const deadline=options?.deadline||Date.now()+DONOR_LEASE_MS,remaining=deadline-Date.now();
    if (remaining <= 0) throw new Error('Время ответа сценариста истекло. Повторите ход.');
    const key = readFileSync(this.node.keyFile, 'utf8').trim();
    const request=donorRequest(game,session,action,this.node.model,correction);
    let response: Response;
    try {
      response = await fetch(this.node.url + '/chat/completions', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},signal:options?.signal||AbortSignal.timeout(remaining),body:JSON.stringify(request)});
    } catch(error) { throw new DonorUnavailableError(error instanceof Error&&error.name==='AbortError'?'Сценарист не ответил в установленный срок. Повторите ход позже.':'Сценарист временно недоступен или не успел ответить. Повторите ход позже.'); }
    if (!response.ok) throw new DonorUnavailableError('Сценарист временно недоступен. Повторите ход позже.');
    const chunks:Uint8Array[]=[];let size=0;
    if(!response.body)throw new Error('Сценарист вернул пустой ответ');
    for await(const chunk of response.body){size+=chunk.byteLength;if(size>DONOR_MAX_RESULT_BYTES){await response.body.cancel().catch(()=>{});throw new Error('Сценарист вернул слишком большой ответ')}chunks.push(chunk)}
    const raw=new TextDecoder().decode(Buffer.concat(chunks));
    let data:any;
    try{data=JSON.parse(raw)}catch{throw new DonorUnavailableError('Сценарист вернул неполный ответ. Повторите ход.')}
    let result;
    try {
      result = JSON.parse(data.choices[0].message.content);
      const parsed = parseResult(result,game,action,'donor',session);
      const usage = tokenUsage(data.usage);
      return usage ? { ...parsed, usage } : parsed;
    }
    catch { throw new DonorUnavailableError('Сценарист вернул некорректный ответ. Повторите ход.'); }
  }
}

function tokenUsage(value: unknown) {
  const prompt = Number((value as {prompt_tokens?:unknown}|undefined)?.prompt_tokens);
  const completion = Number((value as {completion_tokens?:unknown}|undefined)?.completion_tokens);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
    ? { promptTokens: Math.round(prompt), completionTokens: Math.round(completion) }
    : undefined;
}
