import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type LegalDocumentId='terms'|'privacy';
export type ExecutorForm='ip'|'ooo'|'selfemployed';
export const EXECUTOR_FORMS:{id:ExecutorForm;label:string}[]=[
  { id:'ip', label:'ИП' },
  { id:'ooo', label:'ООО' },
  { id:'selfemployed', label:'Самозанятый (НПД)' }
];
export type LegalValues=Record<string,string>;

export type LegalFieldDef={key:string;document:LegalDocumentId;label:string;hint?:string;forms?:ExecutorForm[]};
export type LegalField=LegalFieldDef&{value:string;required:boolean;applies:boolean;automatic:boolean};

export const LEGAL_DOCUMENTS:{id:LegalDocumentId;title:string;route:string;template:string;extraKey:string}[]=[
  { id:'terms', title:'Публичная оферта', route:'/legal/terms', template:'terms.html', extraKey:'terms.date' },
  { id:'privacy', title:'Политика конфиденциальности', route:'/legal/privacy', template:'privacy.html', extraKey:'privacy.date' }
];

const ALL:ExecutorForm[]=['ip','ooo','selfemployed'];
const COMPANY:ExecutorForm[]=['ip','ooo'];

export const LEGAL_FIELDS:LegalFieldDef[]=[
  { key:'terms.executor.form', document:'terms', label:'Форма организации', hint:'определяет состав обязательных полей' },
  { key:'terms.date', document:'terms', label:'Дата редакции оферты', hint:'например: 3 октября 2026' },
  { key:'terms.executor.name', document:'terms', label:'Наименование или ФИО', hint:'для ИП и самозанятого — ФИО, для ООО — наименование' },
  { key:'terms.executor.inn', document:'terms', label:'ИНН' },
  { key:'terms.executor.kpp', document:'terms', label:'КПП', hint:'только для ООО', forms:['ooo'] },
  { key:'terms.executor.ogrn', document:'terms', label:'ОГРНИП или ОГРН', hint:'не применяется к самозанятому', forms:COMPANY },
  { key:'terms.executor.address', document:'terms', label:'Юридический адрес', hint:'для самозанятого указывается адрес регистрации или «не применяется»', forms:COMPANY },
  { key:'terms.executor.email', document:'terms', label:'Электронная почта для обращений' },
  { key:'terms.executor.phone', document:'terms', label:'Телефон' },
  { key:'terms.tax.regime', document:'terms', label:'Налоговый режим', hint:'для самозанятого подставляется НПД автоматически', forms:COMPANY },
  { key:'terms.receipt.mode', document:'terms', label:'Как выдаются чеки', hint:'для самозанятого подставляется «в приложении „Мой налог“»', forms:COMPANY },
  { key:'terms.refund.period', document:'terms', label:'Срок возврата', hint:'например: 14 календарных дней' },
  { key:'terms.refund.review', document:'terms', label:'Срок рассмотрения обращения о возврате', hint:'например: 10 рабочих дней' },
  { key:'terms.claim.review', document:'terms', label:'Срок ответа на претензию' },
  { key:'terms.outage.refund', document:'terms', label:'Срок недоступности сервиса без вычета', hint:'за какой срок простоя возврат идёт без вычета' },

  { key:'privacy.executor.form', document:'privacy', label:'Форма организации' },
  { key:'privacy.date', document:'privacy', label:'Дата редакции политики' },
  { key:'privacy.executor.name', document:'privacy', label:'Наименование или ФИО оператора' },
  { key:'privacy.executor.inn', document:'privacy', label:'ИНН оператора' },
  { key:'privacy.executor.kpp', document:'privacy', label:'КПП', hint:'только для ООО', forms:['ooo'] },
  { key:'privacy.executor.ogrn', document:'privacy', label:'ОГРНИП или ОГРН', hint:'не применяется к самозанятому', forms:COMPANY },
  { key:'privacy.executor.address', document:'privacy', label:'Адрес оператора', hint:'для самозанятого указывается адрес регистрации или «не применяется»', forms:COMPANY },
  { key:'privacy.executor.email', document:'privacy', label:'Почта для обращений по персональным данным' },
  { key:'privacy.executor.phone', document:'privacy', label:'Телефон' },
  { key:'privacy.executor.responsible', document:'privacy', label:'Ответственный за обработку данных', hint:'для самозанятого указывается сам заявитель' },
  { key:'privacy.location', document:'privacy', label:'Где размещаются базы данных', hint:'страна и оператор хранения' },
  { key:'privacy.terms.retention', document:'privacy', label:'Срок хранения данных аккаунта' },
  { key:'privacy.games.retention', document:'privacy', label:'Срок хранения игровых данных' },
  { key:'privacy.logs.retention', document:'privacy', label:'Срок хранения технических журналов' },
  { key:'privacy.claims.response', document:'privacy', label:'Срок ответа на обращение', hint:'например: 30 дней' },
  { key:'privacy.deletion', document:'privacy', label:'Срок удаления данных после обращения' },
  { key:'privacy.notice', document:'privacy', label:'Срок уведомления об изменениях политики' }
];

const escape=(value:string)=>String(value).replace(/[&<>"']/g,char=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] as string));
const AUTO_BY_FORM:Partial<Record<ExecutorForm,Record<string,string>>>={
  selfemployed:{ 'terms.tax.regime':'налог на профессиональный доход (НПД)','terms.receipt.mode':'в приложении «Мой налог» без комиссии сервиса' }
};

export class LegalStore {
  private path:string;private values:LegalValues={};private updatedAt:string|null=null;
  constructor(path:string){this.path=path;mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)){try{const parsed=JSON.parse(readFileSync(path,'utf8')) as {values?:LegalValues;updatedAt?:string};this.values=parsed.values||{};this.updatedAt=parsed.updatedAt||null}catch{this.values={}}}}
  definition(key:string){return LEGAL_FIELDS.find(item=>item.key===key)}
  form(document:LegalDocumentId):ExecutorForm|null{const key=document+'.executor.form',value=String(this.values[key]||'').trim();return (EXECUTOR_FORMS.some(item=>item.id===value)?value:null) as ExecutorForm|null}
  private applies(field:LegalFieldDef,form:ExecutorForm|null){return !field.forms||(form?field.forms.includes(form):true)}
  /** Автоматически подставляемое значение: определяется формой и не требует ввода. */
  private automatic(field:LegalFieldDef|undefined,form:ExecutorForm|null){if(!field?.forms||field.forms.includes('selfemployed')||form!=='selfemployed')return null;return AUTO_BY_FORM[form]?.[field.key]||null}
  value(key:string){const field=this.definition(key),form=field?this.form(field.document):null;return this.automatic(field,form)||String(this.values[key]??'').trim()}
  fields(document?:LegalDocumentId):LegalField[]{return LEGAL_FIELDS.filter(item=>!document||item.document===document).map(field=>{const form=this.form(field.document),applies=this.applies(field,form),automatic=!!this.automatic(field,form);
      return {...field,value:this.value(field.key),automatic,required:applies&&!automatic&&(!field.forms||form!==null),applies}})}
  missing(document:LegalDocumentId){return this.fields(document).filter(field=>field.required&&!field.value).map(field=>field.key)}
  complete(document:LegalDocumentId){return this.missing(document).length===0}
  status(){return LEGAL_DOCUMENTS.map(doc=>{const missing=this.missing(doc.id);return {id:doc.id,title:doc.title,route:doc.route,form:this.form(doc.id),missing:missing.length,published:missing.length===0,fields:this.fields(doc.id)}})}
  save(values:LegalValues,reason:string){const clean=String(reason||'').trim();if(clean.length<3||clean.length>300)throw Object.assign(new Error('Укажите причину изменения (3–300 символов)'),{status:400});
    const next:LegalValues={};let changed=0;
    for(const field of LEGAL_FIELDS){const value=String(values[field.key]??this.values[field.key]??'').trim();if(value.length>400)throw Object.assign(new Error('Значение поля «'+field.label+'» длиннее 400 символов'),{status:400});next[field.key]=value;if(value!==String(this.values[field.key]||'').trim())changed++}
    if(changed===0)throw Object.assign(new Error('Ни одно поле не изменилось'),{status:400});
    this.values=next;this.updatedAt=new Date().toISOString();
    writeFileSync(this.path,JSON.stringify({updatedAt:this.updatedAt,reason:clean,values:next},null,2),{mode:0o600});chmodSync(this.path,0o600);
    return {updatedAt:this.updatedAt,reason:clean,changed,documents:this.status()}}
  render(template:string,document:LegalDocumentId){const missing=this.missing(document),form=this.form(document);
    const resolve=(key:string):string=>{
      if(key.endsWith('.executor.form')){const label=EXECUTOR_FORMS.find(item=>item.id===form)?.label||'организация';return '<span class="value">'+escape(label)+'</span>'}
      const field=this.definition(key);
      if(field&&this.automatic(field,form))return '<span class="value">'+escape(this.value(key))+'</span>';
      if(field&&!this.applies(field,form))return '<span class="na">не применяется</span>';
      const value=this.value(key);
      if(value)return '<span class="value">'+escape(value)+'</span>';
      return '<span class="todo"'+(field?' title="'+escape(field.label)+'"':'')+'>не заполнено</span>'};
    // сначала заменяем весь служебный элемент целиком, затем оставшиеся токены
    const html=String(template)
      .replace(/<span class="todo" data-legal="([a-z]+(?:\.[a-z]+)+)"[^>]*>\s*\{\{\1\}\}\s*<\/span>/g,(_match,key:string)=>resolve(key))
      .replace(/\{\{([a-z]+(?:\.[a-z]+)+)\}\}/g,(_match,key:string)=>resolve(key));
    return {html,published:missing.length===0,missing}}
  adminView(){return {updatedAt:this.updatedAt,forms:EXECUTOR_FORMS,documents:this.status()}}
  /** Страница для посетителя, пока документ не заполнен: текст документа не раскрывается. */
  unpublishedPage(title:string){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet"><title>${escape(title)} · OpenGames</title><style>body{margin:0;background:#f7f8f5;color:#1c1f1d;font:16px/1.65 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:520px;margin:24px;background:#fff;border:1px solid #e2e6e1;border-left:3px solid #8a5a00;border-radius:12px;padding:24px}h1{font-size:1.3rem;margin:0 0 12px}p{margin:8px 0;color:#5b6560;font-size:.95rem}</style></head><body><main><h1>${escape(title)}</h1><p>Документ ещё не опубликован: реквизиты исполнителя не заполнены в панели управления.</p><p>Вернитесь позже или напишите нам — контакты указаны на странице оплаты.</p></main></body></html>`}
}