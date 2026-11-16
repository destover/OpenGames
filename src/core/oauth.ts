import { createHash, randomBytes } from 'node:crypto';
import type { AccountStore } from './accounts.ts';

const providers = {
  google: { authorize:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token', scope:'openid profile' },
  yandex: { authorize:'https://oauth.yandex.ru/authorize', token:'https://oauth.yandex.ru/token', scope:'login:info' },
  vk: { authorize:'https://id.vk.ru/authorize', token:'https://id.vk.ru/oauth2/auth', scope:'' }
} as const;
export type OAuthProvider = keyof typeof providers;
type Identity = { provider: OAuthProvider; subject: string; displayName: string };
type Flow = { provider: OAuthProvider; browser: string; verifier: string; expires: number };
const lifetime = 600;

async function requestJson(url: string | URL, options?: RequestInit) {
  const response = await fetch(url, { ...options, redirect:'error', signal:AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('OAuth request failed');
  const data = await response.json();
  if (!data || typeof data !== 'object' || data.error) throw new Error('Invalid OAuth response');
  return data;
}

export class OAuthLogin {
  private readonly flows = new Map<string, Flow>();
  private readonly accounts: AccountStore;
  private readonly origin?: string;
  constructor(accounts: AccountStore, origin?: string) { this.accounts = accounts; this.origin = origin; }

  private client(provider: OAuthProvider) {
    const saved = this.accounts.getOAuthClient(provider);
    if (saved) return saved;
    const prefix = 'OPENGAME_OAUTH_' + provider.toUpperCase();
    const clientId = process.env[prefix + '_CLIENT_ID']?.trim() || '';
    const secret = process.env[prefix + '_CLIENT_SECRET']?.trim();
    return { clientId, secret, enabled:Boolean(clientId && (provider === 'vk' || secret)) };
  }

  private redirect(provider: OAuthProvider) {
    if (!this.origin) return;
    const url = new URL('/api/auth/oauth/' + provider + '/callback', this.origin);
    if (url.protocol === 'https:' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return url.href;
  }

  private config(provider: OAuthProvider) {
    const { clientId, secret, enabled } = this.client(provider);
    const redirect = this.redirect(provider);
    if (enabled && redirect && clientId && (provider === 'vk' || secret)) return { ...providers[provider], clientId, secret, redirect };
  }

  available() {
    return (Object.keys(providers) as OAuthProvider[]).filter(provider => this.config(provider));
  }

  adminView() {
    return (Object.keys(providers) as OAuthProvider[]).map(provider => {
      const { clientId, secret, enabled } = this.client(provider);
      return { provider, clientId, hasSecret:Boolean(secret), enabled, redirect:this.redirect(provider) };
    });
  }

  update(provider: OAuthProvider, value: unknown) {
    const invalid = (message: string) => Object.assign(new Error(message), {status:400});
    if (!value || typeof value !== 'object') throw invalid('Некорректные настройки OAuth');
    const { clientId, secret, enabled } = value as Record<string, unknown>;
    if (typeof clientId !== 'string' || typeof enabled !== 'boolean' ||
      (secret !== undefined && typeof secret !== 'string')) throw invalid('Некорректные настройки OAuth');
    const id = clientId.trim();
    const replacement = provider === 'vk' ? undefined : secret?.trim();
    if (!/^[!-~]{0,512}$/.test(id) || (replacement && !/^[!-~]{1,512}$/.test(replacement))) {
      throw invalid('Проверьте Client ID и секрет OAuth');
    }
    const current = this.client(provider);
    const effectiveSecret = replacement || (id === current.clientId && provider !== 'vk' ? current.secret : undefined);
    if (enabled && (!this.redirect(provider) || !id || (provider !== 'vk' && !effectiveSecret))) {
      throw invalid('Укажите адрес сайта и учётные данные OAuth перед включением входа');
    }
    this.accounts.setOAuthClient(provider,id,enabled,effectiveSecret);
    for (const [state, flow] of this.flows) if (flow.provider === provider) this.flows.delete(state);
  }

  cookie(value: string) {
    return 'opengame_oauth=' + value + '; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=' +
      (value ? lifetime : 0) + (this.origin?.startsWith('https:') ? '; Secure' : '');
  }

  start(provider: OAuthProvider) {
    const config = this.config(provider);
    if (!config) return;
    const now = Date.now();
    for (const [state, flow] of this.flows) if (flow.expires <= now) this.flows.delete(state);
    if (this.flows.size >= 4096) return;
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    this.flows.set(state, { provider, browser, verifier, expires:now + lifetime * 1000 });
    const url = new URL(config.authorize);
    url.search = new URLSearchParams({
      response_type:'code', client_id:config.clientId, redirect_uri:config.redirect,
      scope:config.scope, state, code_challenge:createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method:provider === 'vk' ? 's256' : 'S256'
    }).toString();
    return { url:url.href, cookie:this.cookie(browser) };
  }

  async finish(provider: OAuthProvider, query: URLSearchParams, browser?: string): Promise<Identity | undefined> {
    const config = this.config(provider);
    const state = query.get('state');
    const flow = state && this.flows.get(state);
    if (!config || !state || !flow || flow.provider !== provider || flow.browser !== browser || flow.expires <= Date.now()) return;
    this.flows.delete(state);
    const code = query.get('code');
    const device = query.get('device_id');
    if (query.has('error') || !code || code.length > 4096 || (provider === 'vk' && (!device || device.length > 512))) return;

    const tokenUrl = new URL(config.token);
    const params = new URLSearchParams({
      grant_type:'authorization_code', client_id:config.clientId, redirect_uri:config.redirect, code_verifier:flow.verifier
    });
    if (provider === 'vk') {
      params.set('device_id', device!);
      params.set('state', state);
      tokenUrl.search = params.toString();
    } else if (config.secret) {
      params.set('client_secret', config.secret);
    }
    const body = provider === 'vk' ? new URLSearchParams() : params;
    body.set('code', code);
    const token = await requestJson(tokenUrl, { method:'POST', body });
    if (typeof token.access_token !== 'string' || !token.access_token || (provider === 'vk' && token.state !== state)) return;

    let subject, displayName;
    if (provider === 'google') {
      const profile = await requestJson('https://openidconnect.googleapis.com/v1/userinfo', {
        headers:{ Authorization:'Bearer ' + token.access_token }
      });
      subject = profile.sub;
      displayName = profile.name;
    } else if (provider === 'yandex') {
      const profile = await requestJson('https://login.yandex.ru/info?format=json', {
        headers:{ Authorization:'OAuth ' + token.access_token }
      });
      if (profile.client_id !== config.clientId) return;
      subject = profile.id;
      displayName = profile.display_name || profile.real_name || profile.login;
    } else {
      const infoUrl = new URL('https://id.vk.ru/oauth2/user_info');
      infoUrl.searchParams.set('client_id', config.clientId);
      const profile = (await requestJson(infoUrl, {
        method:'POST', body:new URLSearchParams({ access_token:token.access_token })
      })).user;
      subject = profile?.user_id;
      if (!token.user_id || String(subject) !== String(token.user_id)) return;
      displayName = [profile?.first_name, profile?.last_name].filter(value => typeof value === 'string').join(' ');
    }
    if (typeof subject !== 'string' && !Number.isSafeInteger(subject)) return;
    const id = String(subject);
    if (!id || id.length > 255) return;
    return { provider, subject:id, displayName:typeof displayName === 'string' ? displayName.trim().slice(0,80) : '' };
  }
}
