const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const tabs=['overview','games','coauthors','models','users','sessions','feedback','audit','billing','shared','oauth','legal','infrastructure'];
const adminRoute=()=>location.hash.slice(1).split('?')[0];
let tab=tabs.includes(adminRoute())?adminRoute():'overview',themeMode=localStorage.getItem('opengame-theme')||'auto';
if(['localhost','127.0.0.1','::1'].includes(location.hostname)){let notice=document.createElement('aside');notice.className='environment-warning';notice.innerHTML='Вы работаете с <b>локальной базой</b>. Изменения здесь не попадут на VDS. <a href="https://opengames.duckdns.org/admin">Открыть портал VDS</a>';document.querySelector('main').prepend(notice)}
function setTheme(){let h=new Date().getHours(),time=themeMode==='auto'?(h>=8&&h<20?'day':'night'):themeMode;document.body.dataset.time=time;$('#themeIcon').textContent=themeMode==='auto'?'A':time==='day'?'☀':'☾';$('#themeIndicator').title='Тема: '+(themeMode==='auto'?'авто':time==='day'?'день':'ночь')+' · нажмите, чтобы сменить';$('#themeIndicator').setAttribute('aria-label',$('#themeIndicator').title)}
$('#themeIndicator').onclick=()=>{themeMode=themeMode==='auto'?'day':themeMode==='day'?'night':'auto';localStorage.setItem('opengame-theme',themeMode);setTheme()};setTheme();setInterval(setTheme,60000);
async function api(path,opts={}){let r=await fetch(path,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts.body?{'X-Admin-Confirm':'confirmed'}:{}),...opts.headers}}),data=await r.json();if(!r.ok)throw Error(data.error||r.status);return data}
function page(options){const o=typeof options==='string'?{title:options,body:arguments[1],subtitle:arguments[2],actions:arguments[3]}:options;
  $('#content').innerHTML='<div class="admin-page"><header class="admin-head"><div><h1>'+esc(o.title)+'</h1>'+(o.subtitle?'<p>'+esc(o.subtitle)+'</p>':'')+'</div><div class="spacer"></div>'+(o.actions?'<div class="admin-actions">'+o.actions+'</div>':'')+'</header>'+(o.body||'')+'</div>'}
function draw(title,html,subtitle,actions){page({title,body:html,subtitle,actions})}
function loading(){draw('Загрузка','<div class="loading"><i></i><i></i><i></i></div>')}
function toast(message,kind='ok',detail=''){const host=$('#toasts')||(()=>{const node=document.createElement('div');node.id='toasts';node.className='admin-toasts';document.body.appendChild(node);return node})();
  const item=document.createElement('div');item.className='admin-toast '+kind;item.innerHTML='<div>'+(detail?'<b>'+esc(message)+'</b><span>'+esc(detail)+'</span>':'<b>'+esc(message)+'</b>')+'</div>';
  const close=()=>{item.style.opacity='0';item.style.transition='opacity .2s';setTimeout(()=>item.remove(),200)};
  item.addEventListener('click',close);host.appendChild(item);setTimeout(close,kind==='crit'?9000:5000);return item}
function dialog(options){return new Promise(resolve=>{
  const min=options.reasonMin||3;
  const node=document.createElement('dialog');node.className='admin-dialog';
  node.innerHTML='<form method="dialog"><div class="dialog-body"><h3>'+esc(options.title)+'</h3>'+(options.text?'<p>'+esc(options.text)+'</p>':'')
    +(options.reason?'<div class="field"><label>'+esc(options.reasonLabel||'Причина')+' <span class="req">*</span></label><input name="reason" placeholder="'+esc(options.placeholder||'Будет записана в журнал действий')+'" autocomplete="off"><span class="hint">не менее '+min+' символов</span></div>':'')
    +(options.number?'<div class="field"><label>'+esc(options.number.label||'Значение')+'</label><input name="number" type="number" min="'+(options.number.min??1)+'" max="'+(options.number.max??9999)+'" value="'+esc(options.number.value??10)+'"><span class="hint">от '+esc(options.number.min??1)+' до '+esc(options.number.max??9999)+'</span></div>':'')
    +'<p class="dialog-error"></p></div><div class="dialog-actions"><button value="cancel">'+esc(options.cancelLabel||'Отмена')+'</button><button value="ok" class="'+(options.danger?'danger':'primary')+'">'+esc(options.confirmLabel||'Подтвердить')+'</button></div></form>';
  const input=node.querySelector('input[name=reason]'),error=node.querySelector('.dialog-error'),ok=node.querySelector('[value=ok]');
  const number=node.querySelector('input[name=number]');
  ok.addEventListener('click',event=>{let invalid=null;
    if(options.reason&&(!input.value.trim()||input.value.trim().length<min))invalid=[input,'Укажите причину: не менее '+min+' символов'];
    if(!invalid&&options.number){const value=Number(number.value);if(!Number.isInteger(value)||value<options.number.min||value>options.number.max)invalid=[number,'Введите целое число от '+options.number.min+' до '+options.number.max]}
    if(invalid){event.preventDefault();error.textContent=invalid[1];error.classList.add('show');invalid[0].focus();return}
    error.classList.remove('show')});
  node.addEventListener('close',()=>{const reason=input?input.value.trim():'',amount=number?Number(number.value):undefined;node.remove();resolve({ok:node.returnValue==='ok',reason,amount})});
  document.body.appendChild(node);node.showModal();if(input)input.focus()})}
function pill(text,kind='info'){return '<span class="tag '+(kind||'info')+'">'+esc(text)+'</span>'}
function empty(text,sub=''){return '<div class="empty"><b>'+esc(text)+'</b>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div>'}
function statsBlock(items){return '<div class="stats">'+Object.entries(items).map(([key,value])=>{const meta=typeof value==='object'&&value!==null?value:{value};
  const kind=meta.kind?' '+meta.kind:'';return '<div class="stat'+kind+'"><span>'+esc(key)+'</span><b>'+esc(meta.value)+'</b>'+(meta.hint?'<small>'+esc(meta.hint)+'</small>':'')+'</div>'}).join('')+'</div>'}
function table(columns,rows){if(!rows.length)return empty('Пока нет данных');
  return '<div class="table-wrap"><table class="table"><thead><tr>'+columns.map(c=>'<th'+(c.num?' class="num"':'')+'>'+esc(c.title)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map((c,i)=>'<td'+(c.num?' class="num"':'')+(c.actions?' class="actions"':'')+'>'+(c.render?c.render(row,i,row):esc(row[i]??''))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}
function card(title,body,actions){return '<section class="admin-card">'+(title?'<div class="card-head"><h2>'+esc(title)+'</h2><div class="spacer"></div>'+(actions||'')+'</div>':'')+body+'</section>'}
function cardList(title,rows,actions){return card(title,rows.length?rows.join(''):empty('Пока нет данных'),actions)}
const legalComments={
  'terms.claim.review':'§ 11.1. Срок ответа на претензию. Сроки возврата 7 и 10 календарных дней указаны отдельно в § 8.4.',
  'privacy.notice':'§ 11.2. Введите число и единицу срока без «за» или «до». Например: 7 календарных дней.'
};
const legalReviewNotes='<details class="panel"><summary>Комментарии к срокам и платежам</summary><ul>'+
  '<li>Отказ от услуг возможен в любое время. В оферте указаны сроки возврата по основанию обращения и сохранено право потребителя на выбор суда. <a href="https://zpp.rospotrebnadzor.ru/news/federal/490717">Ст. 32 и разъяснение</a> · <a href="https://www.consultant.ru/document/cons_doc_LAW_305/">Закон о защите прав потребителей</a></li>'+
  '<li>Политика указывает сроки исполнения запросов субъектов и уничтожения данных. Фиксируйте дату запроса и результат исполнения. <a href="https://www.consultant.ru/document/cons_doc_LAW_61801/d3fe43a7c415353b17faab255bc0de92bea127da/">Ст. 21 152-ФЗ</a></li>'+
  '<li>ЮKassa. СБП — 3 года для запроса возврата с даты создания платежа. <a href="https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds">Правила возврата</a></li>'+
  '</ul></details>';
const feedbackStatus={open:'Открыто',answered:'Есть ответ',closed:'Закрыто'};
const feedbackKind={issue:'Проблема',rating:'Оценка'};
const requestLabels={refund_voluntary:'Возврат · отказ от услуги',refund_service:'Возврат · срок или качество',account_deletion:'Удаление аккаунта и данных'};
const feedbackLabel=ticket=>requestLabels[ticket.requestType]||feedbackKind[ticket.kind];
const feedbackQuery={status:'',kind:'',requestType:'',gameId:'',offset:0,limit:20};
const feedbackDate=value=>new Date(value).toLocaleString('ru');
async function feedbackPage(){
  const {items,nextOffset}=await api('/api/admin/feedback?'+new URLSearchParams(feedbackQuery));
  if(tab!=='feedback')return;
  const options=(values,selected)=>Object.entries(values).map(([key,label])=>'<option value="'+esc(key)+'" '+(key===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
  const filters='<form id="feedbackFilters" class="controls">'+
    '<label>Тип<select name="kind">'+options({'':'Все',...feedbackKind},feedbackQuery.kind)+'</select></label>'+
    '<label>Заявка<select name="requestType">'+options({'':'Все',...requestLabels},feedbackQuery.requestType)+'</select></label>'+
    '<label>Статус<select name="status">'+options({'':'Все',...feedbackStatus},feedbackQuery.status)+'</select></label>'+
    '<label>ID сценария<input name="gameId" maxlength="80" value="'+esc(feedbackQuery.gameId)+'"></label><button type="submit">Применить</button></form>';
  const rows=items.length?table([
    {title:'Тип',render:r=>esc(feedbackLabel(r))+(r.rating?' · '+r.rating+'/5':'')},
    {title:'Сценарий / ход',render:r=>esc(r.gameId||'—')+(r.turnIndex?' · #'+r.turnIndex:'')},
    {title:'Статус',render:r=>pill(feedbackStatus[r.status])},
    {title:'Срок',render:r=>r.deadlineDays?esc(r.deadlineDays)+' календ. дн.':'—'},
    {title:'Обновлено',render:r=>esc(feedbackDate(r.updatedAt))},
    {title:'',render:r=>'<button type="button" data-feedback-open="'+esc(r.id)+'">Открыть</button>'}
  ],items):empty('Обращений нет');
  draw('Обратная связь',filters+rows+'<div class="toolbar">'+
    (feedbackQuery.offset?'<button type="button" data-feedback-page="'+Math.max(0,feedbackQuery.offset-feedbackQuery.limit)+'">← Назад</button>':'')+
    (nextOffset!=null?'<button type="button" data-feedback-page="'+nextOffset+'">Дальше →</button>':'')+'</div>');
  const report=error=>toast(error.message,'error');
  $('#feedbackFilters').onsubmit=event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    Object.assign(feedbackQuery,Object.fromEntries(fields),{offset:0});
    feedbackPage().catch(report);
  };
  for(const button of document.querySelectorAll('[data-feedback-page]'))button.onclick=()=>{
    feedbackQuery.offset=Number(button.dataset.feedbackPage);feedbackPage().catch(report);
  };
  for(const button of document.querySelectorAll('[data-feedback-open]'))button.onclick=()=>{location.hash='#feedback?ticket='+button.dataset.feedbackOpen};
}
async function feedbackTicket(id){
  const endpoint='/api/admin/feedback/'+id, ticket=await api(endpoint);
  if(tab!=='feedback')return;
  const {context}=ticket;
  const fields=[
    ['Игрок',ticket.ownerId],['Сценарий',context.gameId],['Версия пакета',context.gameVersion],
    ['Сессия',context.sessionId],['Ход',context.turnIndex],['Режим',context.source],
    ['Платёж',context.paymentId],['Поступила',ticket.requestType?feedbackDate(ticket.createdAt):null],
    ['Срок',ticket.deadlineDays?ticket.deadlineDays+' календарных дней':null],['Модель',context.model],['Действие',context.action],['Ответ сценариста',context.narrative],['Ошибка',context.error]
  ];
  draw(feedbackLabel(ticket)+(ticket.rating?' · '+ticket.rating+'/5':''),
    '<button type="button" class="text-button" id="feedbackBack">← Все обращения</button>'+
    ' '+pill(feedbackStatus[ticket.status])+
    '<dl class="admin-feedback-context">'+fields.filter(([,value])=>value!=null).map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+
    '<div class="feedback-messages">'+ticket.messages.map(item=>'<div><strong>'+(item.author==='admin'?'Администратор':'Игрок')+'</strong> · <small>'+esc(feedbackDate(item.createdAt))+'</small><p>'+esc(item.text)+'</p></div>').join('')+'</div>'+
    (ticket.status==='closed'?'':'<form id="feedbackReply" class="feedback-form"><label>Ответ игроку<textarea name="text" rows="3" maxlength="2000" required></textarea></label><button type="submit" class="primary">Отправить</button></form>')+
    '<div class="toolbar"><button type="button" id="feedbackChangeStatus">'+(ticket.status==='closed'?'Открыть снова':'Закрыть обращение')+'</button>'+
    '<button type="button" id="feedbackExport">Скачать JSON</button></div>');
  const report=error=>toast(error.message,'error');
  const submit=async (control,method,body)=>{
    control.disabled=true;
    try{await api(endpoint,{method,body:JSON.stringify(body)});toast('Изменения сохранены');await feedbackTicket(id)}
    catch(error){report(error)}
    finally{control.disabled=false}
  };
  $('#feedbackBack').onclick=()=>{location.hash='#feedback'};
  $('#feedbackChangeStatus').onclick=event=>submit(event.currentTarget,'PUT',{status:ticket.status==='closed'?'open':'closed'});
  const reply=$('#feedbackReply');
  if(reply)reply.onsubmit=event=>{
    event.preventDefault();
    submit(reply.querySelector('button'),'POST',{text:new FormData(reply).get('text')});
  };
  $('#feedbackExport').onclick=()=>{
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob([JSON.stringify(ticket,null,2)],{type:'application/json'}));
    link.download='feedback-'+id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  };
}
async function oauthSettings(){
  const providers=await api('/api/admin/oauth');
  if(tab!=='oauth')return;
  const names={google:'Google',yandex:'Яндекс ID',vk:'VK ID'};
  draw('Вход через OAuth','<div class="oauth-admin-grid">'+providers.map(row=>
    '<form class="oauth-admin-form" data-provider="'+esc(row.provider)+'"><h2>'+esc(names[row.provider])+'</h2>'+
    '<label class="field">Адрес возврата<input readonly value="'+esc(row.redirect||'')+'"></label>'+
    '<label class="field">'+(row.provider==='vk'?'App ID':'Client ID')+'<input name="clientId" maxlength="512" value="'+esc(row.clientId)+'" autocomplete="off"></label>'+
    (row.provider==='vk'?'':'<label class="field">Client secret<input name="secret" type="password" maxlength="512" autocomplete="new-password" placeholder="'+(row.hasSecret?'Сохранён, можно оставить пустым':'Введите секрет')+'"></label>')+
    '<label><input name="enabled" type="checkbox" '+(row.enabled?'checked':'')+'> Показывать кнопку входа</label>'+
    '<button class="primary" type="submit">Сохранить</button></form>').join('')+'</div>');
  for(const form of document.querySelectorAll('.oauth-admin-form'))form.onsubmit=async event=>{
    event.preventDefault();
    const {clientId,secret,enabled}=form.elements;
    const data={clientId:clientId.value,secret:secret?.value,enabled:enabled.checked};
    for(const control of form.elements)control.disabled=true;
    try{
      const rows=await api('/api/admin/oauth/'+form.dataset.provider,{method:'PUT',body:JSON.stringify(data)});
      const saved=rows.find(row=>row.provider===form.dataset.provider);
      clientId.value=saved.clientId;
      if(secret){secret.value='';secret.placeholder=saved.hasSecret?'Сохранён, можно оставить пустым':'Введите секрет'}
      toast('Настройки входа сохранены');
    }catch(error){toast(error.message,'error')}
    finally{for(const control of form.elements)control.disabled=false}
  };
}
async function modelLimits(){
  const {models,resetAt}=await api('/api/admin/model-limits');
  if(tab!=='models')return;
  draw('Лимиты моделей',table([
    {title:'Модель',render:row=>'<b>'+esc(row.name)+'</b><br><small>'+esc(row.provider+' / '+row.model)+'</small>'},
    {title:'Запросы за сутки',render:row=>esc(row.usage?.calls??0)+(row.usage?.pending?' <small>· в работе '+esc(row.usage.pending)+'</small>':'')},
    {title:'Токены (вход / выход)',render:row=>esc(row.usage?.inputTokens??'—')+' / '+esc(row.usage?.outputTokens??'—')},
    {title:'Расход, USD',render:row=>(row.usage?.costUsd!=null?esc(row.usage.costUsd.toFixed(6)):'—')+
      (row.usage?.unpriced?' <small>· без цены '+esc(row.usage.unpriced)+'</small>':'')},
    {title:'Базовый лимит',render:row=>esc(row.baseline)},
    {title:'Запросов на игрока в сутки',render:row=>'<form class="model-limit-form" data-provider="'+esc(row.provider)+'" data-model="'+esc(row.model)+'">'+
      '<input name="limit" type="number" min="0" step="1" required aria-label="Лимит '+esc(row.name)+'" value="'+esc(row.limit)+'">'+
      '<button type="submit">Сохранить</button>'+(row.override===null?'':'<button type="submit" name="reset" formnovalidate>Сбросить</button>')+'</form>'}
  ],models),'Расход по всем игрокам. Сброс в '+new Intl.DateTimeFormat('ru',{dateStyle:'short',timeStyle:'short'}).format(resetAt)+
    '. Лимит применяется сразу с учётом использованных запросов. Ноль приостанавливает новые запросы.');
  for(const form of document.querySelectorAll('.model-limit-form'))form.onsubmit=async event=>{
    event.preventDefault();
    const limit=event.submitter?.name==='reset'?null:form.elements.limit.valueAsNumber;
    for(const control of form.elements)control.disabled=true;
    try{
      await api('/api/admin/model-limits',{method:'PUT',body:JSON.stringify({...form.dataset,limit})});
      toast('Лимит сохранён');
      if(tab==='models')await modelLimits();
    }catch(error){toast(error.message,'error');for(const control of form.elements)control.disabled=false}
  };
}
async function load(){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));try{switch(tab){case'feedback':{
  const id=new URLSearchParams(location.hash.split('?')[1]||'').get('ticket');
  if(id&&/^[0-9a-f-]{36}$/.test(id))await feedbackTicket(id);
  else await feedbackPage();
  break
}case'oauth':await oauthSettings();break;case'models':await modelLimits();break;case'overview':{let d=await api('/api/admin/overview');$('#identity').textContent='Администратор';draw('Состояние платформы','<div class="stats">'+Object.entries({Пользователи:d.users,Игры:d.games,Сессии:d.sessions,Ходы:d.turns,Провайдер:d.provider,Состояние:d.health}).map(([k,v])=>'<div class="stat"><span>'+k+'</span><b>'+esc(v)+'</b></div>').join('')+'</div><p class="muted">Обновлено: '+esc(d.updatedAt)+'</p>');break}case'games':{let [games,stats]=await Promise.all([api('/api/admin/packages'),api('/api/admin/packages/popular')]);draw('Каталог игр','<div class="toolbar"><input id="q" placeholder="Поиск по названию или ID"></div><div id="rows"></div><div id="editor" class="hidden"><p id="gameDiff" class="muted"></p><textarea id="package"></textarea><input id="reason" placeholder="Причина изменения"><button class="primary" id="save">Проверить и сохранить</button></div>');let render=()=>$('#rows').innerHTML=games.filter(g=>(g.manifest.title+' '+g.manifest.id).toLowerCase().includes($('#q').value.toLowerCase())).map(g=>{let m=stats.find(s=>s.gameId===g.manifest.id)||{};return '<div class="row"><span><b>'+esc(g.manifest.title)+'</b><br><small class="muted">'+esc(g.manifest.id)+' · '+esc(g.manifest.version)+'</small></span><span class="tag">'+(m.sessions||0)+' сессий · '+(m.turns||0)+' ходов</span><span class="tag">'+(g.published?'Опубликована':'Снята с публикации')+'</span><button data-publication="'+esc(g.manifest.id)+'">'+(g.published?'Снять с публикации':'Опубликовать')+'</button><button data-id="'+esc(g.manifest.id)+'">Редактировать</button></div>'}).join('');$('#q').oninput=render;render();$('#rows').onclick=async e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.publication){let g=games.find(x=>x.manifest.id===b.dataset.publication),answer=await dialog({title:(g.published?'Снять с публикации':'Опубликовать')+' · '+g.manifest.title,text:g.published?'Игра исчезнет из каталога для игроков.':'Игра появится в каталоге для игроков.',reason:true,reasonLabel:'Причина',confirmLabel:g.published?'Снять':'Опубликовать',danger:g.published});if(!answer.ok)return;b.disabled=true;try{await api('/api/admin/packages/'+encodeURIComponent(g.manifest.id)+'/publication',{method:'PATCH',body:JSON.stringify({published:!g.published,reason:answer.reason})});await load()}catch(x){toast(x.message,'crit');b.disabled=false}return}let id=b.dataset.id;if(!id)return;let g=games.find(x=>x.manifest.id===id);$('#rows').classList.add('hidden');$('#editor').classList.remove('hidden');$('#package').value=JSON.stringify(g.package,null,2);$('#package').oninput=()=>{try{let n=JSON.parse($('#package').value);$('#gameDiff').textContent='Версия: '+g.manifest.version+' → '+(n.manifest?.version||'ошибка')+' · '+(JSON.stringify(g.package)!==JSON.stringify(n)?'Есть изменения':'Без изменений')}catch{$('#gameDiff').textContent='JSON некорректен'}};$('#save').onclick=async()=>{try{let reason=$('#reason').value;if(!reason)throw Error('Укажите причину');await api('/api/admin/packages/'+id,{method:'PUT',body:JSON.stringify({package:JSON.parse($('#package').value),reason})});load()}catch(x){toast(x.message,'crit')}}};break}case'users':{let list=await api('/api/admin/users');draw('Пользователи','<p class="admin-hint">Поиск по email или идентификатору. Блокировка закрывает вход, начисление добавляет ходы сверх суточного лимита.</p><div class="toolbar"><input id="q" placeholder="Поиск: email или ID"></div><div id="rows"></div>');
let render=()=>{let rows=list.filter(u=>(u.email+u.id).toLowerCase().includes($('#q').value.toLowerCase()));
  $('#rows').innerHTML=table([{title:'Пользователь',render:u=>'<span class="strong">'+esc(u.email)+'</span><br><small>'+esc(u.id)+'</small>'},
    {title:'Роль',render:u=>pill(u.role==='admin'?'администратор':'игрок',u.role==='admin'?'info':'')},
    {title:'Регистрация',render:u=>'<small>'+esc(String(u.createdAt||'').slice(0,10))+'</small>'},
    {title:'Состояние',render:u=>pill(u.disabled?'заблокирован':'активен',u.disabled?'crit':'ok')},
    {title:'',actions:true,render:u=>'<button class="small" data-toggle="'+u.id+'" data-disabled="'+(!u.disabled)+'">'+(u.disabled?'Разблокировать':'Заблокировать')+'</button> <button class="small" data-limit="'+u.id+'">Начислить ходы</button>'}],rows);
  if(!rows.length)$('#rows').innerHTML=empty('Пользователи не найдены')};
$('#q').oninput=render;render();
$('#rows').onclick=async e=>{let b=e.target.closest('button');if(!b)return;
  try{if(b.dataset.toggle){await api('/api/admin/users/'+b.dataset.toggle+'/status',{method:'PATCH',body:JSON.stringify({disabled:b.dataset.disabled==='true'})});toast(b.dataset.disabled==='true'?'Пользователь заблокирован':'Пользователь разблокирован')}
  else{let answer=await dialog({title:'Начислить дополнительные ходы',text:'Игрок получит ходы сверх суточного лимита. Причина попадёт в журнал действий.',reason:true,reasonLabel:'Причина начисления',confirmLabel:'Начислить',number:{label:'Количество ходов',min:1,max:9999,value:10}});
    if(answer.ok){await api('/api/admin/users/'+b.dataset.limit+'/allowance',{method:'POST',body:JSON.stringify({allowance:answer.amount,reason:answer.reason})});toast('Ходы начислены','ok',answer.amount+' ходов')}}
  load()}catch(x){toast(x.message,'crit')}};break}case'sessions':{let page=await api('/api/admin/sessions'),list=page.items,offset=page.nextOffset,total=page.total;
  draw('Игровые сессии','<p class="admin-hint">Персональные истории партий видны администратору. Изменение сохраняется с резервной копией и требует причины.</p><div class="toolbar"><input id="q" placeholder="Поиск: ID, игра или владелец"><button id="more" type="button">Загрузить ещё · '+Math.max(0,total-offset)+'</button></div><div id="rows"></div><div id="editor" class="hidden"><div class="field"><label>Причина изменения</label><input id="reason" placeholder="Например: исправление состояния по обращению игрока"></div><textarea id="json" spellcheck="false"></textarea><div class="admin-actions"><button class="ghost" id="cancel">Отмена</button><button class="primary" id="save">Проверить и сохранить</button></div></div>');
  let render=()=>{let rows=list.filter(s=>(s.id+s.gameId+s.ownerId).toLowerCase().includes($('#q').value.toLowerCase()));
    $('#rows').innerHTML=table([{title:'Игра',render:s=>'<span class="strong">'+esc(s.gameId)+'</span>'},
      {title:'Сессия',render:s=>'<small>'+esc(s.id)+'</small>'},
      {title:'Владелец',render:s=>'<small>'+esc(s.ownerId||'без владельца')+'</small>'},
      {title:'Ходы',num:true,render:s=>String(s.turns.length)},
      {title:'',actions:true,render:s=>'<button class="small" data-id="'+s.id+'">Редактировать</button>'}],rows);
    if(!rows.length)$('#rows').innerHTML=empty('Сессии не найдены')};
  $('#q').oninput=render;render();
  $('#more').hidden=offset>=total;
  $('#more').onclick=async()=>{try{page=await api('/api/admin/sessions?offset='+offset);list.push(...page.items);offset=page.nextOffset;total=page.total;render();$('#more').hidden=offset>=total;$('#more').textContent='Загрузить ещё · '+Math.max(0,total-offset)}catch(x){toast(x.message,'crit')}};
  $('#cancel').onclick=()=>load();
  $('#rows').onclick=e=>{let id=e.target.dataset.id;if(!id)return;let item=list.find(x=>x.id===id);
    $('#rows').classList.add('hidden');$('#editor').classList.remove('hidden');$('#json').value=JSON.stringify(item,null,2);
    $('#save').onclick=async()=>{let reason=$('#reason').value.trim();if(!reason){toast('Укажите причину изменения','warn');$('#reason').focus();return}
      try{await api('/api/admin/sessions/'+id,{method:'PUT',body:JSON.stringify({session:JSON.parse($('#json').value),reason})});toast('Сессия сохранена')}catch(x){toast(x.message,'crit')}}};
  break}case'legal':{let d=await api('/api/admin/legal');let fieldsBlock=(title,fields,note)=>'<div class="panel"><h2>'+title+'</h2>'+(note?'<p class="muted">'+note+'</p>':'')+fields.filter(f=>f.applies||f.value).map(f=>'<label class="legal-field" data-key="'+esc(f.key)+'" data-applies="'+f.applies+'" data-doc="'+f.document+'"><span>'+esc(f.label)+(f.required?' <span class="req" title="обязательное поле">&nbsp;*</span>':'')+(legalComments[f.key]||f.hint?'<small class="muted">'+esc(legalComments[f.key]||f.hint)+'</small>':'')+'</span>'+(f.key==='executor.form'?'<select data-form>'+d.forms.map(x=>'<option value="'+x.id+'"'+(x.id===d.shared.find(s2=>s2.key==='executor.form').value?' selected':'')+'>'+esc(x.label)+'</option>').join('')+'</select>':'<input data-field="'+esc(f.key)+'" value="'+esc(f.value||'')+'"'+(f.applies?'':' disabled placeholder="не применяется"')+'>')+'</label>').join('')+'</div>';
let form=d.shared.find(f=>f.key==='executor.form')?.value||'';
let shared=fieldsBlock('Реквизиты исполнителя',d.shared,'Эти значения подставляются в оба документа: оферту и политику конфиденциальности. Заполняются один раз.');
let docs=d.documents.map(doc=>fieldsBlock(doc.title,doc.fields,(doc.published?'Документ опубликован.':(doc.sharedMissing?'Не заполнены общие реквизиты исполнителя.':'Не заполнено полей: '+doc.missing)))).join('');
draw('Правовые документы','<p class="muted">Реквизиты исполнителя — одна сущность для обоих документов. Пока не заполнены обязательные поля, документ отдаётся посетителям как «не опубликован». Перед первым платежом текст должен быть проверен юристом.</p>'+shared+docs+legalReviewNotes+'<div class="panel"><h2>Сохранить</h2><input id="legalReason" placeholder="Причина изменения (попадёт в журнал действий)"><button class="primary" id="legalSave">Сохранить</button></div>');
$('#legalSave').onclick=async()=>{let values={},missing=[];document.querySelectorAll('[data-field]').forEach(el=>{values[el.dataset.field]=el.value;if(el.placeholder!=='не применяется'&&!el.value.trim())missing.push(el.closest('label').querySelector('span').childNodes[0].textContent.trim())});let select=document.querySelector('[data-form]');if(select)values['executor.form']=select.value;let reason=$('#legalReason').value.trim();if(!reason){toast('Укажите причину изменения','warn');$('#legalReason').focus();return}if(missing.length){let warn=await dialog({title:'Сохранить с незаполненными полями?',text:'Не заполнены: '+missing.join(', ')+'. Пока поля пусты, документы остаются неопубликованными.',confirmLabel:'Сохранить'});if(!warn.ok)return}try{let saved=await api('/api/admin/legal',{method:'PUT',body:JSON.stringify({values,reason})});toast('Сохранено',saved.documents.some(x=>x.published)?'ok':'warn','Изменено полей: '+saved.changed+(saved.documents.some(x=>x.published)?'':' · документы ещё не опубликованы'));load()}catch(x){toast(x.message,'crit')}};
document.querySelectorAll('[data-form]').forEach(el=>el.onchange=()=>{let next={};document.querySelectorAll('[data-field]').forEach(i=>next[i.dataset.field]=i.value);next['executor.form']=el.value;api('/api/admin/legal',{method:'PUT',body:JSON.stringify({values:next,reason:'смена формы организации'})}).then(()=>load()).catch(x=>toast(x.message,'crit'))});break}case'billing':{let d=await api('/api/admin/billing'),rub=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽',t=d.totals,stats={Зачислено:rub(t.topupsRub),Бонусы:rub(t.bonusRub),'Комиссия СБП':rub(t.commissionRub),Возвраты:rub(t.refundsRub),Итого:rub(t.netRub),'На балансах игроков':rub(d.wallets.balanceRub),Кошельков:d.wallets.users,Ожидают:t.pending,Ошибки:t.failed,'Продажи генераций':rub(d.generation?.salesRub),'Себестоимость генераций':rub(d.generation?.costRub),'Расчётный остаток генераций':rub(d.generation?.estimatedContributionRub)};
const providers='<div class="oauth-admin-grid">'+d.providers.map(p=>{
  const webhook=location.origin+'/api/payments/webhook/'+p.id;
  return '<form class="oauth-admin-form" data-payment-provider="'+esc(p.id)+'"><h2>'+esc(p.label)+'</h2>'+
    '<p class="muted" data-provider-note>'+esc(p.note)+'</p>'+
    '<label class="field">URL уведомлений (POST)<input readonly value="'+esc(webhook)+'"></label>'+
    '<label class="field">ID магазина<input name="shopId" required maxlength="36" value="'+esc(p.shopId)+'"></label>'+
    '<label class="field">Секретный ключ<input name="apiKey" type="password" maxlength="512" autocomplete="new-password" placeholder="'+(p.hasApiKey?'Сохранён':'Введите ключ')+'"></label>'+
    '<button type="submit" class="primary">Сохранить</button></form>';
}).join('')+'</div>';
const generation=d.generation,precise=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:6})+' ₽';
const generationRows=generation?.records?.map(row=>'<div class="row"><span><b>'+esc(row.provider)+' · '+esc(row.model)+'</b><br><small class="muted">'+esc(new Date(row.at).toLocaleString('ru-RU'))+' · '+esc(row.userId)+' · '+row.promptTokens+' / '+row.completionTokens+' токенов</small></span><span>Себестоимость '+precise(row.costRub)+'</span><span>Списано '+precise(row.amountRub)+' · ×'+row.multiplier+'</span></div>').join('')||'<p class="muted">Платных генераций пока нет.</p>';
let packs=d.byPack.map(p=>'<div class="row"><span><b>'+p.amountRub+' ₽'+(p.bonusRub?' + бонус '+p.bonusRub+' ₽':'')+'</b></span><span class="tag">'+p.count+' платежей · '+rub(p.amountRub)+'</span></div>').join('');
let tag=s=>s==='succeeded'?'оплачен':s==='refunded'?'возвращён':s==='failed'?'ошибка':'ожидает оплаты';
let records=d.records.map(p=>'<div class="row"><span><b>'+rub(p.amountRub+p.bonusRub)+'</b><br><small class="muted">'+new Date(p.createdAt).toISOString().slice(0,16).replace('T',' ')+' · '+esc(p.provider)+' · '+esc(p.packId)+' · '+esc(p.id.slice(0,8))+'</small></span><span class="tag">'+tag(p.status)+'</span>'+(p.status==='succeeded'&&p.provider==='yookassa'?'<button class="danger" data-refund="'+p.id+'" data-amount="'+p.amountRub+'">Возврат</button>':'')+'</div>').join('')||'<p class="muted">Платежей пока нет.</p>';
draw('Платежи и возвраты','<div class="stats">'+Object.entries(stats).map(([k,v])=>'<div class="stat"><span>'+k+'</span><b>'+esc(v)+'</b></div>').join('')+'</div><h2>Провайдеры</h2>'+providers+'<h2>Пакеты пополнения</h2>'+packs+'<h2>Реестр платежей</h2>'+records+'<h2>Расходы на генерации</h2><p class="muted">Стоимость провайдера ×2. Расчётный остаток учитывает комиссию 3,5% и НПД 4%. Налоги и комиссия при пополнении не начисляются повторно при списании внутреннего баланса.</p>'+generationRows);
for(const form of document.querySelectorAll('[data-payment-provider]'))form.onsubmit=async event=>{
  event.preventDefault();
  const fields=form.elements, data={shopId:fields.shopId.value,apiKey:fields.apiKey.value};
  for(const input of fields)input.disabled=true;
  try{
    const saved=await api('/api/admin/billing/providers/'+form.dataset.paymentProvider,{method:'PUT',body:JSON.stringify(data)});
    fields.shopId.value=saved.shopId;
    for(const field of [fields.apiKey])if(field){field.value='';field.placeholder='Сохранён'}
    form.querySelector('[data-provider-note]').textContent=saved.note;
    toast('Реквизиты сохранены');
  }catch(error){toast(error.message,'error')}
  finally{for(const input of fields)input.disabled=false}
};
$('#content').onclick=async e=>{let b=e.target.closest('[data-refund]');if(!b)return;let answer=await dialog({title:'Возврат '+rub(b.dataset.amount),text:'Средства вернутся на исходный способ оплаты. Действие необратимо.',reason:true,reasonLabel:'Причина возврата',confirmLabel:'Вернуть',danger:true});if(!answer.ok)return;try{await api('/api/admin/billing/'+b.dataset.refund+'/refund',{method:'POST',body:JSON.stringify({reason:answer.reason})});load()}catch(x){toast(x.message,'crit')}};break}case'shared':{
const endpoint='/api/admin/shared-keys',d=await api(endpoint);
const routes=d.routes.filter(route=>route.keyUrl);
const money=(amount,currency)=>Number(amount).toLocaleString('ru-RU',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2});
const balanceText=b=>b?.available
  ?'Доступно на расходы: '+money(b.remaining,b.currency)+(b.monthlyRemaining==null?'':' · Остаток месячного лимита: '+money(b.monthlyRemaining,b.currency))
  :b?.message||'Остаток ещё не проверен';
const options=(models,selected)=>'<option value="">Выберите модель</option>'+models.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===selected?' selected':'')+'>'+esc(m.name===m.id?m.id:m.name+' · '+m.id)+'</option>').join('');
const mountModelPicker=(host,catalog,selected,onChange)=>{
  const chosen=new Set(selected),known=new Set(catalog.map(item=>item.id));
  for(const id of chosen)if(!known.has(id))catalog.push({id,name:id});
  host.innerHTML='<label class="model-search-label">Поиск моделей<input type="search" data-model-search placeholder="Название или ID модели" autocomplete="off"></label><div class="model-picker-actions"><button type="button" data-model-visible>Выбрать найденные</button><button type="button" data-model-clear>Снять выбор</button><span data-model-count role="status"></span></div><div class="model-picker-list"></div>';
  const search=host.querySelector('[data-model-search]'),list=host.querySelector('.model-picker-list'),count=host.querySelector('[data-model-count]');
  const filtered=()=>catalog.filter(item=>(item.name+' '+item.id).toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
  const sync=()=>{count.textContent='Выбрано: '+chosen.size+' / 50';onChange(catalog.filter(item=>chosen.has(item.id)))};
  const render=()=>{
    const matches=filtered();
    list.innerHTML=matches.length?matches.map(item=>'<label class="model-picker-option"><input type="checkbox" value="'+esc(item.id)+'"'+(chosen.has(item.id)?' checked':'')+'><span>'+esc(item.name)+'<small>'+esc(item.id)+'</small></span></label>').join(''):'<p class="muted">Модели не найдены</p>';
  };
  search.oninput=render;
  list.onchange=e=>{
    const box=e.target.closest('input[type="checkbox"]');if(!box)return;
    if(box.checked&&chosen.size>=50){box.checked=false;toast('Можно подключить до 50 моделей','warn');return}
    if(box.checked)chosen.add(box.value);else chosen.delete(box.value);
    sync();
  };
  host.querySelector('[data-model-visible]').onclick=()=>{for(const item of filtered()){if(chosen.size>=50)break;chosen.add(item.id)}render();sync()};
  host.querySelector('[data-model-clear]').onclick=()=>{chosen.clear();render();sync()};
  render();sync();
  return ()=>[...chosen];
};
const keys=d.keys.map(k=>{
  const route=d.routes.find(r=>r.route===k.route);
  return '<div class="row"><span><b>'+esc(k.label)+'</b> <span class="tag">'+esc(route?.label||k.route)+'</span><br><small class="muted">'+esc(k.model)+' (основная) · '+esc(k.keyMask)+'<br>Модели: '+esc((k.models||[k.model]).join(', '))+(k.note?'<br>'+esc(k.note):'')+'<br>'+esc(balanceText(k.balance))+(k.balance?' · '+esc(new Date(k.balance.checkedAt).toLocaleString('ru-RU')):'')+'</small></span><span class="tag">'+(k.status==='active'?'активен':'приостановлен')+'</span>'+(route?.keyUrl?'<button data-check="'+k.id+'">Обновить остаток</button><button data-model="'+k.id+'">Настроить модели</button>':'')+'<button data-toggle="'+k.id+'" data-status="'+k.status+'">'+(k.status==='active'?'Приостановить':'Активировать')+'</button><button class="danger" data-remove="'+k.id+'">Удалить</button></div>';
}).join('')||'<p class="muted">Общих ключей пока нет.</p>';
draw('Общий ключ OpenGames','<p class="muted">Автоматическое переключение между активными провайдерами. Администраторы получают письма при остатке 20%, 10% и 0 от наблюдавшегося максимума. Проверка каждые 5 минут.</p><h2>Добавить ключ</h2><form id="skForm"><div class="form-grid"><div class="field"><label for="skLabel">Название ключа</label><input id="skLabel" required maxlength="60"></div><div class="field"><label for="skRoute">Провайдер</label><select id="skRoute">'+routes.map(r=>'<option value="'+esc(r.route)+'">'+esc(r.label)+'</option>').join('')+'</select></div><div class="field"><label for="skKey">API-ключ провайдера</label><input id="skKey" type="password" autocomplete="new-password" minlength="16" maxlength="1024" required><button type="button" id="skInspect">Загрузить модели</button></div><div class="field"><label for="skModel">Основная модель</label><select id="skModel" required disabled></select><p id="skBalance" class="hint" role="status" aria-live="polite"></p></div><div class="field"><label for="skNote">Заметка</label><input id="skNote" maxlength="300"></div></div><section id="skModels" class="model-picker" hidden aria-label="Подключаемые модели"></section><div class="shared-status"><p id="skGuide" class="hint"></p></div><details class="shared-guide" open><summary>Как подключить провайдера</summary><div id="skInstructions"></div></details><div class="admin-actions"><button class="primary" id="skAdd">Добавить общий ключ</button></div></form><h2>Зарегистрированные ключи</h2>'+keys);
const form=$('#skForm'),route=$('#skRoute'),key=$('#skKey'),model=$('#skModel'),balance=$('#skBalance'),inspect=$('#skInspect'),add=$('#skAdd');
let inspection=0,selectedModels=()=>[];
const instructions={
  direct:['Откройте DeepSeek Platform и войдите в аккаунт.','В разделе API keys создайте ключ для OpenGames и скопируйте его.','Проверьте баланс в кабинете DeepSeek. Остаток отображается в валюте провайдера.'],
  aitunnel:['Войдите в AITUNNEL и пополните баланс.','В панели управления откройте «Ключи», создайте ключ для OpenGames и скопируйте его.','При необходимости настройте бюджет ключа и список разрешённых моделей.'],
  provod:['Войдите в PROVOD и выберите нужное рабочее пространство.','Создайте обычный API-ключ для генерации в разделе ключей.','Проверьте баланс выбранного пространства и ограничения расходов ключа.'],
  polza:['Войдите в консоль Polza и выберите организацию.','Откройте API-ключи, создайте ключ для OpenGames и скопируйте его.','Проверьте баланс организации и ограничения расходов ключа.'],
  openrouter:['Войдите в OpenRouter и откройте Settings → API Keys.','Создайте обычный API-ключ для OpenGames и скопируйте его.','Пополните баланс. Чтобы видеть остаток месячного лимита, задайте ключу бюджет с ежемесячным сбросом.']
};
const renderGuide=()=>{
  const provider=routes.find(r=>r.route===route.value);
  $('#skGuide').textContent='';
  $('#skInstructions').innerHTML='<h3>'+esc(provider.label)+'</h3><ol>'+
    (instructions[route.value]||[provider.guide]).concat(['Вставьте ключ в поле «API-ключ провайдера» и нажмите «Загрузить модели».','Отметьте нужные модели, выберите основную, задайте название и нажмите «Добавить общий ключ».']).map(step=>'<li>'+esc(step)+'</li>').join('')+
    '</ol><a href="'+esc(provider.keyUrl)+'" target="_blank" rel="noopener noreferrer">Открыть '+esc(provider.label)+' ↗</a>';
};
const clear=()=>{
  inspection++;
  model.innerHTML=options([]);model.disabled=true;balance.textContent='';$('#skModels').hidden=true;$('#skModels').replaceChildren();selectedModels=()=>[];
};
route.onchange=()=>{key.value='';clear();renderGuide()};key.oninput=clear;clear();renderGuide();
inspect.onclick=async()=>{
  if(!key.reportValidity())return;
  const request=++inspection;
  inspect.disabled=true;
  balance.textContent='Запрашиваем каталог и остаток…';
  try{
    const result=await api(endpoint+'/inspect',{method:'POST',body:JSON.stringify({route:route.value,key:key.value})});
    if(request!==inspection||!form.isConnected)return;
    const host=$('#skModels');host.hidden=false;
    selectedModels=mountModelPicker(host,result.models,[],chosen=>{
      const previous=model.value;
      model.innerHTML=options(chosen,previous);
      if(!chosen.some(item=>item.id===previous)&&chosen.length)model.value=chosen[0].id;
      model.disabled=!chosen.length;
    });
    balance.textContent=balanceText(result.balance);
  }catch(x){if(request===inspection&&form.isConnected)balance.textContent=x.message}
  finally{inspect.disabled=false}
};
form.onsubmit=async e=>{
  e.preventDefault();
  if(model.disabled||!model.value){
    balance.textContent=$('#skModels').hidden?'Сначала загрузите модели провайдера.':'Отметьте модели и выберите основную.';
    (model.disabled?inspect:model).focus();
    return;
  }
  add.disabled=true;add.textContent='Добавляем…';
  try{await api(endpoint,{method:'POST',body:JSON.stringify({label:$('#skLabel').value,route:route.value,model:model.value,models:selectedModels(),key:key.value,note:$('#skNote').value})});load()}
  catch(x){toast(x.message,'crit');balance.textContent=x.message;add.disabled=false;add.textContent='Добавить общий ключ'}
};
$('#content').onclick=async e=>{
  const b=e.target.closest('button[data-check],button[data-model],button[data-save-model],button[data-toggle],button[data-remove]');
  if(!b||b.disabled)return;
  b.disabled=true;
  try{
    if(b.dataset.check){
      const result=await api(endpoint+'/'+b.dataset.check+'/balance',{method:'POST',body:'{}'});
      toast('Остаток обновлён',result.balance?.available?'ok':'warn',balanceText(result.balance));load();return;
    }
    if(b.dataset.model){
      const current=d.keys.find(k=>k.id===b.dataset.model);
      const result=await api(endpoint+'/'+current.id+'/models',{method:'POST',body:'{}'});
      const selected=current.models||[current.model];
      const editor=document.createElement('div');editor.className='shared-model-editor';
      editor.innerHTML='<div class="model-picker"></div><label>Основная модель<select data-model-select></select></label><button type="button" data-save-model="'+current.id+'">Сохранить модели</button>';
      b.replaceWith(editor);
      const primary=editor.querySelector('[data-model-select]');
      primary.innerHTML=options(result.models,current.model);
      editor.getSelectedModels=mountModelPicker(editor.querySelector('.model-picker'),result.models,selected,chosen=>{
        const previous=primary.value;
        primary.innerHTML=options(chosen,previous);
        if(!chosen.some(item=>item.id===previous)&&chosen.length)primary.value=chosen[0].id;
      });
      return;
    }
    if(b.dataset.saveModel){
      const editor=b.closest('.shared-model-editor'),selected=editor.querySelector('[data-model-select]').value,models=editor.getSelectedModels();
      if(!selected||!models.includes(selected)){toast('Включите основную модель в список подключённых','warn');return}
      await api(endpoint+'/'+b.dataset.saveModel,{method:'PATCH',body:JSON.stringify({model:selected,models})});load();return;
    }
    if(b.dataset.toggle){
      await api(endpoint+'/'+b.dataset.toggle,{method:'PATCH',body:JSON.stringify({status:b.dataset.status==='active'?'paused':'active'})});load();return;
    }
    const answer=await dialog({title:'Удалить общий ключ',reason:true,reasonLabel:'Причина удаления',confirmLabel:'Удалить',danger:true});
    if(answer.ok){await api(endpoint+'/'+b.dataset.remove,{method:'DELETE',body:JSON.stringify({reason:answer.reason})});load()}
  }catch(x){toast(x.message,'crit')}
  finally{b.disabled=false}
};
break}
case'infrastructure':{let d=await api('/api/admin/infrastructure'),bad=d.checks.filter(c=>c.status!=='ok'),crit=bad.filter(c=>c.status==='crit'),verdict=crit.length?'crit':bad.length?'warn':'ok';
let tagOf=c=>c.status==='ok'?'ok':c.status==='warn'?'warn':c.status==='crit'?'danger':'';
let checkRow=c=>'<div class="row"><span><b>'+esc(c.label)+'</b><br><small class="muted">'+esc(c.detail)+(c.fix?'<br><small class="muted">'+esc(c.fix)+'</small>':'')+'</small></span><span class="tag '+tagOf(c)+'">'+esc(c.value)+'</span></div>';
let h=d.host,mem=h.memory,cards={Загрузка:h.load.join(' / '),Ядра:String(h.cores),Аптайм:Math.round(h.uptimeSeconds/86400)+' дн.',Память:mem.usedPercent+'%','Память, доступно':mem.availableMb+' МБ',Диск:d.disk.usedPercent+'%'};
cards['Диск, свободно']=d.disk.freeMb+' МБ';cards['RSS процесса']=h.process.rssMb?h.process.rssMb+' МБ':'—';cards['Релизы']=String(d.storage.releases)+' · '+d.storage.releasesMb+' МБ';cards['Данные']=d.storage.dataFiles+' файлов · '+d.storage.dataMb+' МБ';cards['Игры']=String(d.app.games);cards['Сценарист']=d.app.donorConnected?'подключён':'нет соавторов';
draw('Инфраструктура VDS','<div class="panel"><h2>Состояние: '+esc(verdict==='ok'?'всё в норме':verdict==='warn'?'есть замечания: '+bad.length:'критично: '+crit.length)+'</h2><p class="muted">Собрано '+esc(d.collectedAt.replace('T',' ').slice(0,19))+' · узел '+esc(h.hostname)+' · Node '+esc(h.node)+' · PID '+String(h.process.pid)+'</p><div class="stats">'+Object.entries(cards).map(([k,v])=>'<div class="stat"><span>'+k+'</span><b>'+esc(String(v))+'</b></div>').join('')+'</div></div><div class="panel"><h2>Проверки</h2>'+d.checks.map(checkRow).join('')+'</div><div class="panel"><h2>Действия</h2><p class="muted">Перезапуск и откат выполняются вручную по SSH: приложение не может перезапустить себя или переключить рабочий каталог без разрыва соединения.</p><div class="toolbar"><button data-op="health" class="primary">Проверить сейчас</button><button data-op="logs">Журнал systemd</button></div><div id="opOut" class="muted"></div></div><div class="panel"><h2>Ограничения сбора</h2><ul>'+d.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+d.blocked.map(x=>'<li>'+esc(x.operation)+': '+esc(x.reason)+'</li>').join('')+'</ul></div>');
$('#content').onclick=async e=>{let b=e.target.closest('[data-op]');if(!b)return;b.disabled=true;let out=b.dataset.op==='health'?await api('/api/admin/infrastructure/operation',{method:'POST',body:JSON.stringify({operation:'health'})}):null;
 if(b.dataset.op==='logs'){let r=await api('/api/admin/infrastructure/operation',{method:'POST',body:JSON.stringify({operation:'logs'})});$('#opOut').textContent=(r.ok?'':'журнал недоступен: ')+String(r.output||'').slice(0,4000);b.disabled=false;return}
 $('#opOut').textContent=out.ok?'Все проверки в норме':'Замечания: '+out.alerts.map(a=>a.key+' — '+a.value+' ('+a.status+')').join('; ');b.disabled=false};break}case'coauthors':{let d=await api('/api/admin/coauthors?days=30'),s=d.summary,fmt=n=>n==null?'—':n<1000?Math.round(n)+' мс':(n/1000).toFixed(1)+' с',tok=n=>n==null?'—':Math.round(n)+' ток',cards={Обращения:s.calls,Ответы:s.responded,Ошибки:s.failed,'Доля ответов':s.responseRate+'%','Медиана ответа':fmt(s.medianLatencyMs),'Промпт в среднем':tok(s.avgPromptTokens),'Ответ в среднем':tok(s.avgCompletionTokens),'Всего токенов':(s.totalPromptTokens||0)+(s.totalCompletionTokens||0),'Активные соавторы':s.coauthors};draw('Обращения к соавторам · 30 дней','<div class="stats">'+Object.entries(cards).map(([k,v])=>'<div class="stat"><span>'+k+'</span><b>'+esc(v)+'</b></div>').join('')+'</div><p class="muted">Записываются только метаданные вызовов; содержание запросов и ответов не сохраняется. История ведётся с момента включения учёта.</p><h3>По соавторам</h3><div>'+((d.byCoauthor||[]).map(x=>'<div class="row"><span><b>'+esc(x.name)+'</b><br><small>'+esc(x.model)+' · '+esc(x.id)+'</small></span><span class="tag">'+x.calls+' обращ. · '+x.responseRate+'% ответов · '+fmt(x.medianLatencyMs)+' · промпт '+tok(x.avgPromptTokens)+' · ответ '+tok(x.avgCompletionTokens)+'</span></div>').join('')||'<p class="muted">Обращений пока нет.</p>')+'</div><h3>По играм</h3><div>'+((d.byGame||[]).map(x=>'<div class="row"><span>'+esc(x.gameId)+'</span><span class="tag">'+x.calls+' обращ. · '+x.responseRate+'% ответов</span></div>').join('')||'<p class="muted">Нет данных за выбранный период.</p>')+'</div><h3>Динамика по дням</h3><div>'+((d.daily||[]).slice(-14).reverse().map(x=>'<div class="row"><span>'+esc(x.date)+'</span><span class="tag">'+x.calls+' обращ. · '+x.responded+' ответов · '+x.failed+' ошибок</span></div>').join('')||'<p class="muted">Динамика появится после первых обращений.</p>')+'</div>');break}case'audit':{let rows=await api('/api/admin/audit');
  draw('Журнал административных действий','<p class="admin-hint">Каждое изменение данных, реквизитов и ключей фиксируется здесь.</p>'+table([
    {title:'Время',render:x=>'<small>'+esc(String(x.at||'').replace('T',' ').slice(0,19))+'</small>'},
    {title:'Действие',render:x=>'<span class="strong">'+esc(x.action)+'</span>'},
    {title:'Кто',render:x=>esc(x.actor||'—')},
    {title:'Объект',render:x=>'<small>'+esc(String(x.target||'—').slice(0,40))+'</small>'},
    {title:'Детали',render:x=>'<small>'+esc(JSON.stringify(x.details||{})).slice(0,160)+'</small>'}],rows));break}}}catch(e){draw('Нет доступа','<p class="danger">'+esc(e.message)+'</p>')}}
addEventListener('hashchange',()=>{const next=adminRoute();if(tabs.includes(next)){tab=next;load()}});
$('#nav').onclick=e=>{const target=e.target.closest('[data-tab]');if(!target)return;if(target.dataset.tab===tab)return;location.hash='#'+target.dataset.tab};
load();
