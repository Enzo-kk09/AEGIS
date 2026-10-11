'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('./AegisShared.js');
const state = () => shared.defaultState();

test('preserva cadastros válidos e imagens conhecidas', () => {
  const saved = state();
  const result = shared.parseState(saved);
  assert.deepEqual(result.students, saved.students);
  assert.deepEqual(result.settings, saved.settings);
});

test('migra preferências opcionais e horários ausentes sem perder alunos', () => {
  const saved = state();
  delete saved.settings.humanReview;
  delete saved.settings.twoFactor;
  delete saved.settings.role;
  delete saved.students[0].last;
  const result = shared.parseState(saved);
  assert.equal(result.students.length, 8);
  assert.equal(result.students[0].last, '—');
  assert.equal(result.settings.humanReview, true);
  assert.equal(result.settings.twoFactor, true);
  assert.equal(result.settings.role, 'Administrador');
});

test('rejeita IDs duplicados e matrículas iguais ignorando caixa', () => {
  const saved = state();
  saved.students[1].id = saved.students[0].id;
  assert.throws(() => shared.parseState(saved));
  saved.students[1].id = 's2';
  saved.students[0].enrollment = 'A123';
  saved.students[1].enrollment = 'a123';
  assert.throws(() => shared.parseState(saved));
});

test('notas com chaves de protótipo não são aceitas', () => {
  const saved = state();
  saved.notes = JSON.parse('{"__proto__":"injetado"}');
  assert.throws(() => shared.parseState(saved));
  saved.notes = { constructor:'injetado' };
  assert.throws(() => shared.parseState(saved));
});

test('notas válidas não herdam propriedades', () => {
  const saved = state();
  saved.notes = { m1:'Nota salva' };
  const notes = shared.parseState(saved).notes;
  assert.equal(Object.getPrototypeOf(notes), null);
  assert.equal(notes.m1, 'Nota salva');
  assert.equal(notes.toString, undefined);
});

test('remove campos desconhecidos e URLs de fotos inseguras', () => {
  const saved = state();
  saved.students[0].photo = 'javascript:alert(1)';
  saved.students[0].extra = 'valor';
  saved.settings.extra = true;
  saved.extra = true;
  const result = shared.parseState(saved);
  assert.equal(result.students[0].photo, '');
  assert.equal(result.students[0].extra, undefined);
  assert.equal(result.settings.extra, undefined);
  assert.equal(result.extra, undefined);
});

test('rejeita horários objetos e preferências fora dos limites', () => {
  const saved = state();
  saved.students[0].last = { html:'<img>' };
  assert.throws(() => shared.parseState(saved));
  saved.students[0].last = '12:00';
  saved.settings.threshold = 101;
  assert.throws(() => shared.parseState(saved));
  saved.settings.threshold = 80;
  saved.settings.twoFactor = 'true';
  assert.throws(() => shared.parseState(saved));
});

test('armazenamento bloqueado retorna exemplos e aviso', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = shared.loadState(() => { throw new Error('bloqueado'); });
    assert.equal(result.problem, true);
    assert.equal(result.state.students.length, 8);
    assert.equal(shared.readSession(() => { throw new Error('bloqueado'); }), null);
  } finally { console.warn = warn; }
});

test('sessão inválida não libera navegação protegida', () => {
  for (const institution of ['', '   ', 123, {}, 'x'.repeat(81)]) {
    assert.equal(shared.readSession({getItem:() => JSON.stringify({institution})}), null);
  }
  assert.deepEqual(shared.readSession({getItem:() => '{"institution":" CIMOL "}'}), {institution:'CIMOL'});
});

test('salvar de aba desatualizada preserva dados recentes', () => {
  const original=JSON.stringify(state());
  let stored=original;
  const storage={getItem:()=>stored,setItem:(_,value)=>{stored=value;}};
  const first=shared.loadState(storage);
  const second=shared.loadState(storage);
  second.state.notes.m1='Gravado pela segunda aba';
  const latest=shared.saveState(storage,second.state,second.serialized);
  first.state.notes.m1='Tentativa da primeira aba';
  assert.throws(()=>shared.saveState(storage,first.state,first.serialized),{name:'StateConflictError'});
  assert.equal(stored,latest.serialized);
  assert.equal(JSON.parse(stored).notes.m1,'Gravado pela segunda aba');
});

test('falha de gravação não altera estado de entrada', () => {
  const saved=state();
  const original=JSON.stringify(saved);
  const storage={getItem:()=>original,setItem:()=>{throw new Error('quota');}};
  assert.throws(()=>shared.saveState(storage,saved,original));
  assert.equal(JSON.stringify(saved),original);
});

test('dados corrompidos não são substituídos pelos exemplos ao salvar', () => {
  for(const corrupted of ['{','null',JSON.stringify({...state(),students:'inválido'})]){
    let stored=corrupted;
    const storage={getItem:()=>stored,setItem:(_,value)=>{stored=value;}};
    const warn=console.warn;
    console.warn=()=>{};
    let loaded;
    try{loaded=shared.loadState(storage);}finally{console.warn=warn;}
    assert.equal(loaded.problem,true);
    assert.throws(()=>shared.saveState(storage,loaded.state,loaded.serialized),{name:'StateRecoveryError'});
    assert.equal(stored,corrupted);
  }
});

test('CSV protege fórmulas precedidas por espaços e BOM', () => {
  for (const text of ['=1', ' +1', '\t@SUM(A1)', '\uFEFF-10', '\r\n=1']) {
    assert.ok(shared.csvCell(text).startsWith('"\''));
  }
  assert.equal(shared.csvCell('Ana;"Silva"'), '"Ana;""Silva"""');
});

test('escape HTML mantém conteúdo como texto', () => {
  assert.equal(shared.esc('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});

test('rotas e ícones ignoram propriedades herdadas', () => {
  for (const name of ['constructor','toString','__proto__']) {
    assert.equal(shared.pageHref(name), 'index.html');
    assert.equal(shared.icon(name), shared.icon('info'));
  }
  assert.equal(shared.pageHref('students'), 'Alunos.html');
});

test('dia e rótulo de data respeitam São Paulo no limite UTC', () => {
  assert.equal(shared.today(new Date('2026-01-01T02:59:00Z')), '2025-12-31');
  assert.equal(shared.today(new Date('2026-01-01T03:00:00Z')), '2026-01-01');
  assert.match(shared.dateLabel('2026-10-03'), /3.*out.*2026/);
  assert.equal(shared.dateLabel(''), 'Data inválida');
  assert.equal(shared.dateLabel('2026-02-31'), 'Data inválida');
  assert.equal(shared.dateLabel('2025-02-29'), 'Data inválida');
  assert.notEqual(shared.dateLabel('2024-02-29'), 'Data inválida');
});
