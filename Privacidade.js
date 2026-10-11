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
  const route = 'privacy';
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

  function renderPrivacy() {
    const sections=[
      ['1. Apresentação','A presente Política de Privacidade tem como objetivo explicar como o AEGIS — Advanced Educational Guardian Intelligence System poderá tratar informações durante o seu funcionamento. Esta Política foi elaborada considerando os princípios da Lei Geral de Proteção de Dados Pessoais (LGPD).'],
      ['2. Quais dados podem ser tratados','Dependendo da funcionalidade utilizada, o AEGIS poderá trabalhar com:', ['dados de identificação de usuários cadastrados;','informações de acesso ao sistema;','registros de atividades e eventos;','imagens provenientes de câmeras;','informações utilizadas em testes de reconhecimento facial;','dados técnicos necessários ao funcionamento do sistema.'],''],
      ['3. Finalidade da coleta','As informações poderão ser utilizadas exclusivamente para finalidades relacionadas ao projeto, incluindo:',['funcionamento do sistema;','controle e apoio à segurança escolar;','realização de testes;','identificação de eventos;','avaliação de desempenho;','desenvolvimento e aprimoramento das funcionalidades;','produção de análises e resultados acadêmicos.'],'Os dados não deverão ser utilizados para finalidades incompatíveis com aquelas apresentadas nesta Política.'],
      ['4. Reconhecimento facial e biometria','O AEGIS poderá utilizar tecnologia de reconhecimento facial em suas funcionalidades experimentais. Dados biométricos vinculados a uma pessoa são considerados dados pessoais sensíveis pela LGPD. Por isso, uma eventual implantação real do sistema deverá possuir medidas específicas de segurança, base legal adequada, transparência e avaliação dos riscos envolvidos. O reconhecimento facial não deverá ser considerado uma confirmação absoluta da identidade de uma pessoa. Resultados produzidos pelo sistema deverão ser analisados por um responsável autorizado.'],
      ['5. Câmeras e imagens','As câmeras utilizadas pelo sistema deverão possuir finalidade previamente definida e estar limitadas aos ambientes necessários para o objetivo de segurança. As imagens não deverão ser utilizadas para monitoramento indiscriminado ou para finalidades incompatíveis com as informadas aos titulares. Em uma eventual implantação real, deverão ser estabelecidos períodos de armazenamento e procedimentos para exclusão ou anonimização das imagens.'],
      ['6. Segurança das informações','O AEGIS deverá adotar medidas técnicas e administrativas destinadas a proteger as informações contra acesso não autorizado, alteração, perda, vazamento ou destruição. Entre essas medidas poderão estar:',['autenticação;','controle de permissões;','senhas;','criptografia;','registros de acesso;','backups;','monitoramento de atividades.'],'O acesso às informações deverá ser limitado às pessoas que possuam autorização e necessidade de utilizá-las.'],
      ['7. Compartilhamento','As informações coletadas pelo sistema não deverão ser compartilhadas indiscriminadamente com terceiros. Em uma eventual utilização real, qualquer compartilhamento deverá possuir finalidade legítima, fundamento jurídico adequado e ser limitado ao mínimo necessário. Os dados também não deverão ser comercializados para finalidades incompatíveis com o projeto.'],
      ['8. Crianças e adolescentes','Considerando que o AEGIS possui como possível ambiente de aplicação uma instituição de ensino, sua utilização poderá envolver crianças e adolescentes. Nessas situações, o tratamento de dados deverá observar o melhor interesse da criança e do adolescente, além das demais exigências estabelecidas pela legislação aplicável. Antes de uma eventual implantação real, deverão ser definidos procedimentos específicos para informar estudantes, responsáveis e demais envolvidos sobre o tratamento de dados.'],
      ['9. Direitos dos titulares','Nos termos da legislação aplicável, os titulares poderão exercer direitos relacionados aos seus dados pessoais, incluindo, conforme o caso:',['confirmação da existência de tratamento;','acesso aos dados;','correção de informações;','anonimização ou eliminação;','informações sobre compartilhamentos;','revogação do consentimento, quando aplicável;','demais direitos previstos na LGPD.']],
      ['10. Armazenamento e exclusão','Os dados deverão ser armazenados somente pelo período necessário para cumprir sua finalidade, respeitando as obrigações legais aplicáveis. Ao final do período de necessidade, as informações deverão ser eliminadas ou anonimizadas, quando aplicável.'],
      ['11. Alterações desta política','Esta Política de Privacidade poderá ser atualizada durante o desenvolvimento do AEGIS para refletir alterações no sistema, novas funcionalidades ou mudanças na legislação. A versão mais recente deverá estar disponível para consulta pelos usuários.'],
      ['12. Contato','Projeto: AEGIS — Advanced Educational Guardian Intelligence System. Instituição: Escola Técnica Monteiro Lobato — CIMOL. Responsável: Enzo Calegaro Camargo. E-mail: enzo09calegaro@gmail.com.'],
    ];
    return `<div class="privacy-page">${publicHeader(session?'/dashboard':'/login')}<main id="main" class="panel privacy-content" tabindex="-1" aria-labelledby="privacy-title">
          <article>
            <header>
              <h1 id="privacy-title">Política de Privacidade</h1>
              <p class="privacy-meta">AEGIS · Versão 1.0<br>Data: agosto de 2026</p>
            </header>${sections.map(([title,text,list,tail],index)=>`<section aria-labelledby="privacy-section-${index}">
              <h2 id="privacy-section-${index}">${esc(title)}</h2>
              <p>${esc(text)}</p>${list?`<ul>${list.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${tail?`<p>${esc(tail)}</p>`:''}</section>`).join('')}</article>
        </main>
      </div>`;
  }
  function render(options = {}) {
    if (modal.open) closeModal();
    app.innerHTML = renderPrivacy();
    document.title = "Política de Privacidade · AEGIS";
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

  // Formulários e ações próprios desta página.


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
