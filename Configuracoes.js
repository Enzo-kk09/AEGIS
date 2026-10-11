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
  const route = 'settings';
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

  function renderSettings() {
    const s=state.settings;
    return `${head('Configurações',pages.settings[1])}<div class="settings-grid">
        <section class="panel panel-pad settings-card" aria-labelledby="security-title">
          <header class="panel-header">
            <h2 id="security-title">Segurança e acesso</h2>${icon('shield')}</header>
          <div class="settings-list">
            <div class="setting-row">
              <div>
                <strong>Perfil de acesso</strong>
                <p>Administrador da instituição</p>
              </div>
              <span class="badge blue">Administrador</span>
            </div>
            <div class="setting-row">
              <div>
                <strong>Sessão atual</strong>
                <p>${esc(session.institution)}</p>
              </div>${icon('user')}</div>
            <div class="setting-row">
              <div>
                <strong>Autenticação em dois fatores</strong>
                <p>Configuração de acesso da instituição.</p>
              </div>
              <span class="badge">Não configurada</span>
            </div>
          </div>
        </section>
        <section class="panel panel-pad settings-card" aria-labelledby="consult-title">
          <header class="panel-header">
            <h2 id="consult-title">Consulta de imagens</h2>${icon('camera')}</header>
          <form method="post" id="consult-form" aria-labelledby="consult-title" class="settings-form">
            <div class="field">
              <label for="consult-days">Período máximo de consulta</label>
              <select class="input" id="consult-days" name="days">${[["1","1 dia"],["7","7 dias"],["30","30 dias"]].map(([v,n])=>`<option value="${v}" ${s.consultaDays===v?"selected":""}>${n}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="consult-reason">Motivo da consulta</label>
              <textarea id="consult-reason" class="input" name="reason" required minlength="10" maxlength="500" placeholder="Informe a finalidade da consulta"></textarea>
            </div>
            <div class="field">
              <label for="consult-responsible">Responsável pela consulta</label>
              <input class="input" id="consult-responsible" name="responsible" required maxlength="100" value="${esc(session.institution)}">
            </div>
            <p class="form-error">
            </p>
            <button class="btn primary" type="submit">Registrar consulta</button>
          </form>
        </section>
        <section class="panel panel-pad settings-card" aria-labelledby="recognition-title">
          <header class="panel-header">
            <h2 id="recognition-title">Reconhecimento facial</h2>${icon('scan')}</header>
          <form method="post" id="settings-form" aria-labelledby="recognition-title" class="settings-list">
            <div class="setting-row">
              <div>
                <strong>Reconhecimento facial</strong>
                <p>Habilitar reconhecimento</p>
              </div>
              <label class="switch">
                <input type="checkbox" name="recognition" ${s.recognition?'checked':''} aria-label="Habilitar reconhecimento facial">
              </label>
            </div>
            <div>
              <label for="threshold" style="font-size:.875rem;font-weight:600">Confiança mínima</label>
              <div class="range-row">
                <input type="range" id="threshold" name="threshold" min="50" max="100" step="1" value="${s.threshold}">
                <output for="threshold">${s.threshold}%</output>
              </div>
            </div>
            <div class="setting-row">
              <div>
                <strong>Identificação incerta</strong>
                <p>Gerar alerta no modelo de funcionamento</p>
              </div>
              <label class="switch">
                <input type="checkbox" name="uncertainAlert" ${s.uncertainAlert?'checked':''} aria-label="Gerar alerta de identificação incerta">
              </label>
            </div>
            <div class="setting-row">
              <div>
                <strong>Revisão humana</strong>
                <p>Obrigatória para confirmar uma identificação</p>
              </div>
              <span class="badge success">Obrigatória</span>
            </div>
            <p class="form-error">
            </p>
            <button type="submit" class="btn primary">${icon('save')}Salvar preferências</button>
          </form>
        </section>
        <section class="panel panel-pad settings-card" aria-labelledby="audit-title">
          <header class="panel-header">
            <h2 id="audit-title">Auditoria</h2>
          </header>${state.audit.length?`<div class="table-scroll">
            <table>
              <caption class="visually-hidden">Últimas ações registradas na auditoria</caption>
              <thead>
                <tr>
                  <th scope="col">Usuário</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Data/hora</th>
                </tr>
              </thead>
              <tbody>${state.audit.slice(0,6).map(a=>`<tr>
                  <td>${esc(a.user)}</td>
                  <td>${esc(a.action)}</td>
                  <td>
                    <time datetime="${esc(a.at)}">${dateTime(a.at)}</time>
                  </td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`:`<p class="muted" style="font-size:.875rem">As consultas e alterações realizadas aparecerão aqui.</p>`}</section>
      </div>`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderShell(renderSettings());
    document.title = "Configurações · AEGIS";
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
      if(form.id==='settings-form'){
        const next=copy(state);next.settings={...next.settings,recognition:data.has('recognition'),threshold:Number(value('threshold')),uncertainAlert:data.has('uncertainAlert'),humanReview:true};
        audit(next,'Atualizou preferências');addEvent(next,'Preferências atualizadas','As configurações foram salvas.');
        if(persist(next)){render();toast('Preferências salvas.');}return;
      }
      if(form.id==='consult-form'){
        if(value('reason').length<10||!value('responsible')){setError(form,'Informe o responsável e um motivo com pelo menos 10 caracteres.');return;}
        const next=copy(state);next.settings.consultaDays=value('days');
        audit(next,`Consulta de imagens (${value('days')} dia${value('days')==='1'?'':'s'})`);
        addEvent(next,'Consulta de imagens registrada',`${value('responsible')}: ${value('reason')}`);
        if(persist(next)){render();toast('Consulta registrada.');}return;
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
    }
  });
  document.addEventListener('input', event => { if (event.target.id === 'threshold') document.querySelector('output[for=threshold]').textContent=event.target.value+'%'; });
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
