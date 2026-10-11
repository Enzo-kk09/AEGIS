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
  const route = 'dashboard';
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

  function cameraName(c) { return c.name || state.students.find(s=>s.id===c.studentId)?.name || 'Cadastro não disponível'; }

  function cameraDetail(id) {
    const c=cameras.find(c=>c.id===id);if(!c)return;
    openModal('Detalhes da identificação',`${photoMarkup(c.photo,'Imagem da identificação','modal-image')}<div class="detail-hero" style="margin-bottom:16px">
        <div>
          <h3>${esc(cameraName(c))}</h3>
          <p>${esc(c.location)} · ${c.at}</p>
        </div>
      </div>${badge(c.status)}<div class="info-box">${icon('info')}<span>Uma identificação incerta ou não confirmada exige revisão humana.</span>
      </div>
      <div class="modal-actions">
        <button class="btn" data-action="close-modal">Fechar</button>
        <a class="btn primary" href="Movimentacao.html">Consultar movimentação</a>
      </div>`);
  }

  function cameraCards() {
    const selected = cameras.filter(c =>
      (filters.camera === 'all' || c.id === filters.camera) &&
      (filters.status === 'all' || c.status === filters.status)
    );
    if (!selected.length) return `<div class="panel span-2">${empty('Nenhum registro encontrado','Altere os filtros para consultar os pontos de acesso.','camera')}</div>`;
    return selected.map(c => `
      <article class="panel camera-card" aria-labelledby="camera-title-${c.id}">
        <figure class="camera-visual">
          ${validImage(c.photo) ? photoMarkup(c.photo, `Imagem da câmera em ${c.location}`, 'camera-image') : `<div class="camera-no-feed">${icon('camera','icon-lg')}<span>SEM TRANSMISSÃO AO VIVO</span><small>Ponto de acesso demonstrativo</small><span class="camera-reticle" aria-hidden="true"></span></div>`}
          <span class="camera-code">${c.id.toUpperCase()}</span>
          <figcaption class="camera-overlay">${icon('camera')}PONTO DE ACESSO</figcaption>
        </figure>
        <div class="camera-body">
          <header class="camera-top">
            <h2 id="camera-title-${c.id}">${esc(c.location)}</h2>${icon('camera')}</header>
          <p class="student-name">${esc(cameraName(c))}</p>
          ${badge(c.status)}
          <p class="camera-bottom">${icon('clock')}Registro às <time datetime="${c.at}">${c.at}</time>
          </p>
        </div>
        <button type="button" class="camera-detail" data-action="camera-detail" data-id="${c.id}" aria-label="Ver identificação em ${esc(c.location)}">
          <span class="visually-hidden">Ver identificação em ${esc(c.location)}</span>
        </button>
      </article>`).join('');
  }

  function renderDashboard() {
    return `${head('Dados gerais',pages.dashboard[1],`<a class="btn" href="Relatorio.html">${icon('file')}Abrir relatório</a>`,session.institution)}${tabs()}<section class="overview-strip" aria-label="Resumo dos registros demonstrativos"><div><span class="eyebrow">Pontos monitorados</span><strong>${cameras.length.toString().padStart(2,'0')}</strong><small>Registros de exemplo</small></div><div><span class="eyebrow">Identificações confirmadas</span><strong>${cameras.filter(c=>c.status==='confirmed').length.toString().padStart(2,'0')}</strong><small>No último registro por câmera</small></div><div><span class="eyebrow">Aguardando revisão</span><strong>${cameras.filter(c=>c.status!=='confirmed').length.toString().padStart(2,'0')}</strong><small>Incertas ou não identificadas</small></div><a href="PRB.html">Revisar registros ${icon('arrow')}</a></section><div class="toolbar">
        <select class="input" id="camera-select" aria-label="Selecionar câmera">
          <option value="all">Todas as câmeras</option>${cameras.map(c=>`<option value="${c.id}" ${filters.camera===c.id?'selected':''}>${esc(c.location)}</option>`).join('')}</select>
        <div class="segmented grow" role="group" aria-label="Período de consulta">${[['today','Hoje'],['week','7 dias'],['month','30 dias']].map(([value,label])=>`<button type="button" class="${filters.period===value?'active':''}" data-action="period" data-value="${value}" aria-pressed="${filters.period===value}">${label}</button>`).join('')}</div>
        <button class="btn small" data-action="camera-filters">${icon('filter')}Filtros${filters.status!=='all'?`<span class="status-dot">
          </span>`:''}</button>
      </div>
      <section class="camera-grid" aria-label="Identificações por câmera">${cameraCards()}</section>
      <p class="section-caption">${icon('info')}${filters.period==='today'?'Último registro':'Último registro no período selecionado'} por câmera</p>
      <div class="dashboard-bottom">
        <section class="panel panel-pad" aria-labelledby="activity-title">
          <header class="panel-header">
            <h2 id="activity-title">Atividade recente</h2>
            <a href="Identificacoes.html">Ver identificações</a>
          </header>
          <ul class="activity-list">${[["confirmed","Identificação confirmada","Roberto Almeida · Corredor B","12:58"],["unknown","Pessoa não identificada","Entrada principal · revisão recomendada","12:43"],["uncertain","Identificação incerta","Gabriel Pereira · Biblioteca","13:50"]].map(([s,t,d,at])=>`<li class="activity-row">
              <span class="activity-icon ${s==='unknown'?'danger':s==='uncertain'?'warning':''}">${icon(s==='confirmed'?'checkcircle':s==='unknown'?'alert':'help')}</span>
              <div class="activity-text">
                <strong>${t}</strong>
                <p>${d}</p>
              </div>
              <time datetime="${at}">${at}</time>
            </li>`).join('')}</ul>
        </section>
        <section class="panel panel-pad" aria-labelledby="quick-title">
          <header class="panel-header">
            <h2 id="quick-title">Acesso rápido</h2>
          </header>
          <nav class="quick-actions" aria-label="Acesso rápido">
            <a class="quick-action" href="Movimentacao.html">${icon('move')}<div>
                <strong>Movimentação dos alunos</strong>
                <small>Entradas, saídas e observações</small>
              </div>
            </a>
            <a class="quick-action" href="Alunos.html">${icon('users')}<div>
                <strong>Gerenciar alunos</strong>
                <small>Cadastros e turmas da instituição</small>
              </div>
            </a>
            <a class="quick-action" href="PRB.html">${icon('shield')}<div>
                <strong>Acessar área PRB</strong>
                <small>Consulta com autorização</small>
              </div>
            </a>
          </nav>
        </section>
      </div>`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderShell(renderDashboard());
    document.title = "Dados gerais · AEGIS";
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
      if(form.id==='camera-filter-form'){filters.status=value('status');closeModal();render();return;}
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
      case 'period':filters.period=button.dataset.value;render();break;
      case 'camera-filters':openModal('Filtrar identificações',`<form id="camera-filter-form"><div class="field"><label for="camera-status">Status da identificação</label><select id="camera-status" name="status" class="input">${[['all','Todos os status'],['confirmed','Identificado'],['uncertain','Identificação incerta'],['unknown','Não identificado']].map(([v,n])=>`<option value="${v}" ${filters.status===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Aplicar filtros</button></div></form>`);break;
      case 'camera-detail':cameraDetail(id);break;
    }
  });
  document.addEventListener('change', event => { if (event.target.id === 'camera-select') { filters.camera=event.target.value; render(); } });
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
