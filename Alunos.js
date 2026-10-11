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
  const route = 'students';
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

  function stats(items) { return `<section class="stats-grid" aria-label="Indicadores">${items.map(([label,value,type,ico,foot])=>`<article class="panel stat-card ${type}" aria-label="${esc(label)}">
          <dl class="stat-data">
            <dt class="stat-label">${label}</dt>
            <dd class="stat-row">
              <strong class="stat-number">${value}</strong>
              <span class="stat-icon">${icon(ico,'icon-lg')}</span>
            </dd>
          </dl>
          <p class="stat-foot">${foot}</p>
        </article>`).join('')}</section>`; }

  const downloadCSV = (filename,rows) => { shared.downloadCSV(filename,rows); toast('Arquivo CSV preparado para download.'); };

  function studentForm(id) {
    const s=state.students.find(s=>s.id===id) || {name:'',enrollment:'',className:'',email:'',status:'active',photo:''};
    openModal(id?'Editar aluno':'Novo aluno',`<form method="post" id="student-form" aria-labelledby="modal-title" data-id="${id?esc(id):''}" class="form-grid">
        <div class="field span-2">
          <label for="student-name">Nome completo</label>
          <input class="input" id="student-name" name="name" required minlength="3" maxlength="100" autocomplete="off" value="${esc(s.name)}" placeholder="Nome do aluno">
        </div>
        <div class="field">
          <label for="student-enrollment">Matrícula</label>
          <input class="input" id="student-enrollment" name="enrollment" required maxlength="20" pattern="[A-Za-z0-9-]+" value="${esc(s.enrollment)}" placeholder="Ex.: 2026009">
          <p class="form-note">Use letras, números ou hífen.</p>
        </div>
        <div class="field">
          <label for="student-class-name">Turma</label>
          <input class="input" id="student-class-name" name="className" required maxlength="40" value="${esc(s.className)}" placeholder="Ex.: INFO 62">
        </div>
        <div class="field">
          <label for="student-email">E-mail (opcional)</label>
          <input class="input" id="student-email" name="email" type="email" maxlength="120" value="${esc(s.email)}" placeholder="aluno@exemplo.com">
        </div>
        <div class="field">
          <label for="student-status">Status</label>
          <select class="input" id="student-status" name="status">
            <option value="active" ${s.status==='active'?'selected':''}>Ativo</option>
            <option value="inactive" ${s.status==='inactive'?'selected':''}>Inativo</option>
          </select>
        </div>
        <div class="field span-2">
          <label for="student-photo">Foto (opcional)</label>
          <input class="input" type="file" id="student-photo" name="photo" accept="image/png,image/jpeg,image/webp">
          <p class="form-note">PNG, JPG ou WEBP · até 800 KB. Utilize uma imagem de teste.</p>${s.photo?`<label class="check-row">
            <input type="checkbox" name="removePhoto">
            <span>Remover foto atual</span>
          </label>`:''}</div>
        <p class="form-error span-2">
        </p>
        <div class="modal-actions span-2">
          <button class="btn" type="button" data-action="close-modal">Cancelar</button>
          <button class="btn primary" type="submit">${icon('save')}${id?'Salvar alterações':'Cadastrar aluno'}</button>
        </div>
      </form>`);
  }

  function viewStudent(id) {
    const s=state.students.find(s=>s.id===id);if(!s)return;
    openModal('Detalhes do aluno',`<header class="detail-hero">${avatar(s)}<div>
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.className)} · ${badge(s.status)}</p>
        </div>
      </header>
      <dl class="details-grid">
        <div>
          <dt>Matrícula</dt>
          <dd>${esc(s.enrollment)}</dd>
        </div>
        <div>
          <dt>Turma</dt>
          <dd>${esc(s.className)}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>${esc(s.email||'Não informado')}</dd>
        </div>
        <div>
          <dt>Última identificação</dt>
          <dd>${esc(s.last||'Sem registro')}</dd>
        </div>
      </dl>
      <div class="modal-actions">
        <button class="btn" data-action="close-modal">Fechar</button>
        <button class="btn primary" data-action="edit-student" data-id="${esc(s.id)}">${icon('edit')}Editar cadastro</button>
      </div>`);
  }

  const fileData = shared.fileData;

  function renderStudents() {
    const query=normalize(filters.studentQuery);
    const list=state.students.filter(s=>(!query||normalize(s.name+' '+s.enrollment+' '+s.className).includes(query))&&(filters.studentStatus==='all'||s.status===filters.studentStatus)&&(filters.className==='all'||s.className===filters.className));
    const active=state.students.filter(s=>s.status==='active').length;
    const classes=[...new Set(state.students.map(s=>s.className))].sort();
    return `${head('Alunos',pages.students[1],`<button class="btn primary" data-action="new-student">${icon('plus')}Novo aluno</button>`)}${stats([['Alunos cadastrados',state.students.length,'','users','Total de cadastros'],['Ativos',active,'success','checkcircle','Alunos com cadastro ativo'],['Inativos',state.students.length-active,'warning','user','Alunos com cadastro inativo'],['Turmas registradas',classes.length,'','grid','Turmas com alunos cadastrados']])}<div class="toolbar">
        <form id="student-search" class="search-input" role="search" aria-label="Busca de alunos">${icon('search')}<input class="input" type="search" name="query" placeholder="Buscar aluno ou matrícula…" aria-label="Buscar aluno" value="${esc(filters.studentQuery)}" maxlength="100">
        </form>
        <select id="student-class" class="input" aria-label="Filtrar turma">
          <option value="all">Todas as turmas</option>${classes.map(c=>`<option ${filters.className===c?'selected':''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
        <button class="btn small" data-action="student-filters">${icon('filter')}Filtros${filters.studentStatus!=='all'?`<span class="status-dot">
          </span>`:''}</button>
        <button class="btn small grow" data-action="export-students">${icon('download')}Exportar</button>
      </div>
      <section class="panel table-panel" style="margin-top:0" aria-label="Lista de alunos">${list.length?`<div class="table-scroll">
          <table>
            <caption class="visually-hidden">Alunos cadastrados no AEGIS</caption>
            <thead>
              <tr>
                <th scope="col">Aluno</th>
                <th scope="col">Matrícula</th>
                <th scope="col">Turma</th>
                <th scope="col">Status</th>
                <th scope="col">Última identificação</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>${list.map(s=>`<tr>
                <td>
                  <div class="table-student">${avatar(s)}<div>
                      <strong>${esc(s.name)}</strong>
                    </div>
                  </div>
                </td>
                <td>${esc(s.enrollment)}</td>
                <td>${esc(s.className)}</td>
                <td>${badge(s.status)}</td>
                <td>${esc(s.last||'—')}</td>
                <td>
                  <div class="table-actions">
                    <button class="icon-button" data-action="view-student" data-id="${esc(s.id)}" aria-label="Ver ${esc(s.name)}">${icon('eye')}</button>
                    <button class="icon-button" data-action="edit-student" data-id="${esc(s.id)}" aria-label="Editar ${esc(s.name)}">${icon('edit')}</button>
                    <button class="icon-button danger" data-action="delete-student" data-id="${esc(s.id)}" aria-label="Excluir ${esc(s.name)}">${icon('trash')}</button>
                  </div>
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`:empty('Nenhum aluno encontrado','Cadastre um aluno ou altere os filtros para ver os resultados.','users')}<div class="table-footer">
          <span>${list.length} de ${state.students.length} aluno${state.students.length===1?'':'s'}</span>
        </div>
      </section>`;
  }
 
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderShell(renderStudents());
    document.title = "Alunos · AEGIS";
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
    if (pageParams.get('novo') === '1') studentForm();
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
      if(form.id==='student-search'){filters.studentQuery=value('query');render();return;}
      if(form.id==='student-form'){
        const id=form.dataset.id;const name=value('name');const enrollment=value('enrollment');const className=value('className');
        if(name.length<3||!className||!/^[A-Za-z0-9-]+$/.test(enrollment)){setError(form,'Informe um nome com pelo menos 3 caracteres, uma matrícula válida e a turma.');return;}
        if(state.students.some(s=>normalize(s.enrollment)===normalize(enrollment)&&s.id!==id)){setError(form,'Essa matrícula já está cadastrada. Use uma matrícula diferente.');return;}
        const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Salvando…';
        let photo;
        try{photo=await fileData(form.elements.photo.files?.[0]);}
        catch(error){setError(form,error.message);button.disabled=false;button.textContent='Salvar cadastro';return;}
        const next=copy(state);const index=next.students.findIndex(s=>s.id===id);const old=index>=0?next.students[index]:null;
        const student={id:old?.id||uid(),name,enrollment,className,email:value('email'),status:value('status'),photo:data.has('removePhoto')?'':photo||old?.photo||'',last:old?.last||'—'};
        if(old)next.students[index]=student;else next.students.push(student);
        audit(next,old?'Editou cadastro de aluno':'Cadastrou aluno');addEvent(next,old?'Cadastro atualizado':'Aluno cadastrado',`${name} · ${className}`);
        if(persist(next)){closeModal();render();toast(old?'Cadastro atualizado.':'Aluno cadastrado.');}
        else{button.disabled=false;button.textContent='Salvar cadastro';}return;
      }
      if(form.id==='student-filter-form'){filters.studentStatus=value('status');closeModal();render();return;}
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
      case 'new-student':studentForm();break;
      case 'edit-student':studentForm(id);break;
      case 'view-student':viewStudent(id);break;
      case 'delete-student':{
        const s=state.students.find(s=>s.id===id);if(!s)return;
        openModal('Excluir cadastro?',`<p>Deseja excluir o cadastro de <strong>${esc(s.name)}</strong> da plataforma?</p><p class="form-note" style="margin-top:12px">Você precisará cadastrar novamente para recuperar essas informações.</p><div class="modal-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn danger" data-action="confirm-delete" data-id="${esc(id)}">${icon('trash')}Excluir aluno</button></div>`);break;
      }
      case 'confirm-delete':{
        const s=state.students.find(s=>s.id===id);if(!s)return;
        const next=copy(state);next.students=next.students.filter(s=>s.id!==id);audit(next,'Excluiu cadastro de aluno');addEvent(next,'Cadastro excluído',s.name);
        if(persist(next)){closeModal();render();toast('Cadastro excluído da plataforma.');}break;
      }
      case 'student-filters':openModal('Filtrar alunos',`<form id="student-filter-form"><div class="field"><label for="student-status-filter">Status do cadastro</label><select name="status" id="student-status-filter" class="input">${[['all','Todos os alunos'],['active','Ativos'],['inactive','Inativos']].map(([v,n])=>`<option value="${v}" ${filters.studentStatus===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Aplicar filtros</button></div></form>`);break;
      case 'export-students':{
        const rows=state.students.filter(s=>(!filters.studentQuery||normalize(s.name+' '+s.enrollment+' '+s.className).includes(normalize(filters.studentQuery)))&&(filters.studentStatus==='all'||s.status===filters.studentStatus)&&(filters.className==='all'||s.className===filters.className));
        downloadCSV('aegis-alunos.csv',[['Nome','Matrícula','Turma','E-mail','Status','Última identificação'],...rows.map(s=>[s.name,s.enrollment,s.className,s.email,s.status==='active'?'Ativo':'Inativo',s.last])]);break;
      }
    }
  });
  document.addEventListener('change', event => { if (event.target.id === 'student-class') { filters.className=event.target.value; render(); } });
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
