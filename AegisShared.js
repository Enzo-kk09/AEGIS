'use strict';

(() => {
  const images = bundledImages();
  const imageSource = value => images[value] || value;
  const STORAGE_KEY = 'aegis.frontend.v1';
  const SESSION_KEY = 'aegis.demo.session';
  const paths = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    users:'<path d="M3 21v-3a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v3m2-8a4 4 0 0 1 4 4v3"/><circle cx="9.5" cy="6" r="3.5"/><path d="M17 3a3 3 0 0 1 0 6"/>',
    user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3"/>',
    chart:'<path d="M4 3v17h17M7 14l4-5 4 3 5-8"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3Zm-8 13h4"/>',
    file:'<path d="M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8Zm0 0v6h6M8 12h8M8 16h8"/>',
    camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3m0 3h.01"/>',
    settings:'<path d="m9 3-.7 2.4-2.4.9-2.2-.8-2 3.5 1.7 1.7v2.7L1.7 15l2 3.5 2.2-.8 2.4.9L9 21h4l.7-2.4 2.4-.9 2.2.8 2-3.5-1.7-1.7v-2.7L20.3 9l-2-3.5-2.2.8-2.4-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    check:'<path d="m5 12 4 4L20 5"/>',
    checkcircle:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    alert:'<path d="M12 3 2 21h20ZM12 9v5m0 3h.01"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    cloud:'<path d="M7 19a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11Z"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    down:'<path d="m6 9 6 6 6-6"/>',
    move:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
    filter:'<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="m3 3 18 18M10 5c6-1 12 7 12 7l-3 4M6 6c-3 2-4 6-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
    edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15ZM13 21h8"/>',
    trash:'<path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    logout:'<path d="M9 3H4v18h5m5-14 5 5-5 5m-7-5h12"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    save:'<path d="M4 3h13l3 3v15H4ZM8 3v6h8V3M8 21v-7h8v7"/>',
    server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01m4-11h6m-6 11h6"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/>',
    refresh:'<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
    message:'<path d="M3 3h18v14H8l-5 4ZM7 7h10M7 11h7"/>',
    print:'<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6Z"/>',
    back:'<path d="m14 5-7 7 7 7m-7-7h14"/>',
    arrow:'<path d="M3 12h18m-7-7 7 7-7 7"/>'
  };
  const icon = (name, cls='') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Object.hasOwn(paths,name) ? paths[name] : paths.info}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const copy = value => JSON.parse(JSON.stringify(value));
  const uid = () => globalThis.crypto?.randomUUID?.() || `aegis-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const now = () => new Date().toISOString();
  const clockFormat = new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'});
  const timestampFormat = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'});
  const calendarFormat = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'});
  const labelFormat = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric',timeZone:'America/Sao_Paulo'});
  const time = value => clockFormat.format(value ? new Date(value) : new Date());
  const dateTime = value => timestampFormat.format(new Date(value));
  const today = (value = new Date()) => calendarFormat.format(value);
  const dateLabel = value => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Data inválida';
    const date=new Date(value+'T12:00:00-03:00');
    if(!Number.isFinite(date.getTime())||calendarFormat.format(date)!==value)return 'Data inválida';
    return labelFormat.format(date);
  };
  const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase();
  const validImage = value => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageSource(value) || '');
  const seedStudents = [
    {id:'s1',name:'Roberto Almeida',enrollment:'2026001',className:'INFO 62',email:'',status:'active',photo:'./assets/roberto.png',last:'12:58'},
    {id:'s2',name:'Laura Braga',enrollment:'2026002',className:'INFO 62',email:'',status:'active',photo:'./assets/laura.png',last:'12:41'},
    {id:'s3',name:'Gabriel Pereira',enrollment:'2026003',className:'INFO 63',email:'',status:'active',photo:'./assets/gabriel.png',last:'13:50'},
    {id:'s4',name:'Augusto Barbosa',enrollment:'2026004',className:'INFO 62',email:'',status:'active',photo:'',last:'12:42'},
    {id:'s5',name:'Arthur Ribeiro',enrollment:'2026005',className:'INFO 63',email:'',status:'active',photo:'',last:'13:51'},
    {id:'s6',name:'Alan Zimmer',enrollment:'2026006',className:'INFO 62',email:'',status:'active',photo:'',last:'12:48'},
    {id:'s7',name:'Pedro Klein',enrollment:'2026007',className:'INFO 63',email:'',status:'inactive',photo:'',last:'—'},
    {id:'s8',name:'Julia Santos',enrollment:'2026008',className:'INFO 63',email:'',status:'inactive',photo:'',last:'—'}
  ];
  const defaultState = () => ({version:1,students:copy(seedStudents),notes:{},requests:[],tickets:[],events:[],audit:[],settings:{recognition:true,threshold:80,uncertainAlert:true,humanReview:true,twoFactor:true,role:'Administrador',consultaDays:'1'},lastUpdated:now()});
  const pageFiles = {
    "login": "index.html",
    "request": "SolicitarAcesso.html",
    "privacy": "Privacidade.html",
    "dashboard": "DadosGerais.html",
    "movement": "Movimentacao.html",
    "prb": "PRB.html",
    "report": "Relatorio.html",
    "identifications": "Identificacoes.html",
    "events": "Eventos.html",
    "students": "Alunos.html",
    "help": "Suporte.html",
    "settings": "Configuracoes.html"
};
  const pageHref = name => Object.hasOwn(pageFiles,name) ? pageFiles[name] : pageFiles.login;
  const pages = {
    "dashboard": [
        "Dados gerais",
        "Acompanhe as identificações e os pontos de acesso da instituição."
    ],
    "movement": [
        "Movimentação dos alunos",
        "Consulte entradas, saídas e observações administrativas."
    ],
    "prb": [
        "Área PRB",
        "Consulta restrita a pessoas autorizadas."
    ],
    "report": [
        "Relatório geral",
        "Uma visão consolidada das identificações e do sistema."
    ],
    "identifications": [
        "Identificações",
        "Consulte os registros e acompanhe a atividade ao longo do dia."
    ],
    "events": [
        "Eventos",
        "Registro das ações realizadas na plataforma."
    ],
    "students": [
        "Alunos",
        "Gerencie os cadastros e as turmas da instituição."
    ],
    "help": [
        "Ajuda e suporte",
        "Encontre orientações ou registre uma solicitação."
    ],
    "settings": [
        "Configurações",
        "Gerencie as preferências da instituição."
    ]
};
  const sideLinks = [["dashboard","grid","Dados gerais"],["identifications","scan","Identificações"],["events","activity","Eventos"],["students","users","Alunos"]];
  paths.scan = "<path d=\"M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5\"/><circle cx=\"12\" cy=\"9\" r=\"3\"/><path d=\"M7 18v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2\"/>";
  const cameras = [
    {
        "id": "cam01",
        "location": "Entrada principal",
        "studentId": null,
        "name": "Pessoa desconhecida",
        "photo": "./assets/desconhecido.png",
        "status": "unknown",
        "at": "12:43:39"
    },
    {
        "id": "cam02",
        "location": "Corredor B",
        "studentId": "s1",
        "photo": "./assets/roberto.png",
        "status": "confirmed",
        "at": "12:58:04"
    },
    {
        "id": "cam03",
        "location": "Corredor 2C",
        "studentId": "s2",
        "photo": "./assets/laura.png",
        "status": "confirmed",
        "at": "12:41:59"
    },
    {
        "id": "cam04",
        "location": "Biblioteca",
        "studentId": "s3",
        "photo": "./assets/gabriel.png",
        "status": "uncertain",
        "at": "13:50:47"
    }
];
  const brand = () => `<div class="brand"><span class="brand-mark"><img src="${images['./assets/aegis-logo.png']}" alt=""></span><div><div class="brand-name">AEGIS</div><div class="brand-sub">Advanced Educational Guardian<br>Intelligence System</div></div></div>`;
  const demoBadge = () => `<span class="badge blue">${icon('info')}Ambiente de demonstração</span>`;
  const badge = (status) => ({confirmed:`<span class="badge success">${icon('checkcircle')}Identificado</span>`,uncertain:`<span class="badge warning">${icon('help')}Identificação incerta</span>`,unknown:`<span class="badge danger">${icon('alert')}Não identificado</span>`,active:`<span class="badge success">${icon('checkcircle')}Ativo</span>`,inactive:`<span class="badge">${icon('user')}Inativo</span>`}[status] || '');
  const photoMarkup = (src, alt, cls='') => validImage(src)
    ? `<img class="${cls}" src="${esc(imageSource(src))}" alt="${esc(alt)}">`
    : `<span class="${cls} image-blank" role="img" aria-label="Sem foto"></span>`;
  const avatar = (student) => validImage(student.photo) ? `<img class="avatar" src="${esc(imageSource(student.photo))}" alt="Foto de ${esc(student.name)}">` : `<span class="avatar" role="img" aria-label="${esc(student.name)}: sem foto">${esc(initials(student.name))}</span>`;
  const empty = (title,text,type='search') => `<div class="empty-state"><div class="empty-icon">${icon(type)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
  const head = (title,subtitle='',extra='',label='') => `<header class="page-heading"><div><span class="eyebrow">${esc(label || 'Console da instituição')}</span><h1 id="page-title">${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="heading-side">${extra}</div></header>`;
  const tabs = route => `<nav class="workspace-tabs" aria-label="Dados gerais">${[['dashboard','grid','Visão geral'],['movement','move','Movimentação'],['prb','shield','PRB'],['report','file','Relatório']].map(([r,i,n])=>`<a class="tab ${route===r?'active':''}" href="${pageHref(r)}" ${route===r?'aria-current="page"':''}>${icon(i)}${n}</a>`).join('')}</nav>`;
  function publicHeader(back='/login') { return `<header class="public-header">${brand()}<a class="btn" href="${pageHref(back.replace(/^\//, ''))}">${icon('back')}Retornar</a>
      </header>`; }

  function renderShell({route, menuOpen, state, session, filters, storageProblem, content}) {
    const active = ['dashboard','movement','prb','report'].includes(route) ? 'dashboard' : route;
    const navLink = (r,i,n) => `<a class="nav-item ${active===r?'active':''}" href="${pageHref(r)}" ${active===r?'aria-current="page"':''}>${icon(i)}<span>${n}</span>${active===r?'<span class="nav-active-mark" aria-hidden="true"></span>':''}</a>`;
    return `<div class="app-shell">
      <button class="sidebar-scrim ${menuOpen?'visible':''}" data-action="close-menu" aria-label="Fechar menu"></button>
      <aside class="sidebar ${menuOpen?'open':''}" id="sidebar" aria-label="Navegação e informações da instituição">
        <button class="icon-button sidebar-close" data-action="close-menu" aria-label="Fechar menu">${icon('close')}</button>
        <header class="sidebar-brand">${brand()}</header>
        <p class="nav-section">Workspace</p><nav class="side-nav" aria-label="Menu principal">${sideLinks.map(([r,i,n])=>navLink(r,i,n)).join('')}</nav>
        <div class="side-divider"></div><p class="nav-section">Laboratório</p>
        <nav class="side-nav" aria-label="Desenvolvimento"><a class="nav-item" href="DeveloperTest.html"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/></svg><span>Developer Test</span><span class="nav-tag">DEV</span></a></nav>
        <div class="side-divider"></div><p class="nav-section">Administração</p><nav class="side-nav" aria-label="Administração">${navLink('settings','settings','Configurações')}${navLink('help','help','Ajuda e suporte')}</nav>
        <div class="sidebar-bottom"><div class="sync-panel"><span class="eyebrow">Registros locais</span><time class="sync-time" datetime="${esc(state.lastUpdated)}">${time(state.lastUpdated)}</time><small>${icon('checkcircle')}Última atualização</small></div><p>AEGIS / Console v1.0</p></div>
      </aside>
      <div class="workspace"><header class="topbar">
        <button class="icon-button mobile-menu" data-action="toggle-menu" aria-label="Abrir menu principal" aria-expanded="${menuOpen}" aria-controls="sidebar">${icon('menu')}</button>
        <span class="console-breadcrumb">Instituição <span aria-hidden="true">/</span> <strong>${esc(pages[route]?.[0] || 'Console')}</strong></span>
        <form id="global-search-form" class="search-input global-search" role="search" aria-label="Busca geral">${icon('search')}<input class="input" type="search" name="query" aria-label="Buscar alunos ou câmeras" placeholder="Buscar alunos ou câmeras…" maxlength="100" value="${esc(filters.studentQuery && route==='students'?filters.studentQuery:'')}"></form>
        <div class="topbar-actions"><button class="icon-button notify" data-action="notifications" aria-label="Ver notificações">${icon('bell')}${state.events.length?'<span class="notification-dot"></span>':''}</button><div class="system-status" title="Dados demonstrativos armazenados no navegador"><span class="status-dot"></span><span>Demonstração</span></div><button class="profile-button" data-action="profile" aria-label="Abrir perfil da instituição"><span class="avatar">${esc(initials(session.institution))}</span><span class="profile-label">${esc(session.institution)}<small>Administrador</small></span>${icon('down')}</button></div>
      </header><main class="main-content" id="main" tabindex="-1" aria-labelledby="page-title">${storageProblem?`<div class="info-box warning">${icon('alert')}<span>Os dados locais não puderam ser carregados. Esta sessão está usando os exemplos iniciais. Verifique o armazenamento do navegador.</span></div>`:''}${content}</main><footer class="app-footer"><span>AEGIS / Gestão e inteligência educacional</span><a href="Privacidade.html">Privacidade e dados</a></footer></div></div>`;
  }

  const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
  const textField = (record, name, limit) => typeof record[name] === 'string' && record[name].length <= limit;
  const validDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
  function parseState(saved) {
    if (!plainObject(saved) || saved.version !== 1) throw new Error('Dados locais incompatíveis.');
    for (const key of ['students','requests','tickets','events','audit']) {
      if (!Array.isArray(saved[key]) || saved[key].length > 10000) throw new Error('Lista local inválida.');
      const ids = new Set();
      for (const record of saved[key]) {
        if (!plainObject(record) || !safeId(record.id) || ids.has(record.id)) throw new Error('Identificador local inválido.');
        ids.add(record.id);
      }
    }
    const students = saved.students.map(student => {
      if (!textField(student,'name',100) || student.name.trim().length < 3 || !textField(student,'enrollment',20) || !/^[A-Za-z0-9-]+$/.test(student.enrollment) || !textField(student,'className',40) || !student.className.trim() || !textField(student,'email',120) || !textField(student,'photo',1200000) || !['active','inactive'].includes(student.status)) throw new Error('Cadastro local inválido.');
      if (student.last !== undefined && !textField(student,'last',80)) throw new Error('Horário local inválido.');
      const knownPhoto=seedStudents.some(seed=>seed.photo&&seed.photo===student.photo);
      return { id:student.id,name:student.name,enrollment:student.enrollment,className:student.className,email:student.email,status:student.status,photo:validImage(student.photo)||knownPhoto ? student.photo : '',last:student.last || '—' };
    });
    const enrollments = students.map(student => normalize(student.enrollment));
    if (new Set(enrollments).size !== enrollments.length) throw new Error('Matrículas locais duplicadas.');
    const settings = saved.settings;
    if (!plainObject(settings) || typeof settings.recognition !== 'boolean' || typeof settings.uncertainAlert !== 'boolean' || !Number.isInteger(settings.threshold) || settings.threshold < 50 || settings.threshold > 100 || !['1','7','30'].includes(settings.consultaDays) || !validDate(saved.lastUpdated)) throw new Error('Preferências locais inválidas.');
    for (const field of ['humanReview','twoFactor']) if (settings[field] !== undefined && typeof settings[field] !== 'boolean') throw new Error('Preferência local inválida.');
    if (settings.role !== undefined && !textField(settings,'role',80)) throw new Error('Perfil local inválido.');
    if (!plainObject(saved.notes) || Object.keys(saved.notes).length > 10000) throw new Error('Observações locais inválidas.');
    const notes = Object.create(null);
    for (const [id, value] of Object.entries(saved.notes)) {
      if (!safeId(id) || typeof value !== 'string' || value.length > 500) throw new Error('Observação local inválida.');
      notes[id] = value;
    }
    const records = (key, fields) => saved[key].map(record => {
      if (!validDate(record.at) || !Object.entries(fields).every(([field,limit]) => textField(record,field,limit))) throw new Error('Registro local inválido.');
      const item = {id:record.id};
      Object.keys(fields).forEach(field => { item[field]=record[field]; });
      item.at = record.at;
      return item;
    });
    const events = records('events',{title:200,description:1500,type:40});
    if (events.some(event => !['info','success','warning','danger'].includes(event.type))) throw new Error('Tipo de evento inválido.');
    return { version:1,students,notes,requests:records('requests',{protocol:100,name:100,email:120,institution:120,role:80,reason:1500}),tickets:records('tickets',{protocol:100,need:1500,institution:120}),events:events.slice(0,100),audit:records('audit',{user:120,action:1500}).slice(0,100),settings:{recognition:settings.recognition,threshold:settings.threshold,uncertainAlert:settings.uncertainAlert,humanReview:settings.humanReview ?? true,twoFactor:settings.twoFactor ?? true,role:settings.role ?? 'Administrador',consultaDays:settings.consultaDays},lastUpdated:saved.lastUpdated };
  }
  function loadState(storage) {
    let serialized = null;
    try {
      const target=typeof storage === 'function' ? storage() : storage;
      serialized=target.getItem(STORAGE_KEY);
      return {state:serialized ? parseState(JSON.parse(serialized)) : defaultState(),problem:false,serialized};
    } catch { console.warn('AEGIS: dados locais indisponíveis ou incompatíveis.'); return {state:defaultState(),problem:true,serialized}; }
  }
  function readSession(storage) {
    try {
      const target=typeof storage === 'function' ? storage() : storage;
      const saved=JSON.parse(target.getItem(SESSION_KEY)||'null');
      if (plainObject(saved) && typeof saved.institution === 'string' && saved.institution.trim() && saved.institution.length <= 80) return {institution:saved.institution.trim()};
    } catch {}
    return null;
  }
  function saveState(storage,next,snapshot) {
    const target=typeof storage === 'function' ? storage() : storage;
    if(target.getItem(STORAGE_KEY)!==snapshot){const error=new Error('Os dados mudaram em outra aba. Atualize a página antes de salvar.');error.name='StateConflictError';throw error;}
    if(snapshot!==null){
      try{parseState(JSON.parse(snapshot));}
      catch{const error=new Error('Os dados locais não puderam ser carregados. Para evitar perda de informações, restaure o armazenamento e atualize a página antes de salvar.');error.name='StateRecoveryError';throw error;}
    }
    const state=parseState({...next,lastUpdated:now()});
    const serialized=JSON.stringify(state);
    target.setItem(STORAGE_KEY,serialized);
    return {state,serialized};
  }
  const csvCell = value => {
    let text=String(value??'');
    if (/^[\s\uFEFF]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  function downloadCSV(filename,rows) {
    const data='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function fileData(file) {
    if(!file || !file.size)return null;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Escolha uma imagem PNG, JPG ou WEBP.');
    if(file.size>800*1024)throw new Error('A imagem precisa ter até 800 KB.');
    if (typeof createImageBitmap === 'function') {
      let bitmap;
      try {
        bitmap=await createImageBitmap(file);
        if(bitmap.width*bitmap.height>8000000 || Math.max(bitmap.width,bitmap.height)>8192)throw new Error('Use uma foto com até 8 megapixels e até 8.192 pixels por lado.');
      } catch(error) {throw new Error(error.message.includes('megapixels')?error.message:'O arquivo não contém uma imagem válida.');}
      finally {bitmap?.close();}
    }
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));reader.readAsDataURL(file);});
  }
  function bundledImages() {
    return {
    "./assets/aegis-logo.png": "data:image/png;base64,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",
};
  }
  const api = Object.freeze({images,imageSource,STORAGE_KEY,SESSION_KEY,paths,icon,esc,normalize,copy,uid,now,time,dateTime,today,dateLabel,initials,validImage,defaultState,seedStudents,brand,demoBadge,badge,photoMarkup,avatar,empty,head,tabs,publicHeader,renderShell,pageFiles,pageHref,pages,sideLinks,cameras,parseState,loadState,saveState,readSession,csvCell,downloadCSV,fileData});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.AegisShared = api;
})();
