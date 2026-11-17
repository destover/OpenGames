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

export type LegalFieldDef={key:string;document:LegalDocumentId|'shared';label:string;hint?:string;forms?:ExecutorForm[]};
export type LegalField=LegalFieldDef&{value:string;required:boolean;applies:boolean;automatic:boolean};

export const LEGAL_DOCUMENTS:{id:LegalDocumentId;title:string;route:string;template:string}[]=[
  { id:'terms', title:'Публичная оферта', route:'/legal/terms', template:'terms.html' },
  { id:'privacy', title:'Политика конфиденциальности', route:'/legal/privacy', template:'privacy.html' }
];

const COMPANY:ExecutorForm[]=['ip','ooo'];
/** Реквизиты исполнителя — одна сущность, общая для обоих документов. */
export const EXECUTOR_FIELDS:LegalFieldDef[]=[
  { key:'executor.form', document:'shared', label:'Форма организации', hint:'определяет состав обязательных полей в обоих документах' },
  { key:'executor.name', document:'shared', label:'Наименование или ФИО', hint:'для ИП и самозанятого — ФИО, для ООО — наименование' },
  { key:'executor.inn', document:'shared', label:'ИНН' },
  { key:'executor.kpp', document:'shared', label:'КПП', hint:'только для ООО', forms:['ooo'] },
  { key:'executor.ogrn', document:'shared', label:'ОГРНИП или ОГРН', hint:'не применяется к самозанятому', forms:COMPANY },
  { key:'executor.address', document:'shared', label:'Юридический адрес', hint:'для самозанятого — адрес регистрации или «не применяется»', forms:COMPANY },
  { key:'executor.email', document:'shared', label:'Электронная почта' },
  { key:'executor.phone', document:'shared', label:'Телефон' },
  { key:'executor.responsible', document:'shared', label:'Ответственный за обработку персональных данных', hint:'для самозанятого — сам заявитель' }
];
/** Поля, которые нужны только оферте. */
export const TERMS_FIELDS:LegalFieldDef[]=[
  { key:'terms.date', document:'terms', label:'Дата редакции оферты', hint:'например: 3 октября 2026' },
  { key:'terms.tax.regime', document:'terms', label:'Налоговый режим', hint:'для самозанятого подставляется НПД автоматически', forms:COMPANY },
  { key:'terms.receipt.mode', document:'terms', label:'Как выдаются чеки', hint:'для самозанятого подставляется «в приложении „Мой налог“»', forms:COMPANY },
  { key:'terms.claim.review', document:'terms', label:'Срок ответа на претензию' },
];
/** Поля, которые нужны только политике конфиденциальности. */
export const PRIVACY_FIELDS:LegalFieldDef[]=[
  { key:'privacy.date', document:'privacy', label:'Дата редакции политики' },
  { key:'privacy.location', document:'privacy', label:'Где размещаются базы данных', hint:'страна и оператор хранения' },
  { key:'privacy.notice', document:'privacy', label:'Срок уведомления об изменениях политики' }
];
export const LEGAL_FIELDS:LegalFieldDef[]=[...EXECUTOR_FIELDS,...TERMS_FIELDS,...PRIVACY_FIELDS];

const escape=(value:string)=>String(value).replace(/[&<>"']/g,char=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] as string));
const AUTO_BY_FORM:Partial<Record<ExecutorForm,Record<string,string>>>={
  selfemployed:{ 'terms.tax.regime':'налог на профессиональный доход (НПД)','terms.receipt.mode':'в приложении «Мой налог»' }
};
const FIELDS_BY_DOCUMENT:Record<LegalDocumentId,LegalFieldDef[]>={terms:TERMS_FIELDS,privacy:PRIVACY_FIELDS};

/** Перенос значений из прежней модели, где реквизиты дублировались в каждом документе. */
const LEGACY_KEYS:Record<string,string>={ 'terms.executor.form':'executor.form', 'privacy.executor.form':'executor.form', 'terms.executor.name':'executor.name', 'terms.executor.inn':'executor.inn', 'terms.executor.kpp':'executor.kpp', 'terms.executor.ogrn':'executor.ogrn', 'terms.executor.address':'executor.address', 'terms.executor.email':'executor.email', 'terms.executor.phone':'executor.phone', 'privacy.executor.name':'executor.name', 'privacy.executor.inn':'executor.inn', 'privacy.executor.kpp':'executor.kpp', 'privacy.executor.ogrn':'executor.ogrn', 'privacy.executor.address':'executor.address', 'privacy.executor.email':'executor.email', 'privacy.executor.phone':'executor.phone', 'privacy.executor.responsible':'executor.responsible' };

export class LegalStore {
  private path:string;private values:LegalValues={};private updatedAt:string|null=null;
  constructor(path:string){this.path=path;mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)){try{const parsed=JSON.parse(readFileSync(path,'utf8')) as {values?:LegalValues;updatedAt?:string};this.values=this.migrate(parsed.values||{});this.updatedAt=parsed.updatedAt||null}catch{this.values={}}}}
  private migrate(source:LegalValues){const next:LegalValues={...source};let changed=false;
    for(const [legacy,current] of Object.entries(LEGACY_KEYS)){const value=String(source[legacy]||'').trim();if(!value)continue;if(!next[current])next[current]=value;delete next[legacy];changed=true}
    if(changed){this.updatedAt=new Date().toISOString();writeFileSync(this.path,JSON.stringify({updatedAt:this.updatedAt,reason:'перенос реквизитов из прежней модели',values:next},null,2),{mode:0o600});chmodSync(this.path,0o600)}
    return next}
  definition(key:string){return LEGAL_FIELDS.find(item=>item.key===key)}
  form():ExecutorForm|null{const value=String(this.values['executor.form']||'').trim();return (EXECUTOR_FORMS.some(item=>item.id===value)?value:null) as ExecutorForm|null}
  private applies(field:LegalFieldDef){return !field.forms||(this.form()?field.forms.includes(this.form() as ExecutorForm):true)}
  private automatic(field:LegalFieldDef){return field.forms&&!field.forms.includes('selfemployed')&&this.form()==='selfemployed'?AUTO_BY_FORM[this.form() as ExecutorForm]?.[field.key]||null:null}
  value(key:string){const field=this.definition(key);return this.automatic(field as LegalFieldDef)||String(this.values[key]??'').trim()}
  fields(document?:LegalDocumentId|'shared'):LegalField[]{const list=LEGAL_FIELDS.filter(item=>!document||item.document===document);
    return list.map(field=>{const applies=this.applies(field),automatic=!!this.automatic(field);
      return {...field,value:this.value(field.key),automatic,required:applies&&!automatic&&(!field.forms||this.form()!==null),applies}})}
  missing(document:LegalDocumentId):string[]{const shared=this.fields('shared').filter(f=>f.required&&!f.value).map(f=>f.key);
    return [...shared,...this.fields(document).filter(f=>f.required&&!f.value).map(f=>f.key)]}
  missingShared(){return this.fields('shared').filter(f=>f.required&&!f.value).map(f=>f.key)}
  complete(document:LegalDocumentId){return this.missing(document).length===0}
  status(){const sharedMissing=this.missingShared().length;
    return LEGAL_DOCUMENTS.map(doc=>{const missing=this.missing(doc.id);
      return {id:doc.id,title:doc.title,route:doc.route,fields:this.fields(doc.id),missing:missing.length,sharedMissing,published:missing.length===0}})}
  save(values:LegalValues,reason:string){const clean=String(reason||'').trim();if(clean.length<3||clean.length>300)throw Object.assign(new Error('Укажите причину изменения (3–300 символов)'),{status:400});
    const next:LegalValues={};let changed=0;
    for(const field of LEGAL_FIELDS){const value=String(values[field.key]??this.values[field.key]??'').trim();if(value.length>400)throw Object.assign(new Error('Значение поля «'+field.label+'» длиннее 400 символов'),{status:400});next[field.key]=value;if(value!==String(this.values[field.key]||'').trim())changed++}
    if(changed===0)throw Object.assign(new Error('Ни одно поле не изменилось'),{status:400});
    this.values=next;this.updatedAt=new Date().toISOString();this.persist(next,clean);
    return {updatedAt:this.updatedAt,reason:clean,changed,documents:this.status(),shared:this.fields('shared')}}
  private persist(values:LegalValues,reason:string|null){writeFileSync(this.path,JSON.stringify({updatedAt:this.updatedAt,reason,values},null,2),{mode:0o600});chmodSync(this.path,0o600)}
  render(template:string,document:LegalDocumentId){const missing=this.missing(document);
    const resolve=(key:string):string=>{
      if(key==='executor.form'){const label=EXECUTOR_FORMS.find(item=>item.id===this.form())?.label||'организация';return '<span class="value">'+escape(label)+'</span>'}
      const field=this.definition(key);
      if(field&&this.automatic(field))return '<span class="value">'+escape(this.value(key))+'</span>';
      if(field&&!this.applies(field))return '<span class="na">не применяется</span>';
      const value=this.value(key);
      if(value)return '<span class="value">'+escape(value)+'</span>';
      return '<span class="todo"'+(field?' title="'+escape(field.label)+'"':'')+'>не заполнено</span>'};
    const html=String(template)
      .replace(/<span class="todo" data-legal="([a-z]+(?:\.[a-z]+)+)"[^>]*>\s*\{\{\1\}\}\s*<\/span>/g,(_match,key:string)=>resolve(key))
      .replace(/\{\{([a-z]+(?:\.[a-z]+)+)\}\}/g,(_match,key:string)=>resolve(key));
    return {html,published:missing.length===0,missing}}
  adminView(){return {updatedAt:this.updatedAt,forms:EXECUTOR_FORMS,shared:this.fields('shared'),sharedMissing:this.missingShared().length,documents:this.status()}}
  /** Страница для посетителя, пока документ не заполнен: текст документа не раскрывается. */
  unpublishedPage(title:string){return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet"><title>${escape(title)} · OpenGames</title><style>body{margin:0;background:#f7f8f5;color:#1c1f1d;font:16px/1.65 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:520px;margin:24px;background:#fff;border:1px solid #e2e6e1;border-left:3px solid #8a5a00;border-radius:12px;padding:24px}h1{font-size:1.3rem;margin:0 0 12px}p{margin:8px 0;color:#5b6560;font-size:.95rem}</style></head><body><main><h1>${escape(title)}</h1><p>Документ ещё не опубликован: реквизиты исполнителя не заполнены в панели управления.</p><p>Вернитесь позже или напишите нам — контакты указаны на странице оплаты.</p></main></body></html>`}
}