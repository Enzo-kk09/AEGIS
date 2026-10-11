'use strict';

(() => {
  const shared = globalThis.AegisShared;
  if (!shared) {
    const target=document.querySelector('.app-loading p') || document.querySelector('#app p');
    if(target){target.textContent='Não foi possível carregar a aplicação. Atualize a página para tentar novamente.';target.setAttribute('role','alert');}
    console.error('AEGIS: módulo compartilhado indisponível.');
    return;
  }
  const { images,imageSource,STORAGE_KEY,SESSION_KEY,icon,esc,normalize,copy,uid,now,time,dateTime,today,dateLabel,initials,validImage,defaultState,brand,demoBadge,badge,photoMarkup,avatar,empty,head,publicHeader,pageFiles,pageHref,pages,sideLinks,cameras } = shared;
  const favicon = document.getElementById('site-icon');
  if (favicon) { favicon.type = 'image/png'; favicon.href = images['./assets/aegis-logo.png']; }
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');
  const loaded = shared.loadState(()=>localStorage);
  let storageProblem = loaded.problem;
  let state = loaded.state;
  let storedSnapshot = loaded.serialized;
  let session = shared.readSession(()=>sessionStorage);
  const route = 'movement';
  let filters = {camera:'all',period:'today',status:'all',studentQuery:'',className:'all',studentStatus:'all',movementQuery:'',movementDate:today(),letter:'all'};
  let prbUnlocked = false;
  let lastProtocol = state.requests.at(-1)?.protocol || null;
  let passwordVisible = false;
  let menuOpen = false;
  let previousFocus = null;
  let toastTimers = new Set();

  function toast(message, error=false) {
    const item = document.createElement('div');
    item.className = `toast ${error ? 'error' : ''}`;
    item.setAttribute('role',error ? 'alert' : 'status');
    item.innerHTML = `${icon(error?'alert':'checkcircle')}<span>${esc(message)}</span><button type="button" aria-label="Fechar aviso">${icon('close')}</button>`;
    document.getElementById('toasts').append(item);
    item.querySelector('button').addEventListener('click',()=>{clearTimeout(timer);toastTimers.delete(timer);item.remove();});
    const timer = setTimeout(()=>{item.remove();toastTimers.delete(timer);},6000);
    toastTimers.add(timer);
  }
  function persist(next) {
    try {
      const saved=shared.saveState(()=>localStorage,next,storedSnapshot);
      storedSnapshot=saved.serialized;state=saved.state;storageProblem=false;return true;
    } catch(error) {
      if(['StateConflictError','StateRecoveryError'].includes(error.name)){toast(error.message,true);return false;}
      console.warn('AEGIS: falha ao salvar dados locais.');
      toast('Não foi possível salvar no navegador. Verifique o espaço disponível e a permissão de armazenamento.',true);
      return false;
    }
  }
  function audit(next,action) { next.audit.unshift({id:uid(),user:session?.institution || 'Visitante',action,at:now()}); next.audit=next.audit.slice(0,100); }
  const eventDescription = text => text === 'As configurações demonstrativas foram salvas.' ? 'As configurações foram salvas.' : text;
  function addEvent(next,title,description,type='info') { next.events.unshift({id:uid(),title,description,type,at:now()}); next.events=next.events.slice(0,100); }
  function setError(form,message) { const target=form.querySelector('.form-error'); target.textContent=message; target.setAttribute('role','alert'); }
  const tabs = () => shared.tabs(route);
  const pageParams = new URLSearchParams(location.search);
  filters.studentQuery = (pageParams.get('q') || '').slice(0, 100);
  filters.camera = pageParams.get('camera') || 'all';
  const movements = [
    {
        "id": "m0",
        "studentId": null,
        "name": "Pessoa não reconhecida",
        "photo": "./assets/desconhecido.png",
        "entry": "12:55",
        "exit": "17:13",
        "status": "unknown"
    },
    {
        "id": "m1",
        "studentId": "s4",
        "entry": "12:42",
        "exit": "17:13",
        "status": "confirmed"
    },
    {
        "id": "m2",
        "studentId": "s5",
        "entry": "13:51",
        "exit": "17:13",
        "status": "confirmed"
    },
    {
        "id": "m3",
        "studentId": "s6",
        "entry": "12:48",
        "exit": "17:13",
        "status": "confirmed"
    }
];
  function openModal(title,content) {
    if(!modal.open)previousFocus=document.activeElement;
    modal.innerHTML=`<header class="modal-head">
        <h2 id="modal-title">${esc(title)}</h2>
        <button class="icon-button" type="button" data-action="close-modal" aria-label="Fechar janela">${icon('close')}</button>
      </header>
      <div class="modal-body">${content}</div>`;
    modal.showModal();
  }

  function setMenu(open) {
    menuOpen=open;
    document.querySelector('.sidebar')?.classList.toggle('open',open);
    document.querySelector('.sidebar-scrim')?.classList.toggle('visible',open);
    document.querySelector('.mobile-menu')?.setAttribute('aria-expanded',String(open));
    document.querySelector(open?'.sidebar .nav-item':'.mobile-menu')?.focus();
  }

  function closeModal(){if(modal.open)modal.close();previousFocus?.isConnected&&previousFocus.focus();}

  function renderShell(content) {
    return shared.renderShell({route, menuOpen, state, session, filters, storageProblem, content});
  }

  function renderMovement() {
    const query=normalize(filters.movementQuery);
    const list=movements.map(m=>({...m,student:state.students.find(s=>s.id===m.studentId)})).filter(m=>(!m.studentId||m.student)&&(!query||normalize(m.student?.name||m.name).includes(query)||normalize(m.student?.enrollment||'').includes(query))&&(filters.letter==='all'||normalize(m.student?.name||m.name).startsWith(filters.letter.toLowerCase()))&&(filters.movementDate===today()));
    return `${head('Movimentação dos alunos',pages.movement[1],`<span class="badge">${icon('calendar')}${dateLabel(filters.movementDate)}</span>`)}${tabs()}<div class="toolbar">
        <input type="date" class="input date-input" id="movement-date" aria-label="Data da movimentação" value="${filters.movementDate}" max="${today()}">
        <form id="movement-search" class="search-input" role="search" aria-label="Busca de movimentação">${icon('search')}<input class="input" name="query" type="search" placeholder="Buscar aluno ou matrícula…" aria-label="Buscar movimentação de aluno" value="${esc(filters.movementQuery)}" maxlength="100">
        </form>
        <button class="btn small grow" data-action="movement-filters">${icon('filter')}Limpar filtros</button>
      </div>
      <div class="alphabet-filter" role="group" aria-label="Filtrar por letra inicial">
        <span>Nome:</span>${['all','A','B','C','G','J','L','P','R'].map(l=>`<button type="button" data-action="letter" data-value="${l}" class="${filters.letter===l?'active':''}" aria-pressed="${filters.letter===l}">${l==='all'?'Todos':l}</button>`).join('')}</div>${list.length?`<section class="movement-grid" aria-label="Registros de movimentação">${list.map(m=>{const s=m.student;const photo=validImage(s?.photo)?s.photo:validImage(m.photo)?m.photo:'';return `<article class="panel movement-card" aria-labelledby="movement-title-${m.id}">${photoMarkup(photo,`Foto de ${s?.name||m.name}`,'movement-photo')}<div class="movement-info">
            <h2 id="movement-title-${m.id}">${esc(s?.name||m.name)}</h2>${badge(m.status)}<div class="movement-meta">
              <span>Matrícula: ${esc(s?.enrollment||'Não disponível')}</span>${s?`<span>${esc(s.className)}</span>`:''}</div>
            <dl class="movement-times">
              <div>
                <dt>Entrada</dt>
                <dd>
                  <strong>${icon('clock')}<time datetime="${m.entry}">${m.entry}</time>
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Saída</dt>
                <dd>
                  <strong>${icon('clock')}<time datetime="${m.exit}">${m.exit}</time>
                  </strong>
                </dd>
              </div>
            </dl>
            <form method="post" class="note-area" data-note-form="${m.id}" aria-label="Observação de ${esc(s?.name||m.name)}">
              <label for="note-${m.id}">Observação administrativa</label>
              <textarea class="input" id="note-${m.id}" name="note" maxlength="500" placeholder="Adicione uma observação…">${esc(state.notes[m.id]||'')}</textarea>
              <div class="note-actions">
                <span>${state.notes[m.id]?'Salva':''}</span>
                <button class="btn small" type="submit">${icon('save')}Salvar</button>
              </div>
            </form>
          </div>
        </article>`;}).join('')}</section>`:`<section class="panel">${empty('Nenhuma movimentação encontrada','Confira a data e os filtros da consulta.','move')}</section>`}`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderShell(renderMovement());
    document.title = "Movimentação dos alunos · AEGIS";
    if (options.focus) document.getElementById('main')?.focus({ preventScroll: true });
  }
  function navigate(next) {
    if (route === next) { render(); return; }
    const query = new URLSearchParams();
    if (next === 'students' && filters.studentQuery) query.set('q', filters.studentQuery);
    if (next === 'dashboard' && filters.camera !== 'all') query.set('camera', filters.camera);
    location.assign(pageHref(next) + (query.size ? '?' + query.toString() : ''));
  }
  function startPage() {
    
    if (!session) { location.replace(pageHref('login')); return; }
    render();
    
  }

  document.addEventListener('submit', async event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    event.preventDefault();
    if(!form.reportValidity())return;
    const data=new FormData(form);
    const value=name=>String(data.get(name)||'').trim();
    try {
      if(form.id==='global-search-form'){
        const q=value('query');
        const camera=cameras.find(c=>q&&normalize(c.location).includes(normalize(q)));
        if(camera){filters.camera=camera.id;navigate('dashboard');}
        else{filters.studentQuery=q;filters.studentStatus='all';filters.className='all';navigate('students');}
        return;
      }
      if(form.id==='movement-search'){filters.movementQuery=value('query');render();return;}
      if(form.dataset.noteForm){
        const next=copy(state);const text=value('note');
        if(text)next.notes[form.dataset.noteForm]=text;else delete next.notes[form.dataset.noteForm];
        audit(next,'Salvou observação');addEvent(next,'Observação atualizada','Uma observação de movimentação foi salva.');
        if(persist(next)){render();toast(text?'Observação salva.':'Observação removida.');}return;
      }
    } catch { if(form.querySelector('.form-error'))setError(form,'Não foi possível concluir. Confira os dados e tente novamente.');else toast('Não foi possível concluir esta ação.',true); }
  });
  document.addEventListener('click', event=>{
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action;const id=button.dataset.id;
    switch(action){
      case 'close-modal':closeModal();break;
      case 'toggle-menu':setMenu(!menuOpen);break;
      case 'close-menu':setMenu(false);break;
      case 'profile':openModal('Instituição',`<div class="detail-hero"><span class="avatar">${esc(initials(session.institution))}</span><div><h3>${esc(session.institution)}</h3><p>Administrador</p></div></div><div class="modal-actions"><a class="btn" href="Configuracoes.html">Configurações</a><button class="btn primary" data-action="logout">${icon('logout')}Sair da plataforma</button></div>`);break;
      case 'logout':session=null;prbUnlocked=false;try{sessionStorage.removeItem(SESSION_KEY);}catch{}closeModal();navigate('login');break;
      case 'notifications':openModal('Notificações',state.events.length?`<ul class="activity-list">${state.events.slice(0,4).map(e=>`<li class="activity-row"><span class="activity-icon">${icon('bell')}</span><div class="activity-text"><strong>${esc(e.title)}</strong><p>${esc(eventDescription(e.description))}</p><p><time datetime="${esc(e.at)}">${dateTime(e.at)}</time></p></div></li>`).join('')}</ul><div class="modal-actions"><a class="btn primary" href="Eventos.html">Ver todos os eventos</a></div>`:empty('Tudo em dia','Nenhuma ação foi registrada.','bell'));break;
      case 'letter':filters.letter=button.dataset.value;render();break;
      case 'movement-filters':filters.movementQuery='';filters.letter='all';filters.movementDate=today();render();break;
    }
  });
  document.addEventListener('change', event => { if (event.target.id === 'movement-date') { filters.movementDate=event.target.value||today(); render(); } });
  let searchTimer;
  window.addEventListener('pagehide',()=>clearTimeout(searchTimer));
  document.addEventListener('input', event=>{
    if(event.target.id==='threshold')document.querySelector('output[for=threshold]').textContent=event.target.value+'%';
    const form=event.target.closest('form');
    if(!['student-search','movement-search'].includes(form?.id))return;
    clearTimeout(searchTimer);const input=event.target;const value=input.value;const atRoute=route;
    searchTimer=setTimeout(()=>{
      if(route!==atRoute||!input.isConnected)return;
      const position=input.selectionStart;
      if(form.id==='student-search')filters.studentQuery=value;else filters.movementQuery=value;
      render();const replacement=document.querySelector(`#${form.id} input`);replacement?.focus();
      try{replacement?.setSelectionRange(position,position);}catch{}
    },250);
  });
  document.addEventListener('keydown', event=>{
    if(event.key==='Escape'&&menuOpen)setMenu(false);
    if(event.key==='Tab'&&menuOpen){
      const items=[...document.querySelectorAll('.sidebar button,.sidebar a')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
  modal.addEventListener('close',()=>{previousFocus?.isConnected&&previousFocus.focus();});
  document.addEventListener('error', event => {
    const image = event.target;
    if (!image || image.tagName !== 'IMG') return;
    const blank = document.createElement('span');
    blank.className = `${image.className || 'image-space'} image-blank`;
    blank.setAttribute('role', 'img');
    blank.setAttribute('aria-label', 'Imagem indisponível');
    image.replaceWith(blank);
  }, true);

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) toast('Os dados mudaram em outra aba. Atualize a página para consultar a versão mais recente.');
  });
  window.addEventListener('pagehide',()=>{toastTimers.forEach(clearTimeout);toastTimers.clear();});
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  startPage();
  const context=document.modelContext;
  if(context?.registerTool){
    const controller=new AbortController();
    const register=tool=>{try{Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(()=>{});}catch{}};
    register({name:'aegis_list_students',title:'Consultar alunos AEGIS',description:'Consulta os cadastros locais já visíveis na tela Alunos. Requer uma sessão ativa.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:100}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:input=>{if(!session)throw new Error('Entre na plataforma primeiro.');if(!input||typeof input!=='object'||(input.query!==undefined&&typeof input.query!=='string'))throw new Error('Consulta inválida.');const q=normalize(input.query||'');return {students:state.students.filter(s=>normalize(s.name+' '+s.enrollment).includes(q)).map(({name,enrollment,className,status})=>({name,enrollment,className,status}))};}});
    register({name:'aegis_open_student_creation',title:'Abrir cadastro de aluno',description:'Abre o formulário Novo aluno sem criar um registro. A conclusão exige o envio do formulário na interface.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{if(!session)throw new Error('Entre na plataforma primeiro.');if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Nenhum parâmetro é permitido.');if(route!=='students'){location.assign(pageHref('students')+'?novo=1');return {formOpen:false,navigating:true,created:false};}studentForm();return {formOpen:true,created:false};}});
    window.addEventListener('pagehide',()=>controller.abort(),{once:true});
  }


})();
