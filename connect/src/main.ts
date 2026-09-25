import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './style.css';

type Status={linked:boolean;deviceName?:string;computerName:string;modelReady:boolean;donating:boolean;starting:boolean;busy:boolean;modelSizeGb:number;modelLicense:string;modelSource:string};
const app=document.querySelector<HTMLElement>('#app')!;
let pairingTimer:number|undefined;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const message=(value:string)=>{const node=document.querySelector<HTMLElement>('#message');if(node)node.textContent=value};

async function render(){
  const consent=document.querySelector<HTMLInputElement>('#consent')?.checked===true;
  const state=await invoke<Status>('status');
  app.innerHTML=`<header><span class="mark">✦</span><div><h1>OpenGames Connect</h1><p>Ваш компьютер помогает создавать ходы для игроков</p></div></header>
  <section class="card"><div class="row"><h2>Устройство</h2><span class="badge ${state.linked?'ok':''}">${state.linked?'Привязано':'Не привязано'}</span></div>
  ${state.linked?`<p>${esc(state.deviceName||state.computerName)}</p><button id="unlink" class="quiet">Отозвать доступ и отключить</button>`:`<p>Имя компьютера: ${esc(state.computerName)}</p><button id="pair">Получить код привязки</button><div id="pairing"></div>`}</section>
  <section class="card"><div class="row"><h2>Локальная модель</h2><span class="badge ${state.modelReady?'ok':''}">${state.modelReady?'Загружена':'Не загружена'}</span></div><p>Qwen3-8B · Q4_K_M · ${state.modelSizeGb} ГБ · ${esc(state.modelLicense)}</p><small>Источник: ${esc(state.modelSource)}. Текст игровых ходов обрабатывается на вашем компьютере.</small><div class="actions">${state.modelReady?'<button id="deleteModel" class="quiet">Удалить модель</button>':'<button id="downloadModel">Скачать модель</button>'}</div><progress id="progress" max="5030000000" value="0" hidden></progress></section>
  <section class="card"><div class="row"><h2>Соавторство</h2><span class="badge ${state.donating?'ok':''}">${state.donating?(state.busy?'Выполняется ход':'В сети'):state.starting?'Запускается':'Остановлено'}</span></div><p>До одного задания одновременно. Используется исходящее защищённое соединение; входящий порт в сеть не открывается.</p>${state.donating?'<button id="pause">Пауза</button>':`<label class="check"><input id="consent" type="checkbox" ${consent?'checked':''}> Я разрешаю использовать ресурсы этого компьютера для ходов игроков</label><button id="start" ${!state.linked||!state.modelReady||state.starting?'disabled':''}>${state.starting?'Запуск модели…':'Стать соавтором'}</button>`}</section><p id="message" role="status"></p>`;
  document.querySelector<HTMLButtonElement>('#pair')?.addEventListener('click',pair);
  document.querySelector<HTMLButtonElement>('#downloadModel')?.addEventListener('click',download);
  document.querySelector<HTMLButtonElement>('#start')?.addEventListener('click',async()=>{const button=document.querySelector<HTMLButtonElement>('#start')!;button.disabled=true;try{await invoke('start_donating',{consent:document.querySelector<HTMLInputElement>('#consent')?.checked===true});await render()}catch(e){button.disabled=false;message(String(e))}});
  document.querySelector<HTMLButtonElement>('#pause')?.addEventListener('click',async()=>{await invoke('pause');await render()});
  document.querySelector<HTMLButtonElement>('#unlink')?.addEventListener('click',async()=>{try{await invoke('unlink');await render()}catch(e){message(String(e))}});
  document.querySelector<HTMLButtonElement>('#deleteModel')?.addEventListener('click',async()=>{try{await invoke('delete_model');await render()}catch(e){message(String(e))}});
}

async function pair(){
  try{
    const result=await invoke<{userCode:string;verificationUrl:string}>('begin_pairing');
    document.querySelector<HTMLElement>('#pairing')!.innerHTML=`<p>Подтвердите устройство в профиле OpenGames:</p><strong class="pair-code">${esc(result.userCode)}</strong><p class="url">${esc(result.verificationUrl)}</p><button id="openVerification" type="button">Открыть ссылку с кодом</button><small>Проверьте имя компьютера перед подтверждением. Код действует 10 минут.</small>`;
    document.querySelector<HTMLButtonElement>('#openVerification')!.addEventListener('click',()=>invoke('open_verification').catch(e=>message(String(e))));
    if(pairingTimer)clearInterval(pairingTimer);
    pairingTimer=window.setInterval(async()=>{try{const result=await invoke<string>('poll_pairing');if(result==='approved'){clearInterval(pairingTimer);pairingTimer=undefined;await render()}else if(result==='slow_down')message('Ожидание подтверждения…')}catch(e){clearInterval(pairingTimer);pairingTimer=undefined;message(String(e))}},5000);
  }catch(e){message(String(e))}
}

async function download(){const button=document.querySelector<HTMLButtonElement>('#downloadModel')!;button.disabled=true;const progress=document.querySelector<HTMLProgressElement>('#progress')!;progress.hidden=false;message('Загрузка модели…');try{await invoke('download_model');await render()}catch(e){message(String(e));button.disabled=false}}
listen<number>('model-progress',event=>{const progress=document.querySelector<HTMLProgressElement>('#progress');if(progress){progress.value=event.payload;message(`Загружено ${(event.payload/1_000_000_000).toFixed(2)} ГБ`)}});
render().catch(e=>{app.textContent=String(e)});
window.setInterval(()=>{if(!pairingTimer)render().catch(()=>{})},15000);
