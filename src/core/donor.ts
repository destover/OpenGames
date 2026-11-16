import { readFileSync } from 'node:fs';
import { narrativePreview, responseLines } from './generation.ts';
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
    const request=donorRequest(game,session,action,this.node.model,correction,options?.generation);
    let response: Response;
    try {
      response = await fetch(this.node.url + '/chat/completions', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},signal:options?.signal||AbortSignal.timeout(remaining),body:JSON.stringify({...request,stream:!!options?.onNarrative})});
    } catch(error) { throw new DonorUnavailableError(error instanceof Error&&error.name==='AbortError'?'Сценарист не ответил в установленный срок. Повторите ход позже.':'Сценарист временно недоступен или не успел ответить. Повторите ход позже.'); }
    if (!response.ok) throw new DonorUnavailableError('Сценарист временно недоступен. Повторите ход позже.');
    try {
      let content = '', usage;
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        let finished = false, bytes = 0;
        for await (const line of responseLines(response)) {
          bytes += Buffer.byteLength(line);
          if (bytes > DONOR_MAX_RESULT_BYTES * 8) throw new Error('Ответ превышает допустимый размер');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { finished = true; break; }
          const data = JSON.parse(payload);
          if (data.error || data.choices?.[0]?.finish_reason === 'error') throw new Error('Соавтор прервал ответ');
          content += data.choices?.[0]?.delta?.content || '';
          if (Buffer.byteLength(content) > DONOR_MAX_RESULT_BYTES) throw new Error('Ответ превышает допустимый размер');
          usage = tokenUsage(data.usage) ?? usage;
          finished ||= Boolean(data.choices?.[0]?.finish_reason);
          options?.onNarrative?.(narrativePreview(content));
        }
        if (!finished) throw new Error('Соавтор вернул неполный ответ');
      } else {
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (!response.body) throw new Error('Соавтор вернул пустой ответ');
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > DONOR_MAX_RESULT_BYTES) throw new Error('Ответ превышает допустимый размер');
          chunks.push(chunk);
        }
        const data = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
        content = data.choices?.[0]?.message?.content;
        usage = tokenUsage(data.usage);
      }
      return { ...parseResult(JSON.parse(content),game,action,'donor',session), usage };
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      throw new DonorUnavailableError('Сценарист вернул неполный или некорректный ответ. Повторите ход.');
    }

  }
}

function tokenUsage(value: unknown) {
  const prompt = Number((value as {prompt_tokens?:unknown}|undefined)?.prompt_tokens);
  const completion = Number((value as {completion_tokens?:unknown}|undefined)?.completion_tokens);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
    ? { promptTokens: Math.round(prompt), completionTokens: Math.round(completion) }
    : undefined;
}
