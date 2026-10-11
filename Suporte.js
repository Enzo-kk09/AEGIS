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
  const route = 'help';
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
  const faqs = [
    [
        "Como adicionar ou corrigir a foto de um aluno?",
        "Abra Alunos e escolha Novo aluno ou o ícone de edição. No campo Foto, selecione uma imagem PNG, JPG ou WEBP de até 800 KB."
    ],
    [
        "O que fazer com uma identificação incerta?",
        "Consulte a movimentação e registre uma observação administrativa. A confirmação exige revisão humana; uma imagem de câmera não deve ser tratada como prova absoluta de identidade."
    ],
    [
        "Como consultar uma identificação?",
        "Na tela Dados gerais, selecione a câmera e clique no registro para consultar os detalhes. Use o filtro de status para localizar identificações incertas ou não confirmadas."
    ],
    [
        "Quem pode consultar a área PRB?",
        "A consulta é destinada a pessoas autorizadas pela instituição. Informe o código de acesso na tela PRB."
    ],
    [
        "Como solicitar a consulta de imagens?",
        "Abra Configurações, preencha o motivo e clique em Registrar consulta."
    ],
    [
        "Como editar os dados de um aluno?",
        "Na tela Alunos, encontre o cadastro pelo nome ou pela matrícula. Clique no ícone de edição, altere os campos e escolha Salvar alterações."
    ]
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

  function renderHelp() {
    return `${head('Ajuda e suporte',pages.help[1],`<span class="badge blue">${icon('message')}Suporte AEGIS</span>`)}<div class="help-grid">
        <section class="panel panel-pad" aria-labelledby="help-title">
          <header class="panel-header">
            <h2 id="help-title">Como podemos ajudar?</h2>
          </header>
          <form method="post" id="help-form" aria-labelledby="help-title" class="help-form">
            <div class="field">
              <label for="help-need">Explique sua necessidade</label>
              <textarea class="input" id="help-need" name="need" required minlength="10" maxlength="1500" placeholder="Descreva a situação e o que você precisa…" style="min-height:145px"></textarea>
            </div>
            <div class="field">
              <label for="help-institution">Nome da instituição</label>
              <input class="input" id="help-institution" name="institution" required maxlength="100" value="${esc(session.institution)}">
            </div>
            <p class="form-error">
            </p>
            <button type="submit" class="btn primary">Registrar solicitação</button>
          </form>
        </section>
        <section class="panel panel-pad" aria-labelledby="faq-title">
          <header class="panel-header">
            <h2 id="faq-title">Perguntas frequentes</h2>
          </header>
          <div class="faq-list">${faqs.map(([q,a])=>`<details>
              <summary>${q}${icon('down')}</summary>
              <p>${a}</p>
            </details>`).join('')}</div>
        </section>
      </div>${state.tickets.length?`<section class="panel panel-pad" style="margin-top:24px" aria-labelledby="tickets-title">
        <header class="panel-header">
          <h2 id="tickets-title">Solicitações registradas</h2>
        </header>${state.tickets.slice().reverse().map(t=>`<div class="ticket-row">
          <strong>${esc(t.protocol)}</strong>
          <span class="badge blue" style="margin-left:10px">Registrada</span>
          <p>${esc(t.need)}</p>
          <small>${esc(t.institution)} · <time datetime="${esc(t.at)}">${dateTime(t.at)}</time>
          </small>
        </div>`).join('')}</section>`:''}`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderShell(renderHelp());
    document.title = "Ajuda e suporte · AEGIS";
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
      if(form.id==='help-form'){
        if(value('need').length<10||!value('institution')){setError(form,'Explique a necessidade com pelo menos 10 caracteres e informe a instituição.');return;}
        const next=copy(state);const protocol=`SUP-${String(next.tickets.length+1).padStart(4,'0')}`;
        next.tickets.push({id:uid(),protocol,need:value('need'),institution:value('institution'),at:now()});audit(next,'Registrou solicitação de suporte');addEvent(next,'Solicitação de suporte',`Protocolo ${protocol} registrado.`);
        if(persist(next)){render();toast(`Solicitação ${protocol} registrada.`);}return;
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
