'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {statistics,buildReport,formatReport} = require('./DeveloperTest.Report.js');
const {classifyObservation,aggregateObservations} = require('./DeveloperTest.js');
const face = (id='alice',status='matched') => ({status,profile:status==='matched'?{id,name:'Private name'}:null,similarity:.78,reason:'Perfil identificado.',quality:{face_pixels:120,minimum_pixels:64,brightness:120,brightness_min:35,brightness_max:225,sharpness:80,minimum_sharpness:20},comparison:{margin:.19,required_margin:.05}});
const record = (expected='alice',faces=[face()],source='camera') => ({at:'2026-10-11T12:00:00Z',source,expected,faces,scale:'auto',threshold:.45,image:{width:1280,height:720},profile_count:1,detection:{width:768,height:432},timings:{total_ms:30,detect_ms:12,recognize_ms:15,decode_ms:3,queue_ms:0},roundtrip:35,observation:classifyObservation(expected,faces)});
const context = {started_at:'2026-10-11T12:00:00Z',ended_at:'2026-10-11T12:01:00Z',duration_ms:60000,requested_seconds:60,end_reason:'completed',profiles:[{id:'alice',name:'Private name',samples:3}],token:'private-token',embeddings:[1,2,3],runtime:{backend:'OpenCV DNN',target:'CPU',opencv:'4.13',threads:2,token:'runtime-token'},camera:{width:1280,height:720,frameRate:30,deviceId:'private-camera'}};

test('estatísticas usam mediana e P95 interpolados e ignoram valores inválidos', () => {
  assert.deepEqual(statistics([1,2,100,null,undefined,NaN,Infinity,'300']),{samples:3,mean:34.33,median:2,p95:90.2,min:1,max:100});
  assert.equal(statistics([]).median,null);
});
test('relatório usa limites medidos e publica revisões diferentes sem presumir regras antigas',()=>{
  const alternative={version:1,revision:'0123456789abcdef',capture:{target_analyses_per_second:2,max_records:42},quality:{brightness_min:60,brightness_max:180}};
  const changed=face();changed.quality={...changed.quality,brightness:50,brightness_min:60,brightness_max:180};
  const item={...record('alice',[changed]),rules:alternative,timings:{total_ms:250}};
  const report=buildReport([item],{...context,rules:alternative},aggregateObservations);
  assert.equal(report.quality_signals.lighting,1);
  assert.equal(report.session.retained_limit,42);
  assert.equal(report.configuration.rule_sets[0].quality.brightness_min,60);
  assert.equal(report.findings.some(s=>s.includes('P95 do processamento')),false);
  const revised=buildReport([item,{...item,rules:{...alternative,revision:'abcdef0123456789'}}],context,aggregateObservations);
  assert.match(revised.findings.join(' '),/regras do serviço mudaram/);
  delete changed.quality.brightness_min;delete changed.quality.brightness_max;
  delete changed.comparison.required_margin;changed.comparison.margin=.01;
  const unknown=buildReport([record('alice',[changed])],context,aggregateObservations);
  assert.equal(unknown.quality_signals.lighting,0);
  assert.equal(unknown.competing_profiles,0);
});
test('confirmação temporal é avaliada separadamente e não transforma aquecimento em precisão',()=>{
  const camera=(status,expected='alice',id='alice')=>({...record(expected),temporal:{status,profile_id:status==='confirmed' ? id : null,new_confirmation:status==='confirmed',confirmation_latency_ms:430}});
  const report=buildReport([camera('pending'),camera('confirmed'),camera('confirmed','__unknown__'),camera('confirmed','alice','bob'),camera('unconfirmed'),record('alice',[face()],'image')],context,aggregateObservations);
  assert.equal(report.frames.total,6);
  assert.equal(report.temporal.frames,5);
  assert.equal(report.temporal.confirmed,3);
  assert.equal(report.temporal.correct_confirmed,1);
  assert.equal(report.temporal.wrong_confirmed,2);
  assert.equal(report.temporal.known_without_confirmation,2);
  assert.equal(report.temporal.confirmation_precision,1/3);
  assert.equal(report.temporal.confirmation_latency_ms.median,430);
  assert.match(formatReport(report),/CONFIRMAÇÃO TEMPORAL/);
  assert.match(report.findings.join(' '),/confirmação temporal incorreta/);
  assert.equal(JSON.stringify(report).includes('alice'),false);
  assert.equal(buildReport([camera('pending')],context,aggregateObservations).temporal.confirmation_precision,null);
});
test('relatório distingue troca de referências com a mesma quantidade de perfis e protege metadados',()=>{
  const provenance={backend_revision:'0123456789abcdef',model_revision:'a'.repeat(40),model_checksums:{YuNet:'b'.repeat(64),SFace:'c'.repeat(64)},token:'secret',names:['Private name']};
  const first={...record(),gallery_revision:'0123456789abcdef',provenance,client_revision:10};
  const second={...record(),gallery_revision:'abcdef0123456789',gallery_changed:true,provenance,observation:{...classifyObservation('',[]),reason:'gallery_changed'}};
  const report=buildReport([first,second],context,aggregateObservations);
  assert.equal(report.evaluation.scored,1);
  assert.equal(report.configuration.gallery_revisions.length,2);
  assert.match(report.findings.join(' '),/quantidade de perfis tenha permanecido igual/);
  assert.match(report.findings.join(' '),/excluídas/);
  assert.equal(report.configuration.provenance[0].backend_revision,provenance.backend_revision);
  assert.equal(JSON.stringify(report).includes('secret'),false);
  assert.equal(JSON.stringify(report).includes('Private name'),false);
});
test('resumo exclui benchmarks e mantém erros de identidade com FP e FN', () => {
  const report = buildReport([record(),record('alice',[face('bob')]),record('alice',[]),record('alice',[face()],'benchmark')],context,aggregateObservations);
  assert.equal(report.frames.total,3);
  assert.equal(report.exclusions.benchmark,1);
  assert.equal(report.evaluation.tp,1);
  assert.equal(report.evaluation.fp,1);
  assert.equal(report.evaluation.fn,2);
  assert.equal(report.evaluation.accuracy,1/3);
  assert.equal(report.examples[0].outcome,'wrong_identity');
});
test('identificações aceitas sem anotação não viram precisão de 100%', () => {
  const report = buildReport([record('',[face()])],context,aggregateObservations);
  assert.equal(report.observed_identification_rate,100);
  assert.equal(report.evaluation.precision,null);
  assert.equal(report.evaluation.scored,0);
  assert.match(formatReport(report),/Precisão: não mensurável/);
  assert.match(report.findings.join(' '),/não a precisão/);
});
test('pessoa desconhecida sem rosto continua excluída e não conta acerto', () => {
  const report = buildReport([record('__unknown__',[])],context,aggregateObservations);
  assert.equal(report.evaluation.tn,0);
  assert.equal(report.frames.annotated,1);
  assert.equal(report.evaluation.scored,0);
  assert.equal(report.frames.no_face,1);
});
test('resumo anonimiza nomes e IDs e não inclui fotos, vetores nem tokens', () => {
  const report = buildReport([record()],context,aggregateObservations);
  const json = JSON.stringify(report);
  assert.equal(json.includes('Private name'),false);
  assert.equal(json.includes('alice'),false);
  assert.equal(json.includes('private-token'),false);
  assert.equal(json.includes('runtime-token'),false);
  assert.equal(json.includes('private-camera'),false);
  assert.equal(json.includes('embeddings'),false);
  assert.equal(report.identifications[0].identity,'Perfil 1');
  assert.match(formatReport(report),/Perfil 1/);
});
test('diagnóstico inclui sinais de baixa qualidade e perfil concorrente', () => {
  const bad = face('alice','low_quality');
  bad.quality = {face_pixels:40,minimum_pixels:64,brightness:10,brightness_min:35,brightness_max:225,sharpness:5,minimum_sharpness:20,reason:'O rosto está cortado.'};
  bad.comparison.margin = .02;
  const report = buildReport([record('alice',[bad])],context,aggregateObservations);
  assert.deepEqual(report.quality_signals,{small:1,lighting:1,blurred:1,cropped:1,pose:0});
  assert.equal(report.competing_profiles,1);
  assert.match(report.findings.join(' '),/baixa nitidez/);
});
test('sinais geométricos de qualidade não dependem do motivo principal em texto',()=>{
  const item=face('alice','low_quality');
  item.quality={...item.quality,reason:'Aproxime o rosto.',face_pixels:40,signals:{cropped:true,pose:true}};
  const report=buildReport([record('alice',[item])],context,aggregateObservations);
  assert.equal(report.quality_signals.cropped,1);
  assert.equal(report.quality_signals.pose,1);
});
test('resumo vazio, interrupção e falhas não produzem métricas inventadas', () => {
  const report = buildReport([],{...context,duration_ms:0,end_reason:'camera_error',errors:[{at:'now',message:'Camera blocked'}]},aggregateObservations);
  assert.equal(report.analyses_per_second,null);
  assert.equal(report.evaluation.accuracy,null);
  assert.match(formatReport(report),/câmera não iniciou/);
  assert.match(formatReport(report),/Nenhuma captura/);
  assert.match(formatReport(report),/Camera blocked/);
});
test('dados de múltiplos perfis, galeria vazia e mudança de galeria aparecem no relatório', () => {
  const empty = {...record(),profile_count:0};
  const multiple = record('alice',[face(),face('bob')]);
  const report = buildReport([empty,multiple],context,aggregateObservations);
  assert.equal(report.frames.multiple_faces,1);
  assert.equal(report.evaluation.excluded,1);
  assert.match(report.findings.join(' '),/galerias diferentes/);
  assert.match(report.findings.join(' '),/sem perfis/);
});

test('rostos desconhecidos sem anotação ainda fornecem exemplos e medições de qualidade', () => {
  const unknown = face('alice','unknown');
  unknown.reason = 'Nenhum perfil atingiu o limiar.';
  const report = buildReport([record('',[unknown])],context,aggregateObservations);
  assert.equal(report.examples.length,1);
  assert.equal(report.examples[0].outcome,'unannotated');
  assert.equal(report.examples[0].faces[0].status,'unknown');
  assert.equal(report.quality_statistics.face_pixels.median,120);
  assert.equal(report.quality_statistics.brightness.min,120);
  assert.equal(report.quality_statistics.sharpness.max,80);
  assert.match(formatReport(report),/Tamanho do rosto \(px\) — mediana: 120/);
  assert.equal(report.evaluation.accuracy,null);
});
