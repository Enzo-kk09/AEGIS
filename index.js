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
  const route = 'login';
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

  function doLogin(institution,password) {
    if(!institution.trim()){setError(document.getElementById('login-form'),'Informe o nome da instituição.');return;}
    if(password!=='AEGIS2026'){setError(document.getElementById('login-form'),'Senha incorreta. Para este acesso, utilize AEGIS2026.');return;}
    session={institution:institution.trim().slice(0,80)};
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));}catch{session=null;setError(document.getElementById('login-form'),'O navegador bloqueou o armazenamento da sessão. Permita o armazenamento deste site para entrar.');return;}
    navigate('dashboard');
  }

  function renderLogin() {
    return `<div class="auth-page">
        <header class="auth-story" aria-labelledby="welcome-title">
          <div class="auth-welcome">
            <div class="auth-emblem">
              <img src="${images['./assets/aegis-logo.png']}" alt="Logo AEGIS">
            </div>
            <div class="auth-wordmark">AEGIS</div>
            <p class="auth-system-name">Advanced Educational Guardian<br>Intelligence System</p>
            <h1 id="welcome-title">Controle de acesso<br>escolar</h1>
          </div>
          <p class="auth-story-footer"><span>AEGIS / Plataforma educacional</span><span>CIMOL · 2026</span></p>
        </header>
        <main class="auth-body" id="main" tabindex="-1" aria-labelledby="login-title">
          <div class="auth-wrap">
            <h2 id="login-title">Entrar no AEGIS</h2>
            <p class="auth-intro">Entre com os dados da sua instituição.</p>
            <form method="post" class="auth-form" id="login-form" aria-labelledby="login-title">
              <div class="field">
                <label for="institution">Instituição</label>
                <input class="input" id="institution" name="institution" autocomplete="organization" placeholder="Nome da instituição" required maxlength="80">
              </div>
              <div class="field">
                <label for="password">Senha de acesso</label>
                <div class="password-input">
                  <input class="input" type="password" id="password" name="password" autocomplete="current-password" placeholder="Digite sua senha" required maxlength="80">
                  <button class="icon-button" type="button" data-action="toggle-password" aria-label="Mostrar senha" aria-pressed="false">${icon('eye')}</button>
                </div>
              </div>
              <p class="form-error"></p>
              <button class="btn primary full" type="submit">${icon('lock')}Entrar</button>
            </form>
            <div class="separator">ou</div>
            <a class="btn full" href="SolicitarAcesso.html">Solicitar acesso / contato</a>
            <button class="btn ghost small full demo-entry" type="button" data-action="demo-login">Ver demonstração</button>
            <nav class="auth-links" aria-label="Informações legais">
              <a href="Privacidade.html">Política de Privacidade</a>
            </nav>
          </div>
        </main>
      </div>`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderLogin();
    document.title = "Entrar · AEGIS";
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
    const legacy = location.hash.replace(/^#\/?/, '').split('?')[0];
    if (legacy && legacy !== 'login' && Object.hasOwn(pageFiles,legacy)) { location.replace(pageHref(legacy)); return; }
    
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
      if(form.id==='login-form'){doLogin(value('institution'),String(data.get('password')||''));return;}
    } catch { if(form.querySelector('.form-error'))setError(form,'Não foi possível concluir. Confira os dados e tente novamente.');else toast('Não foi possível concluir esta ação.',true); }
  });
  document.addEventListener('click', event=>{
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action;const id=button.dataset.id;
    switch(action){
      case 'toggle-password':{
        const input=document.getElementById('password');passwordVisible=!passwordVisible;input.type=passwordVisible?'text':'password';button.setAttribute('aria-label',passwordVisible?'Ocultar senha':'Mostrar senha');button.setAttribute('aria-pressed',String(passwordVisible));button.innerHTML=icon(passwordVisible?'eyeoff':'eye');break;
      }
      case 'demo-login':doLogin('CIMOL','AEGIS2026');break;
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

})();
