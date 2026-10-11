'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTracker}=require('./DeveloperTest.Temporal.js');
const rules={min_samples:3,min_span_ms:400,window_ms:2000,max_gap_ms:1000,max_response_age_ms:1500,min_overlap:.3};
const face=(id='alice',x=100)=>({status:'matched',profile:{id},box:{x,y:100,width:120,height:120}});
const frame=(at,faces=[face()],context='session')=>({faces,image:{width:640,height:480},captured_at_ms:at,received_at_ms:at+30,context});
test('confirma somente após concordância recente e intervalo mínimo',()=>{
  const t=createTracker(rules);
  assert.equal(t.step(frame(0)).status,'pending');
  assert.equal(t.step(frame(200)).status,'pending');
  const c=t.step(frame(400));
  assert.equal(c.status,'confirmed');assert.equal(c.new_confirmation,true);assert.equal(c.confirmation_latency_ms,430);
  assert.equal(t.step(frame(600)).new_confirmation,false);
});
for (const [name,faces] of [['ausência',[]],['múltiplos',[face(),face('bob')]],['qualidade',[{...face(),status:'low_quality'}]],['incerto',[{...face(),status:'uncertain'}]],['desconhecido',[{...face(),status:'unknown'}]]]) {
  test('limpa confirmação em '+name,()=>{
    const t=createTracker(rules);[0,200,400].forEach(at=>t.step(frame(at)));
    assert.equal(t.step(frame(600,faces)).status,'unconfirmed');
    assert.equal(t.step(frame(800)).samples,1);
  });
}
test('troca de identidade, posição, galeria e interrupção reiniciam concordância',()=>{
  const t=createTracker(rules);[0,200,400].forEach(at=>t.step(frame(at)));
  assert.equal(t.step(frame(600,[face('bob')])).samples,1);
  assert.equal(t.step(frame(800,[face('bob',400)])).samples,1);
  assert.equal(t.step(frame(1000,[face('bob',400)],'other-gallery')).samples,1);
  t.reset();assert.equal(t.step(frame(1200)).samples,1);
});
test('respostas antigas, fora de ordem e capturas com intervalos longos não confirmam',()=>{
  const t=createTracker(rules);[0,200,400].forEach(at=>t.step(frame(at)));
  assert.equal(t.step({...frame(600),received_at_ms:2200}).status,'discarded');
  assert.equal(t.step(frame(800)).samples,1);
  assert.equal(t.step(frame(700)).status,'discarded');
  assert.equal(t.step(frame(1000)).samples,1);
  assert.equal(t.step(frame(2100)).samples,1);
});
test('janela temporal remove capturas antigas e frequência alta respeita intervalo mínimo',()=>{
  const t=createTracker(rules);
  [0,50,100].forEach(at=>assert.equal(t.step(frame(at)).status,'pending'));
  assert.equal(t.step(frame(400)).status,'confirmed');
  [1300,2200].forEach(at=>assert.equal(t.step(frame(at)).status,'confirmed'));
  assert.equal(t.step(frame(3100)).samples,3);
});
test('geometria usa proporções da imagem e rejeita caixas inválidas',()=>{
  const t=createTracker(rules);t.step(frame(0));t.step(frame(200));
  const scaled={...frame(400,[{...face(),box:{x:200,y:200,width:240,height:240}}]),image:{width:1280,height:960}};
  assert.equal(t.step(scaled).status,'confirmed');
  assert.equal(t.step(frame(600,[{...face(),box:{x:0,y:0,width:0,height:2}}])).status,'unconfirmed');
});
