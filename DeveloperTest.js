'use strict';

(() => {
  // Offline selection has a conservative browser guard; active processing
  // always uses the validated rule set returned by the Python service.
  const OFFLINE_MAX_BYTES = 8 * 1024 * 1024;
  let MAX_RECORDS = 0;
  const validateRules = value => {
    if (value?.version !== 1 || !/^[a-f0-9]{16}$/.test(value.revision || '')) return null;
    const fields = {
      decision:['default_threshold','min_threshold','max_threshold','uncertainty_band','identity_margin'],
      quality:['recognition_min_pixels','enrollment_min_pixels','recognition_min_sharpness','enrollment_min_sharpness','brightness_min','brightness_max','crop_tolerance','min_eye_ratio'],
      enrollment:['max_references','consistency_min','duplicate_face_min','redundancy_min'],
      upload:['max_bytes','max_pixels','max_edge','min_edge'],
      detector:['auto_edge','retry_edge','refine_below_pixels','refine_min_overlap','max_processed_faces'],
      capture:['target_analyses_per_second','min_interval_ms','max_records','camera_width','camera_height','jpeg_quality'],
      benchmark:['min_iterations','max_iterations','warmups'],
      temporal:['min_samples','min_span_ms','window_ms','max_gap_ms','max_response_age_ms','min_overlap']
    };
    const rules = {version:value.version,revision:value.revision};
    for (const [section,keys] of Object.entries(fields)) {
      rules[section] = {};
      for (const key of keys) {
        const number = value[section]?.[key];
        if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return null;
        rules[section][key] = number;
      }
    }
    const d=rules.decision,q=rules.quality,u=rules.upload,c=rules.capture,b=rules.benchmark,e=rules.enrollment;
    if (!(0<=d.min_threshold && d.min_threshold<=d.default_threshold && d.default_threshold<=d.max_threshold && d.max_threshold<=1) || d.uncertainty_band>1 || d.identity_margin>2) return null;
    if (!(q.brightness_min<q.brightness_max && q.brightness_max<=255 && q.recognition_min_pixels>0 && q.enrollment_min_pixels>0)) return null;
    if (!(u.max_bytes>0 && u.max_pixels>0 && u.min_edge>=1 && u.min_edge<=u.max_edge)) return null;
    if (!(c.target_analyses_per_second>0 && c.target_analyses_per_second<=60 && c.min_interval_ms>0 && Number.isInteger(c.max_records) && c.max_records>0 && c.max_records<=10000 && c.camera_width>0 && c.camera_height>0 && c.jpeg_quality>0 && c.jpeg_quality<=1)) return null;
    if (!(Number.isInteger(e.max_references) && e.max_references>=1 && e.max_references<=20 && e.consistency_min<=1 && e.duplicate_face_min<=1 && e.redundancy_min<=1)) return null;
    if (!(Number.isInteger(b.min_iterations) && b.min_iterations>=1 && Number.isInteger(b.max_iterations) && b.min_iterations<=b.max_iterations)) return null;
    const t=rules.temporal;
    if (!(Number.isInteger(t.min_samples) && t.min_samples>=2 && t.min_samples<=20 && t.min_span_ms>0 && t.window_ms>=t.min_span_ms && t.max_gap_ms>0 && t.max_gap_ms<=t.window_ms && t.max_response_age_ms>0 && t.min_overlap>0 && t.min_overlap<=1)) return null;
    const scales=value.detector?.scales,durations=value.capture?.session_durations;
    if (!Array.isArray(scales) || !scales.length || !scales.includes(1) || scales.some(n=>typeof n!=='number' || !Number.isFinite(n) || n<=0 || n>1)) return null;
    if (!Array.isArray(durations) || !durations.length || durations.some(n=>!Number.isInteger(n) || n<=0 || n>600)) return null;
    rules.detector.scales=[...scales];rules.capture.session_durations=[...durations];
    return rules;
  };
  const classifyObservation = (expected, faces) => {
    const result = { scored:false, correct:false, tp:0, fp:0, fn:0, tn:0, reason:'unannotated' };
    if (!expected) return result;
    if (faces.length > 1) return { ...result, reason:'multiple_faces' };
    if (!faces.length && expected === '__unknown__') return { ...result, reason:'no_face_unknown' };
    const prediction = faces[0]?.status === 'matched' ? faces[0].profile?.id || null : null;
    if (expected === '__unknown__') return { ...result, scored:true, correct:!prediction, fp:prediction ? 1 : 0, tn:prediction ? 0 : 1, reason:prediction ? 'false_positive' : 'true_negative' };
    if (prediction === expected) return { ...result, scored:true, correct:true, tp:1, reason:'true_positive' };
    return { ...result, scored:true, fp:prediction ? 1 : 0, fn:1, reason:prediction ? 'wrong_identity' : 'false_negative' };
  };
  const aggregateObservations = records => {
    const total = records.reduce((sum, record) => {
      const observation = record.observation || classifyObservation(record.expected, record.faces || []);
      ['tp','fp','fn','tn'].forEach(key => { sum[key] += observation[key]; });
      sum.scored += Number(observation.scored);
      sum.correct += Number(observation.scored && observation.correct);
      sum.excluded += Number(!observation.scored);
      return sum;
    }, { tp:0, fp:0, fn:0, tn:0, scored:0, correct:0, excluded:0 });
    return { ...total, precision:total.tp + total.fp ? total.tp / (total.tp + total.fp) : null, recall:total.tp + total.fn ? total.tp / (total.tp + total.fn) : null, accuracy:total.scored ? total.correct / total.scored : null };
  };
  const csvCell = value => {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const summarizeBenchmark = (rows, expected) => rows.map(row => {
    const faces = Array.isArray(row.faces) ? row.faces : null;
    const observation = faces ? classifyObservation(expected, faces) : null;
    return { ...row, faceCount:faces ? faces.length : Number(row.faces) || 0, observation };
  });
  const comparableBenchmark = rows => {
    const reference = rows.find(row => Number(row.scale) === 1);
    if (reference?.stable === false || !Array.isArray(reference?.faces) || !reference.faces.length || reference.faces.some(face => face.status === 'low_quality')) return null;
    const signature = faces => faces.map(face => `${face.status}:${face.profile?.id || ''}`).sort().join('|');
    const duration = row => row.median_ms ?? row.mean_ms;
    return rows.filter(row => row.stable !== false && Array.isArray(row.faces) && signature(row.faces) === signature(reference.faces) && Number.isFinite(duration(row)) && duration(row) > 0).sort((a,b) => duration(a) - duration(b))[0] || null;
  };
  const utilities = { classifyObservation, aggregateObservations, csvCell, summarizeBenchmark, comparableBenchmark, validateRules };
  if (typeof module !== 'undefined' && module.exports) module.exports = utilities;
  if (typeof document === 'undefined') return;

  const el = id => document.getElementById('dev-' + id);
  if (globalThis.AegisShared) {
    const mark = document.createElement('span');
    mark.className = 'brand-mark';
    const logo = document.createElement('img');
    logo.src = globalThis.AegisShared.imageSource('./assets/aegis-logo.png');
    logo.alt = '';
    mark.append(logo);
    document.querySelector('.dev-brand-shield')?.replaceWith(mark);
  }
  const state = { connected:false, ready:false, token:'', healthPending:false, profiles:[], runtime:null, testSession:null, report:null, stream:null, live:false, starting:false, busy:false, imageLoading:false, liveController:null, operationController:null, timer:null, generation:0, enroll:[], image:null, imageBitmap:null, imageURL:null, imageGeneration:0, records:[], lastResult:null, cameraTimes:[], deviceGeneration:0, menuOpen:false };
  const timedActive = () => ['preparing','running'].includes(state.testSession?.status);
  const applyRules = rules => {
    const first = !state.rules;
    if (state.rules?.revision!==rules.revision) {
      resetTemporal();
      state.temporalTracker=globalThis.AegisDeveloperTemporal.createTracker(rules.temporal);
    }
    state.rules = rules;
    MAX_RECORDS = rules.capture.max_records;
    el('threshold').min=rules.decision.min_threshold;
    el('threshold').max=rules.decision.max_threshold;
    el('threshold-min').textContent=rules.decision.min_threshold.toLocaleString('pt-BR')+' / permissivo';
    el('threshold-max').textContent=rules.decision.max_threshold.toLocaleString('pt-BR')+' / restritivo';
    const upload=`JPEG, PNG ou WebP / até ${rules.upload.max_bytes/(1024*1024)} MB e ${rules.upload.max_pixels/1e6} megapixels`;
    el('test-limits').textContent=upload;
    el('enroll-limits').textContent=`1 a ${rules.enrollment.max_references} fotos / ${upload} cada`;
    if (first || Number(el('threshold').value)<rules.decision.min_threshold || Number(el('threshold').value)>rules.decision.max_threshold) el('threshold').value=rules.decision.default_threshold;
    const scale=el('scale').value;
    el('scale').innerHTML='<option value="auto">Automática · com refinamento</option>'+rules.detector.scales.map(n=>`<option value="${n}">${Math.round(n*100)}% · fixa</option>`).join('');
    el('scale').value=scale==='auto' || rules.detector.scales.includes(Number(scale)) ? scale : 'auto';
    const duration=el('report-duration').value;
    el('report-duration').innerHTML=rules.capture.session_durations.map(n=>`<option value="${n}">${n%60===0 ? n/60+' minuto(s)' : n+' segundos'}</option>`).join('');
    if (rules.capture.session_durations.includes(Number(duration))) el('report-duration').value=duration;
    const iterations=el('iterations').value;
    const choices=[3,5].filter(n=>n>=rules.benchmark.min_iterations && n<=rules.benchmark.max_iterations);
    if (!choices.length) choices.push(rules.benchmark.max_iterations);
    el('iterations').innerHTML=choices.map(n=>`<option value="${n}">${n} medições</option>`).join('');
    el('iterations').value=choices.includes(Number(iterations)) ? iterations : String(choices.at(-1));
    updateThreshold();
  };
  const video = el('video');
  const overlay = el('overlay');
  const liveCaptureCanvas = document.createElement('canvas');
  const formats = new Intl.NumberFormat('pt-BR', { maximumFractionDigits:1 });
  const scoreFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits:3, maximumFractionDigits:3 });
  const decimal = value => value != null && Number.isFinite(Number(value)) ? formats.format(Number(value)) : '—';
  const score = value => value != null && Number.isFinite(Number(value)) ? scoreFormat.format(Number(value)) : '—';
  const scaleLabel = value => value === 'auto' ? 'Auto' : Math.round(Number(value) * 100) + '%';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const percent = value => value === null ? '—' : decimal(value * 100) + '%';
  const showMessage = (message, kind='info') => {
    el('message').textContent = message;
    el('message').dataset.kind = kind;
    el('message').hidden = !message;
  };
  const showError = error => {
    if (error?.name === 'AbortError') return;
    showMessage(error.message || 'Não foi possível concluir esta operação.', 'error');
  };
  const helpTopics = {
    pipeline:['Como o pipeline funciona', 'A captura fornece uma imagem. YuNet localiza os rostos e cinco pontos faciais. O alinhamento prepara um recorte de 112 × 112 pixels. SFace transforma esse recorte em um vetor de 128 valores; a busca compara o vetor com os perfis cadastrados.', 'Detecção, qualidade e comparação são etapas distintas. Detectar um rosto não significa identificar uma pessoa.', 'Fluxo: imagem → detecção → qualidade → alinhamento → vetor → comparação.'],
    detection:['Detecção / YuNet', 'O detector encontra a posição do rosto (bounding box), os olhos, o nariz e os cantos da boca. O score de detecção mede o sinal do detector para a presença de um rosto.', 'Esse score não mede a certeza sobre a identidade. Um rosto pode ser detectado com score alto e não corresponder a nenhum perfil.', 'Saída: posição, tamanho, 5 landmarks e score entre 0 e 1.'],
    alignment:['Alinhamento facial', 'Os cinco pontos faciais orientam a rotação e o recorte usado pelo SFace. O recorte é sempre extraído da imagem original, preservando os detalhes que chegaram à captura.', 'No modo automático, rostos pequenos na imagem reduzida passam por uma nova detecção em uma região da imagem original para melhorar os pontos de alinhamento.', 'Uma caixa correta com landmarks imprecisos pode prejudicar a similaridade.'],
    embedding:['Representação / SFace', 'SFace calcula um descritor de 128 valores para o rosto alinhado. O vetor é normalizado antes da comparação; ele representa características aprendidas pelo modelo.', 'O banco local guarda nomes e vetores, sem persistir as fotos de cadastro. Os modelos usam a implementação nativa do OpenCV, acessada por Python.', 'Uma referência nítida e representativa ajuda mais do que aumentar a quantidade de fotos quase idênticas.'],
    similarity:['Similaridade cosseno', 'O cosseno compara a direção de dois vetores normalizados. Valores maiores indicam maior semelhança entre as representações faciais. O perfil recebe o maior score entre suas referências.', 'Similaridade não é uma probabilidade. Um score de 0,70 não significa 70% de certeza. O resultado também depende da qualidade, do limiar e da diferença para o segundo perfil.', 'Faixa matemática: −1 a 1. O limiar precisa ser avaliado com seus próprios dados.'],
    camera:['A câmera interfere no reconhecimento?', 'Sim. Resolução, foco, exposição, iluminação, distância e movimento determinam o detalhe disponível. Uma câmera com muitos megapixels também pode fornecer uma imagem desfocada ou mal iluminada.', 'A telemetria mostra a resolução negociada com o navegador. O diagnóstico por rosto mostra tamanho, brilho e nitidez. Aproxime-se, use luz frontal e evite contraluz antes de mexer no limiar.', 'Compare uma foto nítida e um quadro da câmera da mesma pessoa. Um erro apenas na câmera aponta para condições de captura.'],
    decision:['Estados do reconhecimento', 'Identificado: similaridade acima da faixa incerta e margem suficiente sobre outro perfil. Incerto: score perto do limiar ou perfis concorrentes muito próximos. Não identificado: nenhuma referência atingiu o limiar. Qualidade insuficiente: a extração facial foi interrompida pelo filtro.', 'Um resultado corresponde a uma imagem. Este laboratório não verifica vivacidade e não confirma a identidade legal de uma pessoa.', 'Leia o motivo e os diagnósticos antes de ajustar o limiar.'],
    fps:['Taxa de análise / FPS', 'Aqui FPS significa análises concluídas por segundo no navegador, calculadas sobre uma janela recente de até 5 segundos. O vídeo da câmera pode ter uma frequência diferente.', 'O laboratório envia uma solicitação por vez e limita a taxa de envio. O tempo de captura, compressão, transporte e inferência afeta a frequência observada.', '30 FPS da câmera não significa 30 reconhecimentos por segundo.'],
    latency:['Latência completa', 'Tempo medido pelo navegador do início da captura ou do envio até a resposta pronta. Inclui comunicação com o serviço local e, na câmera, a captura e codificação JPEG.', 'Compare com o tempo do serviço para localizar espera e custo de transporte. O tempo total do modelo é separado da espera na fila.', 'Latência menor é desejável, desde que a captura preserve detalhes suficientes.'],
    timing:['Tempos do serviço', 'Leitura: abrir a imagem e aplicar sua orientação. Detecção: localizar rostos, incluindo tentativas e refinamentos no modo automático. Reconhecimento: qualidade, alinhamento, extração dos vetores e comparação com a galeria.', 'O total soma leitura e processamento; a espera no lock do modelo é apresentada em fila separadamente. Os modelos e o banco são compartilhados pelo serviço local.', 'A inferência usa OpenCV nativo em CPU. Python coordena o pipeline e a API.'],
    groundtruth:['Identidade esperada / ground truth', 'É a resposta correta informada por você antes do teste, independente da previsão do modelo. Escolha um perfil cadastrado ou indique pessoa não cadastrada.', 'Sem anotação, a execução mede desempenho. Com anotação, o resultado participa das contagens de acertos e erros. Quadros com vários rostos não recebem pontuação.', 'Um perfil esperado com nenhum rosto detectado conta como falso negativo.'],
    benchmark:['Benchmark de estratégias', 'A mesma imagem é analisada no modo automático e em 100%, 50%, 25% e 10%. As quatro escalas fixas não usam fallback nem refinamento. O automático conserva suas tentativas e refinamentos. Cada estratégia recebe uma execução de aquecimento e 3 ou 5 medições.', 'Mediana é o tempo central das medições; a média também aparece para consulta. P95 descreve um tempo alto nesta amostra pequena. A imagem é decodificada uma vez; esse custo é somado a cada medição. A espera na fila fica separada.', 'O destaque usa a menor mediana com o mesmo resultado facial de 100% e decisões estáveis entre repetições. Estabilidade significa repetir as decisões, não comprova que elas estejam corretas.'],
    metrics:['Interpretar a avaliação', 'TP: perfil esperado identificado. FP: identidade atribuída incorretamente. FN: perfil esperado não identificado corretamente. TN: pessoa não cadastrada rejeitada. Uma identidade errada gera FP e FN.', 'Precisão = TP / (TP + FP). Recall = TP / (TP + FN). Acurácia = observações corretas / observações pontuadas. Valores sem denominador aparecem como um traço.', 'Não use muitos quadros correlacionados de um único vídeo como evidência de precisão geral.'],
    precision:['Precisão', 'Das identificações aceitas, quantas apontaram para o perfil correto? Precisão baixa sinaliza atribuições incorretas de identidade.', 'É calculada como TP / (TP + FP). Não é o score de similaridade e não deve ser confundida com acurácia.', '8 verdadeiros positivos e 2 falsos positivos → precisão de 80%.'],
    recall:['Recall / revocação', 'Dos casos em que um perfil cadastrado era esperado, quantos foram identificados corretamente? Recall baixo indica pessoas conhecidas perdidas pelo pipeline.', 'É calculado como TP / (TP + FN). Uma imagem sem rosto detectado também gera FN quando um perfil era esperado.', '8 identificações corretas e 2 perfis esperados perdidos → recall de 80%.'],
    accuracy:['Acurácia', 'Proporção de observações pontuadas com decisão correta, incluindo pessoas desconhecidas corretamente rejeitadas.', 'É calculada como observações corretas / observações pontuadas. Um conjunto com muitos desconhecidos pode ter acurácia alta e recall baixo.', 'Avalie acurácia junto de precisão, recall e contagens de erro.'],
    report:['Resumo de identificação', 'O teste começa a contar quando a câmera inicia e para ao fim do tempo escolhido. Ele reúne somente as novas capturas da câmera; o resumo manual reúne capturas atuais de câmera e arquivo, excluindo benchmarks.', 'Informe quem deve aparecer antes da captura e atualize a anotação quando a pessoa mudar. Sem observações anotadas, o resumo avalia qualidade e desempenho, mas não mede precisão. A taxa de identificação aceita não é probabilidade de acerto.', 'Copie o texto ou baixe TXT/JSON para revisão. Nomes viram Perfil 1, Perfil 2 etc. Quadros do mesmo vídeo são correlacionados: uma sessão não comprova precisão geral.']
  };
  const helpDialog = el('help-dialog');
  let helpReturnFocus = null;
  const openHelp = topic => {
    const r=state.rules;
    const format=n=>n.toLocaleString('pt-BR',{maximumFractionDigits:3});
    const dynamic=r ? {
      threshold:['Limiar e margem de decisão',`O servidor usa faixa incerta de ±${format(r.decision.uncertainty_band)} e margem mínima de ${format(r.decision.identity_margin)} entre os dois melhores perfis.`,'Diminuir o limiar pode aumentar falsos positivos; elevar pode aumentar falsos negativos. Avalie com imagens independentes e pessoas não cadastradas.',el('decision-rule').textContent],
      quality:['Qualidade do rosto',`Tamanho mínimo: cadastro ${r.quality.enrollment_min_pixels} px; análise ${r.quality.recognition_min_pixels} px. As regras são filtros heurísticos, não garantias de precisão.`,`Luz aceita: ${r.quality.brightness_min}–${r.quality.brightness_max}. Nitidez mínima: cadastro ${r.quality.enrollment_min_sharpness}; análise ${r.quality.recognition_min_sharpness}.`,`Regras v${r.version} / revisão ${r.revision}. Valores medidos e motivos aparecem em cada rosto.`],
      scale:['Escala de detecção',`Automática usa até ${r.detector.auto_edge} px no lado maior, tenta até ${r.detector.retry_edge} px e refina rostos pequenos na imagem original.`,'As escalas fixas mantêm a resolução escolhida; diminuir os pixels pode prejudicar detecção e alinhamento.',`Escalas disponíveis: ${r.detector.scales.map(n=>Math.round(n*100)+'%').join(', ')}.`],
      benchmark:['Benchmark de estratégias',`Estratégias: automática e ${r.detector.scales.map(n=>Math.round(n*100)+'%').join(', ')}. Medições: ${r.benchmark.min_iterations}–${r.benchmark.max_iterations}; aquecimento: ${r.benchmark.warmups}.`,'A mesma imagem é usada em todas as estratégias. A espera na fila é separada do processamento.','O destaque exige decisões estáveis e o mesmo resultado de 100%. Isso não comprova que as decisões estejam corretas.'],
      temporal:['Confirmação temporal',`A câmera exige ${r.temporal.min_samples} capturas concordantes por pelo menos ${r.temporal.min_span_ms} ms, na janela de ${r.temporal.window_ms} ms. A posição do rosto também precisa permanecer compatível.`,`Ausência, múltiplos rostos, qualidade ruim, troca de identidade ou intervalo acima de ${r.temporal.max_gap_ms} ms limpam a confirmação. Respostas com mais de ${r.temporal.max_response_age_ms} ms são descartadas para confirmação.`,'O relatório mantém decisões por quadro e confirmações separadas. Repetir uma identificação incorreta pode confirmar o perfil errado; isso não verifica prova de vida.'],
      enrollment:['Preparar os perfis de referência',`Cadastre entre 1 e ${r.enrollment.max_references} fotos nítidas do mesmo rosto, com pequenas variações. Cada foto deve conter exatamente um rosto inteiro.`,'As fotos precisam ser consistentes entre si e diferentes de perfis já cadastrados.','Teste com uma imagem diferente das referências. A avaliação do cadastro não demonstra precisão geral.']
    } : {};
    const unavailable=['Regras ainda não disponíveis','Conecte o servidor Python para consultar os valores efetivos do laboratório.','Análises ficam bloqueadas até receber regras compatíveis.','Reinicie o serviço local se a versão não for compatível.'];
    const [title, explanation, implication, example] = dynamic[topic] || (!r && ['threshold','quality','scale','enrollment','benchmark','temporal'].includes(topic) ? unavailable : helpTopics[topic]) || helpTopics.pipeline;
    helpReturnFocus = document.activeElement;
    el('help-title').textContent = title;
    el('help-content').innerHTML = `<p>${escapeHTML(explanation)}</p><p>${escapeHTML(implication)}</p><div class="dev-help-example">${escapeHTML(example)}</div><p class="dev-help">Referência dos modelos: <a href="https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html" target="_blank" rel="noopener noreferrer">OpenCV / detecção e reconhecimento facial</a>.</p>`;
    helpDialog.showModal();
  };
  const selectTab = (name, focus=false) => {
    if (!['analysis','profiles','validation'].includes(name)) return;
    if (name !== 'analysis' && !timedActive()) stopLive(false);
    document.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      el('pane-' + button.dataset.tab).hidden = !active;
      if (active && focus) button.focus();
    });
    if (name === 'validation') renderMetrics();
  };
  document.addEventListener('click', event => {
    const help = event.target.closest('[data-help]');
    if (help) { event.preventDefault(); openHelp(help.dataset.help); }
    const tab = event.target.closest('[data-tab], [data-open-tab]');
    if (tab) selectTab(tab.dataset.tab || tab.dataset.openTab, true);
    const source = event.target.closest('[data-source]');
    if (source) {
      if (source.dataset.source === 'image') stopLive(false);
      ['camera','image'].forEach(name => {
        const active = name === source.dataset.source;
        el('input-' + name).hidden = !active;
        el('source-' + name).classList.toggle('active', active);
        el('source-' + name).setAttribute('aria-pressed', String(active));
      });
    }
  });
  document.querySelector('.dev-tabs').addEventListener('keydown', event => {
    const buttons = [...document.querySelectorAll('[data-tab]')];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    selectTab(buttons[next].dataset.tab, true);
  });
  el('help-close').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('close', () => helpReturnFocus?.isConnected && helpReturnFocus.focus());
  helpDialog.addEventListener('click', event => {
    const rect = helpDialog.getBoundingClientRect();
    if (event.target === helpDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) helpDialog.close();
  });
  const errorText = payload => {
    const detail = payload?.detail;
    if (typeof detail === 'string') return detail;
    if (typeof detail?.message === 'string') return detail.message;
    if (typeof payload?.message === 'string') return payload.message;
    return 'O servidor recusou a operação.';
  };
  const request = async (path, { method='GET', body, signal, timeout=30000 }={}) => {
    const controller = new AbortController();
    const relay = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', relay, { once:true });
    const timeoutId = setTimeout(() => controller.abort('timeout'), timeout);
    try {
      const headers = method === 'GET' ? {} : { 'X-AEGIS-Token':state.token };
      const response = await fetch('/api/dev' + path, { method, headers, body, signal:controller.signal, credentials:'same-origin', cache:'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if ([403,500,503].includes(response.status)) {
          state.ready = false;
          el('health-badge').dataset.status = 'error';
          el('health-label').textContent = 'Reconexão necessária';
          el('setup').hidden = false;
          el('setup-message').textContent = 'Verifique o servidor local e clique em Reconectar para atualizar a conexão.';
          scheduleReconnect();
        }
        throw new Error(errorText(payload));
      }
      if (!payload) throw new Error('Resposta inválida. Abra a página pelo servidor Python local.');
      return payload;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('O servidor demorou demais para responder. Tente novamente.');
      if (error instanceof TypeError && /fetch|network|load/i.test(error.message)) {
        state.connected = false;
        state.ready = false;
        el('health-badge').dataset.status = 'offline';
        el('health-label').textContent = 'Python desconectado';
        el('setup').hidden = false;
        el('setup-message').textContent = 'A conexão com o servidor Python foi interrompida. Inicie o laboratório e clique em Reconectar.';
        scheduleReconnect();
        throw new Error('Não foi possível conectar ao servidor Python local. Inicie o laboratório e reconecte.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', relay);
    }
  };
  const controls = () => {
    const testing = timedActive();
    const occupied = state.busy || state.starting || state.imageLoading || testing;
    el('start').disabled = !state.ready || occupied || state.live;
    el('start').textContent = state.starting ? 'Abrindo…' : state.stream ? 'Retomar análise' : 'Iniciar câmera';
    el('stop').disabled = !state.stream && !state.starting;
    el('device').disabled = occupied;
    el('enroll-submit').disabled = !state.ready || occupied || !state.enroll.length;
    el('enroll-check').disabled = !state.ready || occupied || !state.enroll.length;
    el('profile-connection').hidden = state.ready;
    el('profile-reconnect').disabled = state.healthPending || occupied;
    el('profile-connection-message').textContent = location.protocol === 'file:'
      ? 'Esta página foi aberta como arquivo. Abra o laboratório pelo endereço local para conectar a API Python.'
      : state.connected ? 'A conexão precisa ser validada ou os modelos ainda não estão prontos. Reconecte o serviço e confira o aviso no início da página.'
      : 'O serviço Python está desconectado. As fotos selecionadas ainda não foram cadastradas. Inicie o serviço e reconecte sem recarregar esta página.';
    el('enroll-status').textContent = state.busy ? 'Aguarde a operação em andamento.'
      : state.enroll.length ? `${state.enroll.length} foto(s) selecionada(s). ${state.ready ? 'Clique em Cadastrar perfil para salvar a referência facial.' : 'Cadastro ainda não salvo: conecte o serviço primeiro.'}`
      : 'Selecione as fotos e clique em Cadastrar perfil. Selecionar fotos não salva o cadastro.';
    el('capture-enroll').disabled = !state.stream || occupied || state.enroll.length >= (state.rules?.enrollment.max_references ?? 5);
    el('capture-test').disabled = !state.stream || occupied;
    el('recognize-image').disabled = !state.ready || occupied || !state.image;
    el('benchmark').disabled = !state.ready || occupied || !state.image;
    el('clear-image').disabled = occupied || !state.image;
    el('test-image').disabled = occupied;
    el('enroll-images').disabled = occupied;
    el('name').disabled = occupied;
    el('scale').disabled = occupied || !state.rules;
    el('threshold').disabled = occupied || !state.rules;
    el('ground-truth').disabled = state.busy || state.starting || state.imageLoading;
    el('report-expected').disabled = el('ground-truth').disabled;
    el('iterations').disabled = occupied;
    el('reset-config').disabled = occupied;
    el('refresh-profiles').disabled = !state.connected || occupied;
    el('export').disabled = !state.records.length;
    el('clear-records').disabled = !state.records.length || testing;
    el('source-camera').disabled = testing;
    el('source-image').disabled = testing;
    el('report-duration').disabled = occupied;
    el('report-start').disabled = !state.ready || occupied;
    el('report-stop').disabled = !testing;
    el('report-current').disabled = occupied || !state.records.some(record => ['camera','image'].includes(record.source));
    el('profiles').querySelectorAll('button').forEach(button => { button.disabled = occupied || !state.connected; });
    document.querySelectorAll('[data-cancel-operation]').forEach(button => {
      button.hidden = !state.busy || button.dataset.cancelOperation !== state.operationButton;
      button.disabled = !state.operationController || state.operationController.signal.aborted;
    });
  };
  const refreshProfiles = async () => {
    const payload = await request('/profiles');
    if (JSON.stringify(state.profiles)!==JSON.stringify(payload.profiles || [])) { invalidateEnrollment(); resetTemporal(); }
    state.profiles = payload.profiles || [];
    el('profile-count').textContent = state.profiles.length;
    el('onboarding').hidden = state.profiles.length > 0;
    const selected = el('ground-truth').value;
    el('ground-truth').innerHTML = '<option value="">Sem anotação · apenas desempenho</option><option value="__unknown__">Pessoa não cadastrada</option>' + state.profiles.map(profile => `<option value="${escapeHTML(profile.id)}">${escapeHTML(profile.name)}</option>`).join('');
    if ([...el('ground-truth').options].some(option => option.value === selected)) el('ground-truth').value = selected;
    el('report-expected').innerHTML = el('ground-truth').innerHTML;
    el('report-expected').value = el('ground-truth').value;
    el('profiles').innerHTML = state.profiles.length ? state.profiles.map(profile => `<div class="dev-profile"><span class="avatar" aria-hidden="true">${escapeHTML(profile.name.trim().split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase())}</span><div class="dev-profile-info"><strong>${escapeHTML(profile.name)}</strong><small>${Number(profile.samples)} ${Number(profile.samples) === 1 ? 'foto' : 'fotos'} de referência</small></div><button class="icon-button dev-profile-delete" data-profile="${escapeHTML(profile.id)}" aria-label="Excluir perfil ${escapeHTML(profile.name)}"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg></button></div>`).join('') : '<p class="muted">Nenhum perfil cadastrado. Adicione suas primeiras fotos para começar.</p>';
    controls();
  };
  const health = async () => {
    if (state.healthPending) return;
    state.healthPending = true;
    el('reconnect').disabled = true;
    controls();
    try {
      const payload = await request('/health', { timeout:10000 });
      state.connected = true;
      const rules=validateRules(payload.rules);
      if (rules) {
        if (state.rules?.revision !== rules.revision) invalidateEnrollment();
        applyRules(rules);
      }
      else { resetTemporal(); state.rules=null; updateThreshold(); }
      state.ready = payload.status === 'ready' && Boolean(rules);
      state.token = payload.token || '';
      state.runtime = payload.runtime || null;
      state.provenance=payload.provenance || null;
      el('health-badge').dataset.status = payload.status;
      el('health-label').textContent = !rules ? 'Regras incompatíveis' : state.ready ? 'Python conectado' : payload.status === 'models_missing' ? 'Modelos pendentes' : 'Servidor indisponível';
      el('setup').hidden = state.ready;
      el('setup-message').textContent = !rules ? 'Reinicie o Python: esta interface precisa receber regras compatíveis do servidor.' : payload.message || 'Baixe os modelos e reinicie o laboratório.';
      if (payload.runtime) el('runtime').textContent = `OpenCV ${payload.runtime.opencv} / ${payload.runtime.target} / ${payload.runtime.threads} threads / descritor ${payload.runtime.embedding_dimensions}D`;
      await refreshProfiles();
    } catch {
      state.connected = false;
      state.ready = false;
      el('health-badge').dataset.status = 'offline';
      el('health-label').textContent = 'Python desconectado';
      el('setup').hidden = false;
      el('setup-message').textContent = 'Execute os comandos abaixo no diretório do projeto e abra esta página pelo servidor local.';
      el('profile-count').textContent = '—';
    } finally {
      state.healthPending = false;
      el('reconnect').disabled = false;
      controls();
      if (!state.connected && location.protocol !== 'file:') scheduleReconnect();
    }
  };
  let reconnectTimer = null;
  const scheduleReconnect = () => {
    if (reconnectTimer || document.hidden || location.protocol === 'file:') return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if ((!state.connected || !state.ready) && !document.hidden) {
        if (state.busy) scheduleReconnect();
        else health();
      }
    }, 5000);
  };
  const mediaDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const current = el('device').value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    el('device').innerHTML = '<option value="">Câmera padrão</option>' + devices.map((device, index) => `<option value="${escapeHTML(device.deviceId)}">${escapeHTML(device.label || 'Câmera ' + (index + 1))}</option>`).join('');
    if (devices.some(device => device.deviceId === current)) el('device').value = current;
  };
  const stopLive = (release=true) => {
    if (timedActive()) {
      finishTimedSession('interrupted', false);
      release = true;
    }
    state.live = false;
    resetTemporal();
    state.generation += 1;
    clearTimeout(state.timer);
    state.timer = null;
    state.liveController?.abort();
    state.liveController = null;
    state.cameraTimes = [];
    el('fps').textContent = '—';
    if (release) {
      state.deviceGeneration += 1;
      state.starting = false;
      state.stream?.getTracks().forEach(track => track.stop());
      state.stream = null;
      video.srcObject = null;
      el('camera-empty').hidden = false;
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    }
    el('camera-state').textContent = state.stream ? 'Análise pausada' : 'Câmera desligada';
    el('camera-state').className = 'badge';
    el('stage-label').textContent = state.stream ? 'Câmera ativa · análise pausada' : 'Aguardando câmera';
    controls();
  };
  const captureFrame = async (canvas=document.createElement('canvas')) => {
    if (!state.stream || video.readyState < 2 || !video.videoWidth) throw new Error('Aguarde a câmera fornecer uma imagem.');
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', state.rules.capture.jpeg_quality));
    if (!blob) throw new Error('Não foi possível capturar a imagem da câmera.');
    return new File([blob], 'camera-' + Date.now() + '.jpg', { type:'image/jpeg' });
  };
  const buildForm = (image, config) => {
    const form = new FormData();
    form.append('image', image, image.name || 'camera.jpg');
    form.append('scale', config.scale);
    form.append('threshold', config.threshold);
    return form;
  };
  const configuration = () => ({ scale:el('scale').value === 'auto' ? 'auto' : Number(el('scale').value), threshold:Number(el('threshold').value), expected:el('ground-truth').value });
  const resetTemporal = (text='Sem confirmação · câmera parada') => {
    clearTimeout(state.temporalTimer);
    state.temporalTracker?.reset();
    state.temporalEpoch=(state.temporalEpoch || 0)+1;
    el('temporal-state').textContent=text;
    el('temporal-state').dataset.status='unconfirmed';
    overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  };
  const renderTemporal = (value,face,captured) => {
    clearTimeout(state.temporalTimer);
    el('temporal-state').dataset.status=value.status;
    el('temporal-state').textContent=value.status==='confirmed' ? 'Confirmado em vídeo · '+(face?.profile?.name || 'perfil')
      : value.status==='pending' ? `A confirmar · ${value.samples}/${value.required_samples} capturas`
      : value.status==='discarded' ? 'Sem confirmação · resposta descartada' : 'Sem confirmação · aguarde um rosto adequado';
    if (['confirmed','pending'].includes(value.status)) state.temporalTimer=setTimeout(()=>resetTemporal('Sem confirmação · captura interrompida'),Math.max(0,state.rules.temporal.max_gap_ms-(performance.now()-captured)));
  };
  const drawFaces = (context, result, width, height, temporal=null) => {
    const factorX = width / result.image.width;
    const factorY = height / result.image.height;
    const unit = Math.max(1, width / 800);
    context.lineWidth = 2.5 * unit;
    context.font = `${Math.round(14 * unit)}px "Segoe UI",Arial,sans-serif`;
    const statuses = { unknown:'Não identificado', uncertain:'Correspondência incerta', low_quality:'Qualidade insuficiente' };
    for (const face of result.faces) {
      const box = face.box;
      const x = box.x * factorX;
      const y = box.y * factorY;
      const w = box.width * factorX;
      const h = box.height * factorY;
      const color = face.status === 'matched' ? (temporal && temporal.status!=='confirmed' ? '#ffc16a' : '#63e19b') : face.status === 'low_quality' ? '#ffc16a' : '#82b6ff';
      context.strokeStyle = color;
      context.strokeRect(x, y, w, h);
      for (const point of face.landmarks || []) {
        context.beginPath();
        context.arc(point.x * factorX, point.y * factorY, 2.5 * unit, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
      }
      const label = (face.status === 'matched' ? (temporal && temporal.status!=='confirmed' ? 'A confirmar' : face.profile?.name) : statuses[face.status]) || 'Rosto';
      const text = label + (face.similarity == null ? '' : ' · ' + score(face.similarity));
      const labelWidth = Math.min(width, context.measureText(text).width + 16 * unit);
      const labelX = Math.max(0, Math.min(x, width - labelWidth));
      const labelY = Math.max(0, y - 26 * unit);
      context.fillStyle = '#061526e6';
      context.fillRect(labelX, labelY, labelWidth, 25 * unit);
      context.fillStyle = color;
      context.fillText(text, labelX + 8 * unit, labelY + 17 * unit, labelWidth - 16 * unit);
    }
  };
  const renderMetrics = () => {
    const metrics = aggregateObservations(state.records.filter(record => ['camera','image'].includes(record.source)));
    el('precision').textContent = percent(metrics.precision);
    el('recall').textContent = percent(metrics.recall);
    el('accuracy').textContent = percent(metrics.accuracy);
    el('scored').textContent = metrics.scored;
    el('metric-detail').textContent = `TP ${metrics.tp} · FP ${metrics.fp} · FN ${metrics.fn} · TN ${metrics.tn} · ${metrics.excluded} sem pontuação · benchmarks fora das métricas`;
    ['tp','fp','fn','tn'].forEach(key => { el(key).textContent = metrics[key]; });
    const observationLabels = { true_positive:'Correto / TP', true_negative:'Desconhecido / TN', false_positive:'Falso positivo', false_negative:'Falso negativo', wrong_identity:'Identidade incorreta / FP + FN', multiple_faces:'Múltiplos rostos', no_face_unknown:'Sem rosto / não pontuado', unannotated:'Sem anotação', gallery_changed:'Galeria alterada / sem pontuação' };
    el('session-records').innerHTML = state.records.length ? `<div class="table-scroll"><table><caption class="visually-hidden">Últimas observações da sessão</caption><thead><tr><th scope="col">Horário</th><th scope="col">Origem</th><th scope="col">Escala</th><th scope="col">Resultado</th><th scope="col">Serviço</th></tr></thead><tbody>${state.records.slice(-10).reverse().map(record => `<tr><td>${escapeHTML(new Date(record.at).toLocaleTimeString('pt-BR'))}</td><td>${escapeHTML({camera:'Câmera',image:'Arquivo',benchmark:'Benchmark'}[record.source] || record.source)}</td><td>${record.scale === 'auto' ? 'Auto' : Math.round(record.scale * 100) + '%'}</td><td>${escapeHTML(observationLabels[record.observation.reason])}</td><td>${decimal(record.timings?.total_ms)} ms</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhuma análise nesta sessão.</p>';
    controls();
  };
  const recordResult = (result, config, source, roundtrip, temporal=null) => {
    const faces = result.faces || [];
    const observation=result.gallery_changed ? {...classifyObservation('',faces),reason:'gallery_changed'} : classifyObservation(config.expected,faces);
    const record = { at:new Date().toISOString(), source, ...config, faces, image:result.image, profile_count:result.profile_count, gallery_revision:result.gallery_revision, gallery_changed:result.gallery_changed,
      provenance:result.provenance || state.provenance, client_revision:10, timings:result.timings, detection:result.detection, rules:state.rules, temporal, roundtrip, observation };
    state.records.push(record);
    if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
    if (state.testSession?.status === 'running' && source === 'camera') {
      state.testSession.records.push(record);
      if (state.testSession.records.length > MAX_RECORDS) {
        state.testSession.records.shift();
        state.testSession.discarded++;
      }
    }
    if (!el('pane-validation').hidden) renderMetrics();
    else controls();
  };
  const showReport = (records, context) => {
    state.report = globalThis.AegisDeveloperReport.buildReport(records, context, aggregateObservations);
    el('report-text').value = globalThis.AegisDeveloperReport.formatReport(state.report);
    const report = state.report;
    el('report-overview').textContent = `${report.frames.total} capturas · ${report.evaluation.scored} pontuadas · ${report.evaluation.fp} falsos positivos · ${report.evaluation.fn} falsos negativos · ${decimal(report.timings.total_ms.median)} ms de mediana`;
    el('report-output').hidden = false;
    selectTab('validation', true);
    el('report-text').setSelectionRange(0,0);
    el('report-text').scrollTop = 0;
    el('report-text').focus({preventScroll:true});
  };
  const updateTimedProgress = () => {
    const session = state.testSession;
    if (session?.status !== 'running') return;
    const elapsed = Math.max(0, (performance.now() - session.startedMark) / 1000);
    el('report-bar').value = Math.min(session.seconds, elapsed);
    el('report-countdown').textContent = `${Math.max(0, Math.ceil(session.seconds-elapsed))} s restantes · ${session.records.length} capturas`;
  };
  const beginTimedSession = session => {
    if (state.testSession !== session || session.status !== 'preparing') return;
    session.status = 'running';
    session.startedAt = new Date().toISOString();
    session.startedMark = performance.now();
    const settings = state.stream?.getVideoTracks()[0]?.getSettings() || {};
    session.camera = {width:video.videoWidth, height:video.videoHeight, frameRate:settings.frameRate};
    el('report-progress').hidden = false;
    el('report-bar').max = session.seconds;
    el('report-status').textContent = 'Teste em andamento. Atualize a identidade esperada antes de mudar a pessoa em frente à câmera.';
    session.deadline = setTimeout(() => finishTimedSession('completed'), session.seconds * 1000);
    session.ticker = setInterval(updateTimedProgress, 1000);
    updateTimedProgress();
    controls();
  };
  const finishTimedSession = (reason='interrupted', stopCamera=true) => {
    const session = state.testSession;
    if (!timedActive()) return;
    session.status = 'finished';
    clearTimeout(session.deadline);
    clearInterval(session.ticker);
    el('report-progress').hidden = true;
    const endedAt = new Date().toISOString();
    const duration = session.startedMark == null ? 0 : performance.now()-session.startedMark;
    if (stopCamera) stopLive();
    showReport(session.records, {started_at:session.startedAt || session.createdAt, ended_at:endedAt, duration_ms:duration,
      requested_seconds:session.seconds, end_reason:reason, runtime:session.runtime, camera:session.camera,
      profiles:session.profiles, rules:session.rules, errors:session.errors, discarded_records:session.discarded, retained_limit:MAX_RECORDS});
    el('report-status').textContent = reason === 'completed' ? 'Tempo concluído. A câmera foi desligada e o resumo está pronto.' : 'Teste encerrado. O resumo contém as capturas concluídas até a interrupção.';
    controls();
  };
  const startTimedSession = async () => {
    if (timedActive() || state.busy || state.starting || state.imageLoading || !state.ready) return;
    const seconds = Number(el('report-duration').value);
    if (!state.rules.capture.session_durations.includes(seconds)) { showMessage('Escolha uma duração oferecida pelo servidor.', 'error'); return; }
    // Discard a frame already in flight before the test starts, while keeping
    // the negotiated camera stream for the new measurement period.
    if (state.live) stopLive(false);
    const session = {status:'preparing',seconds,createdAt:new Date().toISOString(),startedMark:null,records:[],discarded:0,errors:[],profiles:state.profiles.map(profile=>({...profile})),runtime:state.runtime,rules:state.rules};
    state.testSession = session;
    el('report-output').hidden = true;
    el('report-status').textContent = 'Preparando a câmera. A contagem começa quando a captura estiver pronta.';
    el('input-camera').hidden = false;
    el('input-image').hidden = true;
    ['camera','image'].forEach(source => { el('source-'+source).classList.toggle('active',source==='camera'); el('source-'+source).setAttribute('aria-pressed',String(source==='camera')); });
    controls();
    await startCamera(() => beginTimedSession(session));
    if (state.testSession === session && session.status === 'preparing') finishTimedSession('camera_error');
  };
  const summarizeCurrent = () => {
    if (timedActive()) return;
    const captures = state.records.filter(record => ['camera','image'].includes(record.source));
    if (!captures.length) return;
    const startedAt = captures[0].at;
    const endedAt = captures.at(-1).at;
    const settings = state.stream?.getVideoTracks()[0]?.getSettings() || {};
    showReport(state.records,{started_at:startedAt,ended_at:endedAt,duration_ms:new Date(endedAt)-new Date(startedAt),end_reason:'manual',runtime:state.runtime,profiles:state.profiles,rules:state.rules,
      camera:{width:video.videoWidth || null,height:video.videoHeight || null,frameRate:settings.frameRate}});
    el('report-status').textContent = 'Resumo das capturas atuais pronto. Benchmarks foram excluídos.';
  };
  const renderResult = (result, roundtrip, source='camera') => {
    if (result.gallery_changed) showMessage('As referências mudaram durante esta análise. O resultado ficou incerto; repita para usar a galeria atual.');
    state.lastResult = result;
    el('result-source').textContent = `${source === 'image' ? 'Arquivo' : 'Câmera'} / ${new Date().toLocaleTimeString('pt-BR')}`;
    el('latency').textContent = decimal(roundtrip);
    el('server-time').textContent = decimal(result.timings?.total_ms);
    el('stage-times').textContent = `Det. ${decimal(result.timings?.detect_ms)} ms · Rec. ${decimal(result.timings?.recognize_ms)} ms`;
    const labels = { matched:'Identificado por quadro', unknown:'Não identificado', uncertain:'Correspondência incerta', low_quality:'Qualidade insuficiente' };
    el('result').innerHTML = result.faces.length ? result.faces.map(face => {
      const q = face.quality;
      return `<div class="dev-result-item"><div class="dev-result-identity"><strong><span class="badge ${face.status === 'matched' ? 'success' : face.status === 'unknown' ? 'danger' : 'warning'}">${escapeHTML(labels[face.status] || 'Rosto')}</span>${face.status === 'matched' ? escapeHTML(face.profile?.name) : ''}</strong><small>${escapeHTML(face.reason || '')}</small></div><div class="dev-result-score">${face.similarity == null ? 'Sem similaridade' : 'Cosseno ' + score(face.similarity)}<br><small>Detector ${score(face.detector_score)}${face.comparison?.margin != null ? ' / margem ' + score(face.comparison.margin) : ''}</small></div>${q ? `<div class="dev-face-quality"><span data-failed="${q.face_pixels < q.minimum_pixels}">Rosto ${decimal(q.face_pixels)} px / mín. ${q.minimum_pixels}</span><span data-failed="${q.brightness != null && (Number.isFinite(q.brightness_min) && Number.isFinite(q.brightness_max) && (q.brightness < q.brightness_min || q.brightness > q.brightness_max))}">Luz ${decimal(q.brightness)} / 255</span><span data-failed="${q.sharpness != null && q.sharpness < q.minimum_sharpness}">Nitidez ${decimal(q.sharpness)} / mín. ${q.minimum_sharpness}</span><span>${face.refined ? 'Landmarks refinados' : 'Landmarks do detector'}</span></div>` : ''}</div>`;
    }).join('') : `<p class="muted">Nenhum rosto detectado neste quadro.</p><p class="dev-help">${escapeHTML(result.detection?.reason || 'Aproxime o rosto, confira a iluminação ou use a escala automática.')}</p>`;
    el('json').textContent = JSON.stringify(result, null, 2);
    const detection = result.detection;
    if (result.image) el('input-size').textContent = `${result.image.width} × ${result.image.height}`;
    if (detection) {
      el('stage-label').textContent = `${result.image.width} × ${result.image.height} → ${detection.width} × ${detection.height} · ${result.faces.length} ${result.faces.length === 1 ? 'rosto' : 'rostos'}`;
      el('detection-size').textContent = `${detection.width} × ${detection.height}`;
      el('strategy').textContent = detection.requested_scale === 'auto' ? 'Auto / ' + (detection.refined_faces || 0) + ' refinados' : Math.round(detection.requested_scale * 100) + '% / fixa';
    }
    ['decode','detect','recognize','queue'].forEach(stage => { el(stage + '-time').textContent = decimal(result.timings?.[stage + '_ms']) + ' ms'; });
  };
  const liveTick = async generation => {
    if (!state.live || generation !== state.generation) return;
    const config = configuration();
    const temporalEpoch=state.temporalEpoch;
    const rules=state.rules;
    const controller = new AbortController();
    state.liveController = controller;
    const started = performance.now();
    try {
      const image = await captureFrame(liveCaptureCanvas);
      if (!state.live || generation !== state.generation) return;
      const result = await request('/recognize', { method:'POST', body:buildForm(image, config), signal:controller.signal });
      if (!state.live || generation !== state.generation) return;
      const completed = performance.now();
      const temporal=temporalEpoch!==state.temporalEpoch || rules.revision!==state.rules.revision || result.gallery_changed || JSON.stringify(config)!==JSON.stringify(configuration())
        ? {status:'discarded',reason:result.gallery_changed ? 'gallery_changed' : 'configuration_changed',samples:0,required_samples:rules.temporal.min_samples,profile_id:null,new_confirmation:false}
        : state.temporalTracker.step({faces:result.faces,image:result.image,captured_at_ms:started,received_at_ms:completed,
            context:JSON.stringify([config,rules.revision,result.gallery_revision ?? result.profile_count])});
      renderTemporal(temporal,result.faces[0],started);
      if (result.gallery_changed) state.temporalTracker.reset();
      renderResult(result, completed - started);
      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      drawFaces(overlay.getContext('2d'), result, overlay.width, overlay.height,temporal);
      state.cameraTimes.push(completed);
      state.cameraTimes = state.cameraTimes.filter(time => completed - time < 5000);
      const elapsed = state.cameraTimes.length > 1 ? completed - state.cameraTimes[0] : 0;
      el('fps').textContent = elapsed ? decimal((state.cameraTimes.length - 1) * 1000 / elapsed) : '—';
      recordResult(result, config, 'camera', completed - started,temporal);
    } catch (error) {
      if (generation !== state.generation || error.name === 'AbortError') return;
      if (timedActive()) {
        state.testSession.errors.push({at:new Date().toISOString(),message:error.message});
        finishTimedSession('error');
      } else stopLive(false);
      showError(error);
    } finally {
      if (state.liveController === controller) state.liveController = null;
      if (state.live && generation === state.generation) state.timer = setTimeout(() => liveTick(generation), Math.max(state.rules.capture.min_interval_ms, 1000/state.rules.capture.target_analyses_per_second - (performance.now() - started)));
    }
  };
  const startCamera = async onStarted => {
    if (state.starting || state.live || state.busy || state.imageLoading || !state.ready) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = 'A câmera precisa de localhost ou HTTPS e de um navegador com suporte a getUserMedia.';
      if (timedActive()) {
        state.testSession.errors.push({at:new Date().toISOString(),message});
        finishTimedSession('camera_error');
      }
      showMessage(message, 'error');
      return;
    }
    state.starting = true;
    const generation = ++state.deviceGeneration;
    controls();
    try {
      if (!state.stream) {
        const device = el('device').value;
        const stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ width:{ ideal:state.rules.capture.camera_width }, height:{ ideal:state.rules.capture.camera_height }, ...(device ? { deviceId:{ exact:device } } : { facingMode:'user' }) } });
        if (generation !== state.deviceGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
        state.stream = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (state.stream === stream) stopLive(); }, { once:true }));
        video.srcObject = stream;
        await video.play();
        if (!video.videoWidth) await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('A câmera não forneceu uma imagem.')), 5000);
          video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once:true });
        });
        if (generation !== state.deviceGeneration) return;
        el('camera-stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        const settings = stream.getVideoTracks()[0]?.getSettings() || {};
        el('camera-specs').textContent = `${video.videoWidth} × ${video.videoHeight} px / ${decimal(settings.frameRate)} FPS do dispositivo`;
        await mediaDevices();
      }
      if (generation !== state.deviceGeneration) return;
      state.live = true;
      state.generation += 1;
      el('camera-empty').hidden = true;
      el('camera-state').textContent = 'Analisando';
      el('camera-state').className = 'badge success';
      showMessage('');
      if (typeof onStarted === 'function') onStarted();
      liveTick(state.generation);
    } catch (error) {
      if (generation !== state.deviceGeneration) return;
      const cameraErrors = { NotAllowedError:'Permita o acesso à câmera no navegador e tente novamente.', NotFoundError:'Nenhuma câmera foi encontrada neste computador.', NotReadableError:'A câmera está ocupada por outro aplicativo.', OverconstrainedError:'A câmera selecionada não está disponível. Escolha outra.' };
      const message = cameraErrors[error.name] || error.message || 'Não foi possível iniciar a câmera.';
      if (timedActive()) {
        state.testSession.errors.push({at:new Date().toISOString(),message});
        finishTimedSession('camera_error');
      } else stopLive();
      showMessage(message, 'error');
    } finally {
      if (generation === state.deviceGeneration) state.starting = false;
      controls();
    }
  };
  const runOperation = async (button, workingLabel, operation) => {
    const galleryOperation=button === el('refresh-profiles') || button.hasAttribute('data-profile');
    if (state.busy || state.imageLoading || timedActive() || !(galleryOperation ? state.connected : state.ready)) return;
    stopLive(false);
    state.busy = true;
    const controller = new AbortController();
    state.operationController = controller;
    state.operationButton = button.id;
    const label = button.innerHTML;
    button.textContent = workingLabel;
    showMessage('');
    controls();
    try { await operation(controller.signal); }
    catch (error) {
      if (controller.signal.aborted) showMessage(button === el('enroll-submit')
        ? 'Envio interrompido. Atualize os perfis para conferir se o cadastro já havia sido concluído. As fotos selecionadas foram preservadas.'
        : 'Operação cancelada. Você pode iniciar uma nova análise.');
      else showError(error);
    }
    finally {
      state.operationController = null;
      state.operationButton = null;
      state.busy = false;
      button.innerHTML = label;
      controls();
    }
  };
  const validFile = file => {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Selecione uma imagem JPG, PNG ou WebP.');
    const limit=state.rules?.upload.max_bytes ?? OFFLINE_MAX_BYTES;
    if (file.size > limit) throw new Error(`Cada imagem deve ter no máximo ${decimal(limit/1024/1024)} MB.`);
    if (!file.size) throw new Error('A imagem selecionada está vazia.');
  };
  const renderEnroll = () => {
    invalidateEnrollment();
    el('enroll-previews').innerHTML = state.enroll.map((entry, index) => `<div class="dev-photo"><img src="${entry.url}" alt="Foto de referência ${index + 1}"><button type="button" data-photo="${index}" aria-label="Remover foto ${index + 1}">✕</button></div>`).join('');
    controls();
  };
  const invalidateEnrollment = () => {
    state.enrollmentReport=null;
    el('enroll-diagnostics').hidden=true;
    el('enroll-diagnostics').textContent='';
  };
  const renderEnrollmentReport = report => {
    state.enrollmentReport=report;
    const qValue=value=>value==null ? 'não medido' : decimal(value);
    el('enroll-diagnostics').innerHTML=`<header><strong>${report.can_enroll ? 'Referências prontas para cadastrar' : 'Reveja as referências antes de cadastrar'}</strong><button type="button" class="dev-info" data-help="enrollment" aria-label="Entender avaliação do cadastro">?</button></header>
      ${report.photos.map(photo=>`<article class="dev-enroll-photo-result"><strong>Foto ${photo.photo} <span class="badge ${photo.accepted ? 'success' : 'warning'}">${photo.accepted ? 'Adequada' : 'Revisar'}</span></strong><p>${escapeHTML(photo.reason)}</p>${photo.quality ? `<dl><div><dt>Rosto / mínimo</dt><dd>${qValue(photo.quality.face_pixels)} / ${qValue(photo.quality.minimum_pixels)} px</dd></div><div><dt>Luz / faixa</dt><dd>${qValue(photo.quality.brightness)} / ${qValue(photo.quality.brightness_min)}–${qValue(photo.quality.brightness_max)}</dd></div><div><dt>Nitidez / mínimo</dt><dd>${qValue(photo.quality.sharpness)} / ${qValue(photo.quality.minimum_sharpness)}</dd></div></dl>` : `<p class="dev-help">Rostos detectados: ${qValue(photo.face_count)}.</p>`}${photo.advice.map(text=>`<p class="dev-help">${escapeHTML(text)}</p>`).join('')}</article>`).join('')}
      ${report.consistency.pairs.length ? `<details><summary>Comparações entre as fotos</summary><div class="table-scroll"><table><thead><tr><th scope="col">Fotos</th><th scope="col">Cosseno</th><th scope="col">Diagnóstico</th></tr></thead><tbody>${report.consistency.pairs.map(pair=>`<tr><td>${pair.first} / ${pair.second}</td><td>${score(pair.similarity)}</td><td>${!pair.consistent ? 'Inconsistentes' : pair.redundant ? 'Muito parecidas' : 'Consistentes'}</td></tr>`).join('')}</tbody></table></div><p class="dev-help">Consistência mínima: ${score(report.consistency.required_similarity)}. Similaridade não é probabilidade.</p></details>` : ''}
      ${report.warnings.map(text=>`<p class="dev-help">${escapeHTML(text)}</p>`).join('')}<p class="dev-help">${escapeHTML(report.note)}</p>`;
    el('enroll-diagnostics').hidden=false;
  };
  const clearEnroll = () => {
    state.enroll.forEach(entry => URL.revokeObjectURL(entry.url));
    state.enroll = [];
    el('enroll-images').value = '';
    renderEnroll();
  };
  const addEnroll = files => {
    const limit=state.rules?.enrollment.max_references ?? 5;
    if (state.enroll.length + files.length > limit) throw new Error(`O cadastro aceita no máximo ${limit} fotos. Remova uma foto para adicionar outra.`);
    files.forEach(validFile);
    state.enroll.push(...files.map(file => ({ file, url:URL.createObjectURL(file) })));
    renderEnroll();
  };
  const clearImage = (invalidate=true) => {
    if (invalidate) {
      state.imageGeneration += 1;
      state.imageLoading = false;
    }
    state.imageBitmap?.close?.();
    if (state.imageURL) URL.revokeObjectURL(state.imageURL);
    state.image = null;
    state.imageBitmap = null;
    state.imageURL = null;
    el('image-preview').hidden = true;
    el('image-name').textContent = 'Nenhuma imagem selecionada';
    el('test-image').value = '';
    el('benchmark-results').innerHTML = '<p class="muted">Os tempos serão medidos no seu computador.</p>';
    controls();
  };
  const setImage = async file => {
    validFile(file);
    const generation = ++state.imageGeneration;
    state.imageLoading = true;
    controls();
    let bitmap;
    let objectURL = null;
    try {
      try {
        if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
        else {
          objectURL = URL.createObjectURL(file);
          bitmap = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = objectURL; });
        }
      } catch {
        throw new Error('Não foi possível abrir a imagem. Selecione um JPEG, PNG ou WebP válido.');
      }
      if (generation !== state.imageGeneration) return;
      const limits=state.rules?.upload;
      if (!limits) throw new Error('Conecte o servidor para validar os limites da imagem.');
      if (bitmap.width * bitmap.height > limits.max_pixels || Math.max(bitmap.width, bitmap.height) > limits.max_edge) throw new Error(`Use uma imagem com até ${decimal(limits.max_pixels/1000000)} megapixels e ${limits.max_edge} pixels por lado.`);
      clearImage(false);
      state.image = file;
      state.imageBitmap = bitmap;
      state.imageURL = objectURL;
      const canvas = el('image-canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      el('image-preview').hidden = false;
      el('image-name').textContent = `${file.name} · ${bitmap.width} × ${bitmap.height}`;
    } finally {
      if (state.imageBitmap !== bitmap) bitmap?.close?.();
      if (objectURL && state.imageURL !== objectURL) URL.revokeObjectURL(objectURL);
      if (generation === state.imageGeneration) state.imageLoading = false;
      controls();
    }
  };
  const renderBenchmark = (payload, config) => {
    const expected = config.expected;
    const rows = summarizeBenchmark(payload.results, expected);
    const expectedProfile = state.profiles.find(profile => profile.id === expected);
    const fastestComparable = comparableBenchmark(rows);
    const observationLabels = { true_positive:'Correto', true_negative:'Correto: desconhecido', false_positive:'Falso positivo', false_negative:'Falso negativo', wrong_identity:'Identidade incorreta', multiple_faces:'Múltiplos rostos', no_face_unknown:'Sem rosto: não pontuado', unannotated:'Sem anotação', gallery_changed:'Galeria alterada / sem pontuação' };
    el('benchmark-results').innerHTML = `<div class="table-scroll"><table><caption class="visually-hidden">Comparação de estratégias na mesma imagem</caption><thead><tr><th scope="col">Estratégia</th><th scope="col">Mediana</th><th scope="col">P95</th><th scope="col">Rostos</th><th scope="col">Identificação</th></tr></thead><tbody>${rows.map(row => {
      const matchedFaces = Array.isArray(row.faces) ? row.faces.filter(face => face.status === 'matched') : [];
      const identified = matchedFaces.length ? matchedFaces.map(face => face.profile?.name).filter(Boolean).join(', ') : Array.isArray(row.matched) ? row.matched.map(item => typeof item === 'object' ? item.name || item.id : item).join(', ') : Number(row.matched) ? row.matched + ' correspondência(s)' : 'Nenhuma';
      return `<tr data-best="${row === fastestComparable}"><td>${scaleLabel(row.scale)}${Number(row.scale) === 0.1 ? ' *' : ''}${row.detection ? '<br><small>' + row.detection.width + ' × ' + row.detection.height + '</small>' : ''}</td><td>${decimal(row.median_ms)} ms<br><small>Média ${decimal(row.mean_ms)} ms${row.min_ms != null ? '<br>Faixa ' + decimal(row.min_ms) + '–' + decimal(row.max_ms) + ' ms' : ''}</small></td><td>${decimal(row.p95_ms)} ms</td><td>${row.faceCount}</td><td>${escapeHTML(identified)}${row.observation && expected ? '<br><small>' + escapeHTML(observationLabels[row.observation.reason]) + '</small>' : ''}${row.stable === false ? '<br><span class="badge warning">'+(row.gallery_changed ? 'Galeria alterada / repita' : 'Decisão variou nas repetições')+'</span>' : ''}</td></tr>`;
    }).join('')}</tbody></table></div><p class="dev-help">${fastestComparable ? 'Destaque: ' + scaleLabel(fastestComparable.scale) + ' apresentou o menor tempo com o mesmo resultado observado em 100%. ' : 'Nenhuma estratégia destacada: a referência não permite comparar resultados faciais confiáveis. '}Tempos do serviço; P95 sobre ${payload.iterations || Number(el('iterations').value)} medições, uma amostra pequena.${expected ? ' Esperado: ' + escapeHTML(expectedProfile?.name || 'pessoa não cadastrada') + '.' : ' Selecione a identidade esperada para avaliar as correspondências.'} Estabilidade não comprova precisão. * 10% é experimental.</p>`;
    rows.forEach(row => {
      if (Array.isArray(row.faces)) recordResult({ faces:row.faces, timings:row.timings || { total_ms:row.mean_ms }, detection:row.detection }, { ...config, scale:row.scale }, 'benchmark', null);
    });
  };
  const exportRecords = () => {
    const header = ['horario_utc','origem','escala','limiar','identidade_esperada','rostos','identidades_previstas','similaridades','resultado','tp','fp','fn','tn','resposta_ms','python_ms','detectar_ms','reconhecer_ms','deteccao_largura','deteccao_altura','leitura_ms','fila_ms','escala_efetiva','rostos_refinados','tamanho_rosto_px','brilho','nitidez'];
    const rows = state.records.map(record => [record.at,record.source,record.scale,record.threshold,record.expected,record.faces.length,record.faces.map(face => face.status === 'matched' ? face.profile?.name : face.status).join(' | '),record.faces.map(face => face.similarity ?? '').join(' | '),record.observation.reason,record.observation.tp,record.observation.fp,record.observation.fn,record.observation.tn,record.roundtrip,record.timings?.total_ms,record.timings?.detect_ms,record.timings?.recognize_ms,record.detection?.width,record.detection?.height,record.timings?.decode_ms,record.timings?.queue_ms,record.detection?.effective_scale,record.detection?.refined_faces,record.faces.map(face=>face.quality?.face_pixels ?? '').join(' | '),record.faces.map(face=>face.quality?.brightness ?? '').join(' | '),record.faces.map(face=>face.quality?.sharpness ?? '').join(' | ')]);
    const csv = '\uFEFF' + [header,...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aegis-developer-test-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const setMenu = open => {
    const wasOpen = state.menuOpen;
    state.menuOpen = open;
    document.getElementById('sidebar').classList.toggle('open', open);
    el('menu-scrim').classList.toggle('visible', open);
    el('menu-open').setAttribute('aria-expanded', String(open));
    if (open) el('menu-close').focus();
    else if (wasOpen) el('menu-open').focus();
  };

  el('menu-open').addEventListener('click', () => setMenu(true));
  el('menu-close').addEventListener('click', () => setMenu(false));
  el('menu-scrim').addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (!state.menuOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
    if (event.key === 'Tab' && matchMedia('(max-width:760px)').matches) {
      const items=[...document.getElementById('sidebar').querySelectorAll('a,button')].filter(item=>!item.disabled&&item.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  el('reconnect').addEventListener('click', health);
  el('profile-reconnect').addEventListener('click', health);
  el('start').addEventListener('click', startCamera);
  el('stop').addEventListener('click', () => stopLive());
  el('device').addEventListener('change', () => { if (state.stream) { stopLive(); startCamera(); } });
  const updateThreshold = () => {
    const threshold = Number(el('threshold').value);
    const format = value => value.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
    el('threshold-value').textContent = format(threshold);
    const band=state.rules?.decision.uncertainty_band;
    el('decision-rule').textContent = band==null ? 'Conecte o servidor para consultar a regra de decisão.' : `Aceite ≥ ${format(threshold + band)} · faixa incerta de ${format(threshold - band)} a ${format(threshold + band)}.`;
  };
  el('threshold').addEventListener('input', () => { updateThreshold(); resetTemporal('Sem confirmação · parâmetros alterados'); });
  el('scale').addEventListener('change', () => resetTemporal('Sem confirmação · parâmetros alterados'));
  el('reset-config').addEventListener('click', () => { if (!state.rules) return; resetTemporal(); el('scale').value = 'auto'; el('threshold').value = state.rules.decision.default_threshold; el('ground-truth').value = ''; el('report-expected').value = ''; updateThreshold(); showMessage(`Parâmetros restaurados: escala automática e limiar ${score(state.rules.decision.default_threshold)}.`); });
  el('enroll-images').addEventListener('change', event => { try { addEnroll([...event.target.files]); showMessage(''); } catch (error) { showError(error); } event.target.value = ''; });
  el('enroll-previews').addEventListener('click', event => { const button = event.target.closest('[data-photo]'); if (!button || state.busy) return; const [entry] = state.enroll.splice(Number(button.dataset.photo), 1); URL.revokeObjectURL(entry.url); renderEnroll(); });
  el('capture-enroll').addEventListener('click', async () => { try { addEnroll([await captureFrame()]); showMessage('Quadro adicionado às fotos de cadastro. Confira a nitidez antes de cadastrar.'); } catch (error) { showError(error); } });
  el('enroll-check').addEventListener('click', () => runOperation(el('enroll-check'),'Avaliando…',async signal=>{
    el('enroll-diagnostics').hidden=true;
    const form=new FormData();
    state.enroll.forEach(entry=>form.append('images',entry.file,entry.file.name));
    const report=await request('/enrollment-check',{method:'POST',body:form,signal,timeout:60000});
    renderEnrollmentReport(report);
    showMessage('Avaliação concluída. Nenhum perfil foi salvo.',report.can_enroll ? 'success' : 'info');
  }));
  el('enroll-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = el('name').value.trim();
    if (!name || !state.enroll.length) { showMessage('Informe um nome e adicione pelo menos uma foto.', 'error'); return; }
    runOperation(el('enroll-submit'), 'Cadastrando…', async signal => {
      const form = new FormData();
      form.append('name', name);
      state.enroll.forEach(entry => form.append('images', entry.file, entry.file.name));
      await request('/profiles', { method:'POST', body:form, signal, timeout:60000 });
      clearEnroll();
      el('name').value = '';
      await refreshProfiles();
      showMessage(`Perfil ${name} cadastrado. Inicie ou retome a câmera para testar.`, 'success');
    });
  });
  el('refresh-profiles').addEventListener('click', () => runOperation(el('refresh-profiles'), 'Atualizando…', refreshProfiles));
  el('profiles').addEventListener('click', event => {
    const button = event.target.closest('[data-profile]');
    if (!button || state.busy) return;
    const profile = state.profiles.find(item => item.id === button.dataset.profile);
    if (!profile || !window.confirm(`Excluir o perfil ${profile.name} e seus descritores faciais deste computador?`)) return;
    runOperation(button, '…', async signal => { await request('/profiles/' + encodeURIComponent(profile.id), { method:'DELETE', signal }); await refreshProfiles(); showMessage('Perfil excluído.', 'success'); });
  });
  el('test-image').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { await setImage(file); showMessage(''); } catch (error) { showError(error); } });
  el('capture-test').addEventListener('click', async () => { try { await setImage(await captureFrame()); showMessage('Imagem capturada. Todas as estratégias usarão este mesmo quadro.'); } catch (error) { showError(error); } });
  el('clear-image').addEventListener('click', () => clearImage());
  el('recognize-image').addEventListener('click', () => runOperation(el('recognize-image'), 'Analisando…', async signal => {
    const config = configuration();
    const started = performance.now();
    const result = await request('/recognize', { method:'POST', body:buildForm(state.image, config), signal });
    const roundtrip = performance.now() - started;
    const canvas = el('image-canvas');
    canvas.getContext('2d').drawImage(state.imageBitmap, 0, 0);
    drawFaces(canvas.getContext('2d'), result, canvas.width, canvas.height);
    renderResult(result, roundtrip, 'image');
    recordResult(result, config, 'image', roundtrip);
    showMessage(`${result.faces.length} ${result.faces.length === 1 ? 'rosto detectado' : 'rostos detectados'} na imagem.`, 'success');
  }));
  el('benchmark').addEventListener('click', () => runOperation(el('benchmark'), 'Comparando…', async signal => {
    const config = configuration();
    const form = buildForm(state.image, config);
    form.append('iterations', el('iterations').value);
    const payload = await request('/benchmark', { method:'POST', body:form, signal, timeout:120000 });
    renderBenchmark(payload, config);
    showMessage(payload.gallery_changed ? 'A galeria mudou durante o benchmark. Repita a comparação.' : `Comparação concluída na mesma imagem, com ${payload.iterations || el('iterations').value} medições por estratégia.`, payload.gallery_changed ? 'info' : 'success');
  }));
  el('export').addEventListener('click', exportRecords);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-cancel-operation]')) {
      state.operationController?.abort();
      controls();
    }
  });
  el('report-start').addEventListener('click', startTimedSession);
  el('report-stop').addEventListener('click', () => finishTimedSession('interrupted'));
  el('report-current').addEventListener('click', summarizeCurrent);
  el('report-expected').addEventListener('change', () => { resetTemporal('Sem confirmação · anotação alterada'); el('ground-truth').value = el('report-expected').value; });
  el('ground-truth').addEventListener('change', () => { resetTemporal('Sem confirmação · anotação alterada'); el('report-expected').value = el('ground-truth').value; });
  el('report-copy').addEventListener('click', async () => {
    const text = el('report-text').value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      el('report-status').textContent = 'Resumo copiado. Você pode colar o texto nesta conversa.';
    } catch {
      el('report-text').focus();
      el('report-text').select();
      el('report-status').textContent = 'O navegador bloqueou a cópia automática. O texto está selecionado; use Ctrl+C ou baixe o TXT.';
    }
  });
  const downloadReport = format => {
    if (!state.report) return;
    const json = format === 'json';
    const content = json ? JSON.stringify(state.report,null,2) : el('report-text').value;
    const url = URL.createObjectURL(new Blob([content],{type:json?'application/json;charset=utf-8':'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aegis-resumo-' + (state.report.session.ended_at || new Date().toISOString()).replace(/[:.]/g,'-') + '.' + format;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  el('report-download').addEventListener('click', () => downloadReport('txt'));
  el('report-json').addEventListener('click', () => downloadReport('json'));
  el('clear-records').addEventListener('click', () => { resetTemporal(); state.records = []; renderMetrics(); showMessage('Medições desta sessão limpas.'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.stream) stopLive();
    if (!document.hidden && (!state.connected || !state.ready) && location.protocol !== 'file:') scheduleReconnect();
  });
  video.addEventListener('resize', () => { if (video.videoWidth && video.videoHeight) el('camera-stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`; });
  window.addEventListener('pagehide', () => { clearTimeout(reconnectTimer); reconnectTimer = null; stopLive(); state.operationController?.abort(); clearEnroll(); clearImage(); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => mediaDevices().catch(() => {}));
  try {
    const session = JSON.parse(sessionStorage.getItem('aegis.demo.session') || 'null');
    if (typeof session?.institution === 'string' && session.institution.trim() && session.institution.length <= 80) el('avatar').textContent = session.institution.trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase();
  } catch {}
  mediaDevices().catch(() => {});
  updateThreshold();
  health();
})();
