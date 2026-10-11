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
  const route = 'request';
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

  function closeModal(){if(modal.open)modal.close();previousFocus?.isConnected&&previousFocus.focus();}

  function renderRequest() {
    const stored = state.requests.find(r=>r.protocol===lastProtocol);
    return `<div class="request-page">${publicHeader()}<main id="main" class="request-layout" tabindex="-1" aria-labelledby="request-title">
          <section class="panel request-card" aria-labelledby="request-title">
            <span class="eyebrow muted">Acesso institucional</span>
            <h1 id="request-title" style="margin-top:12px">Solicitar acesso à plataforma</h1>
            <p class="muted">Preencha os dados da instituição para registrar sua solicitação.</p>
            <form method="post" id="request-form" class="form-grid" aria-labelledby="request-title">
              <div class="field span-2">
                <label for="request-name">Nome completo</label>
                <input id="request-name" class="input" name="name" autocomplete="name" required minlength="3" maxlength="100" placeholder="Seu nome completo">
              </div>
              <div class="field">
                <label for="request-email">E-mail institucional</label>
                <input id="request-email" class="input" name="email" type="email" autocomplete="email" required maxlength="120" placeholder="nome@instituicao.edu.br">
              </div>
              <div class="field">
                <label for="request-institution">Instituição</label>
                <input id="request-institution" class="input" name="institution" autocomplete="organization" required maxlength="100" placeholder="Nome da instituição">
              </div>
              <div class="field span-2">
                <label for="request-role">Função na instituição</label>
                <select id="request-role" class="input" name="role" required>
                  <option value="">Selecione sua função</option>
                  <option>Direção</option>
                  <option>Coordenação</option>
                  <option>Professor(a)</option>
                  <option>Equipe administrativa</option>
                  <option>Outro</option>
                </select>
              </div>
              <div class="field span-2">
                <label for="request-reason">Motivo da solicitação</label>
                <textarea class="input" id="request-reason" name="reason" minlength="10" maxlength="1000" required placeholder="Conte como pretende utilizar o AEGIS"></textarea>
              </div>
              <label class="check-row span-2">
                <input type="checkbox" name="consent" required>
                <span>Li a <a href="Privacidade.html">Política de Privacidade</a>.</span>
              </label>
              <p class="form-error span-2">
              </p>
              <button class="btn primary span-2" type="submit">Registrar solicitação</button>
            </form>
          </section>
          <aside class="panel request-status" aria-label="Status da solicitação" aria-live="polite">${stored?`<div class="status-illustration success">${icon('checkcircle')}</div>
            <h2>Solicitação registrada</h2>
            <p>Seu protocolo está disponível abaixo.</p>
            <div class="protocol">
              <span class="eyebrow">Dados do protocolo</span>
              <strong>${esc(stored.protocol)}</strong>
            </div>
            <a class="btn full" style="margin-top:24px" href="index.html">Voltar para o login</a>`:`<div class="status-illustration">${icon('clock')}</div>
            <h2>Aguardando solicitação</h2>
            <p>Depois de preencher e enviar o formulário, seu protocolo aparecerá aqui.</p>`}</aside>
        </main>
      </div>`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderRequest();
    document.title = "Solicitar acesso · AEGIS";
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
      if(form.id==='request-form'){
        if(value('name').length<3||value('reason').length<10||!value('institution')){setError(form,'Preencha o nome, a instituição e um motivo com pelo menos 10 caracteres.');return;}
        const next=copy(state);const protocol=`AEGIS-${today().slice(0,4)}-${String(next.requests.length+1).padStart(4,'0')}`;
        next.requests.push({id:uid(),protocol,name:value('name'),email:value('email'),institution:value('institution'),role:value('role'),reason:value('reason'),at:now()});
        if(persist(next)){lastProtocol=protocol;render();toast('Solicitação registrada.');}
        return;
      }
    } catch { if(form.querySelector('.form-error'))setError(form,'Não foi possível concluir. Confira os dados e tente novamente.');else toast('Não foi possível concluir esta ação.',true); }
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

})();
