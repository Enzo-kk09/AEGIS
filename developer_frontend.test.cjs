'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyObservation, aggregateObservations, csvCell, summarizeBenchmark, comparableBenchmark, validateRules } = require('./DeveloperTest.js');
const matched = id => ({ status:'matched', profile:{ id, name:id } });
const rules = () => ({version:1,revision:'0123456789abcdef',
  decision:{default_threshold:.42,min_threshold:.32,max_threshold:.8,uncertainty_band:.08,identity_margin:.07},
  quality:{recognition_min_pixels:80,enrollment_min_pixels:110,recognition_min_sharpness:25,enrollment_min_sharpness:40,brightness_min:60,brightness_max:180,crop_tolerance:.03,min_eye_ratio:.12},
  enrollment:{max_references:4,consistency_min:.4,duplicate_face_min:.45,redundancy_min:.985},
  upload:{max_bytes:4e6,max_pixels:4e6,max_edge:4096,min_edge:32},
  detector:{auto_edge:640,retry_edge:1280,refine_below_pixels:100,refine_min_overlap:.4,max_processed_faces:6,scales:[1,.5]},
  capture:{target_analyses_per_second:4,min_interval_ms:120,max_records:500,camera_width:640,camera_height:480,jpeg_quality:.9,session_durations:[30,60]},
  benchmark:{min_iterations:1,max_iterations:3,warmups:1},
  temporal:{min_samples:3,min_span_ms:400,window_ms:2000,max_gap_ms:1000,max_response_age_ms:1500,min_overlap:.3}});

test('regras alternativas são aceitas e copiadas sem incluir dados privados', () => {
  const input=rules();input.token='secret';input.quality.private='secret';
  const copy=validateRules(input);
  assert.equal(copy.decision.uncertainty_band,.08);
  assert.equal(JSON.stringify(copy).includes('secret'),false);
  input.detector.scales.push(.1);
  assert.deepEqual(copy.detector.scales,[1,.5]);
});
for (const [name,change] of [
  ['versão incompatível',r=>r.version=2],['revisão ausente',r=>delete r.revision],
  ['limiar fora de faixa',r=>r.decision.default_threshold=.9],['regra ausente',r=>delete r.quality.brightness_min],
  ['valor inválido',r=>r.capture.target_analyses_per_second=NaN],['JPEG inválido',r=>r.capture.jpeg_quality=2],
  ['escala inválida',r=>r.detector.scales=[0]],['duração inválida',r=>r.capture.session_durations=[0]],
  ['intervalo de luz invertido',r=>r.quality.brightness_min=200],['limite semântico inválido',r=>r.enrollment.max_references=0]
]) test('rejeita '+name,()=>{const input=rules();change(input);assert.equal(validateRules(input),null);});

test('a pessoa esperada identificada é verdadeiro positivo', () => {
  assert.deepEqual(classifyObservation('alice', [matched('alice')]), { scored:true, correct:true, tp:1, fp:0, fn:0, tn:0, reason:'true_positive' });
});

test('identidade incorreta conta falso positivo e falso negativo', () => {
  const observation = classifyObservation('alice', [matched('bob')]);
  assert.equal(observation.fp, 1);
  assert.equal(observation.fn, 1);
  assert.equal(observation.correct, false);
});

test('rosto esperado ausente conta falso negativo', () => {
  assert.equal(classifyObservation('alice', []).fn, 1);
  assert.equal(classifyObservation('alice', [{ status:'low_quality' }]).fn, 1);
});

test('pessoa desconhecida corretamente rejeitada é verdadeiro negativo', () => {
  assert.equal(classifyObservation('__unknown__', [{ status:'unknown' }]).tn, 1);
  assert.equal(classifyObservation('__unknown__', [matched('alice')]).fp, 1);
});

test('sem anotação e múltiplos rostos não geram pontuação', () => {
  assert.equal(classifyObservation('', [matched('alice')]).scored, false);
  assert.equal(classifyObservation('alice', [matched('alice'), matched('bob')]).scored, false);
  assert.equal(classifyObservation('__unknown__', []).scored, false);
});

test('métricas agregadas mantêm denominadores e identidade incorreta', () => {
  const records = [{ expected:'alice', faces:[matched('alice')] }, { expected:'alice', faces:[matched('bob')] }, { expected:'alice', faces:[] }, { expected:'__unknown__', faces:[{ status:'unknown' }] }, { expected:'', faces:[] }];
  const metrics = aggregateObservations(records);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 1 / 3);
  assert.equal(metrics.accuracy, 0.5);
  assert.equal(metrics.scored, 4);
  assert.equal(metrics.excluded, 1);
});

test('sem medições válidas as métricas não inventam resultados', () => {
  const metrics = aggregateObservations([]);
  assert.equal(metrics.precision, null);
  assert.equal(metrics.recall, null);
  assert.equal(metrics.accuracy, null);
});

test('CSV escapa aspas, delimitadores e fórmulas de planilha', () => {
  assert.equal(csvCell('Ana; "A"\nSilva'), '"Ana; ""A""\nSilva"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('\t+1'), '"\'\t+1"');
  assert.equal(csvCell(null), '""');
});

test('benchmark só pontua quando tem rostos completos', () => {
  const results = summarizeBenchmark([{ scale:1, faces:[matched('alice')] }, { scale:0.1, faces:0 }], 'alice');
  assert.equal(results[0].observation.tp, 1);
  assert.equal(results[0].faceCount, 1);
  assert.equal(results[1].observation, null);
});

test('benchmark destaca velocidade somente quando preserva o resultado da referência', () => {
  const rows = [
    {scale:1, mean_ms:100, faces:[matched('alice')]},
    {scale:.5, mean_ms:50, faces:[matched('alice')]},
    {scale:.25, mean_ms:20, faces:[matched('bob')]},
    {scale:.1, mean_ms:10, faces:[]}
  ];
  assert.equal(comparableBenchmark(rows), rows[1]);
  assert.equal(comparableBenchmark([{scale:1, mean_ms:100, faces:[]}]), null);
  assert.equal(comparableBenchmark([{scale:1, mean_ms:100, faces:[{status:'low_quality'}]}]), null);
});

test('benchmark considera automático e mediana, excluindo decisões instáveis', () => {
  const reference = {scale:1, median_ms:100, mean_ms:100, stable:true, faces:[matched('alice')]};
  const automatic = {scale:'auto', median_ms:30, mean_ms:90, stable:true, faces:[matched('alice')]};
  const fixed = {scale:.5, median_ms:50, mean_ms:50, stable:true, faces:[matched('alice')]};
  const unstable = {scale:.1, median_ms:10, mean_ms:10, stable:false, faces:[matched('alice')]};
  assert.equal(comparableBenchmark([reference,automatic,fixed,unstable]), automatic);
  assert.equal(comparableBenchmark([{...reference,stable:false},automatic]), null);
});
