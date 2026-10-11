'use strict';

(() => {
  const rounded = value => Math.round(value * 100) / 100;
  const statistics = values => {
    const sorted = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a,b) => a-b);
    if (!sorted.length) return {samples:0, mean:null, median:null, p95:null, min:null, max:null};
    const percentile = fraction => {
      const index = (sorted.length - 1) * fraction;
      const lower = Math.floor(index);
      return rounded(sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower));
    };
    return {samples:sorted.length, mean:rounded(sorted.reduce((a,b) => a+b,0)/sorted.length), median:percentile(.5), p95:percentile(.95), min:rounded(sorted[0]), max:rounded(sorted.at(-1))};
  };
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const publicRules = rules => {
    if (rules?.version !== 1 || !/^[a-f0-9]{16}$/.test(rules.revision || '')) return null;
    const result = {version:rules.version,revision:rules.revision};
    for (const section of ['decision','quality','enrollment','upload','detector','capture','benchmark','temporal']) {
      result[section] = Object.fromEntries(Object.entries(rules[section] || {}).filter(([,value]) => numeric(value) || (Array.isArray(value) && value.every(numeric))));
    }
    return result;
  };
  const publicProvenance = value => {
    if (!/^[a-f0-9]{16}$/.test(value?.backend_revision || '')) return null;
    return {backend_revision:value.backend_revision,model_revision:/^[a-f0-9]{40}$/.test(value.model_revision || '') ? value.model_revision : null,
      model_checksums:Object.fromEntries(['YuNet','SFace'].filter(name=>/^[a-f0-9]{64}$/.test(value.model_checksums?.[name] || '')).map(name=>[name,value.model_checksums[name]]))};
  };
  const buildReport = (allRecords, context, evaluate) => {
    const records = allRecords.filter(record => ['camera','image'].includes(record.source));
    const metrics = evaluate(records);
    const aliases = new Map();
    const alias = id => {
      if (!id) return 'Sem anotação';
      if (id === '__unknown__') return 'Pessoa não cadastrada';
      if (!aliases.has(id)) aliases.set(id, 'Perfil ' + (aliases.size + 1));
      return aliases.get(id);
    };
    const profiles = (context.profiles || []).map(profile => ({label:alias(profile.id), references:profile.samples}));
    const faces = records.flatMap(record => record.faces || []);
    const ruleSets = [...new Map([context.rules,...records.map(record => record.rules)].map(publicRules).filter(Boolean).map(rules => [rules.revision,rules])).values()];
    const statuses = {matched:0, unknown:0, uncertain:0, low_quality:0};
    const quality = {small:0, lighting:0, blurred:0, cropped:0, pose:0};
    const reasons = new Map();
    const identifications = new Map();
    let competing = 0;
    for (const face of faces) {
      if (Object.hasOwn(statuses, face.status)) statuses[face.status]++;
      if (face.reason) reasons.set(face.reason, (reasons.get(face.reason) || 0) + 1);
      if (face.status === 'matched') {
        const label = alias(face.profile?.id);
        identifications.set(label, (identifications.get(label) || 0) + 1);
      }
      const q = face.quality || {};
      if (numeric(q.face_pixels) && numeric(q.minimum_pixels) && q.face_pixels < q.minimum_pixels) quality.small++;
      if (numeric(q.brightness) && numeric(q.brightness_min) && numeric(q.brightness_max) && (q.brightness < q.brightness_min || q.brightness > q.brightness_max)) quality.lighting++;
      if (numeric(q.sharpness) && numeric(q.minimum_sharpness) && q.sharpness < q.minimum_sharpness) quality.blurred++;
      if (q.signals?.cropped || /cortado|fora da imagem/i.test(q.reason || '')) quality.cropped++;
      if (q.signals?.pose || /direção à câmera|alinhamento/i.test(q.reason || '')) quality.pose++;
      if (numeric(face.comparison?.margin) && numeric(face.comparison.required_margin) && face.comparison.margin < face.comparison.required_margin) competing++;
    }
    const frames = {total:records.length, with_faces:records.filter(record => record.faces?.length).length,
      no_face:records.filter(record => !record.faces?.length).length,
      multiple_faces:records.filter(record => record.faces?.length > 1).length,
      annotated:records.filter(record => Boolean(record.expected)).length};
    const duration = numeric(context.duration_ms) ? Math.max(0, context.duration_ms) : 0;
    const timings = Object.fromEntries(['total_ms','decode_ms','detect_ms','recognize_ms','embedding_ms','match_ms','queue_ms'].map(stage => [stage,statistics(records.map(record => record.timings?.[stage]))]));
    timings.roundtrip_ms = statistics(records.map(record => record.roundtrip));
    const stages = ['decode_ms','detect_ms','recognize_ms'].filter(stage => timings[stage].mean !== null).sort((a,b) => timings[b].mean-timings[a].mean);
    const expected = [...new Set(records.map(record => record.expected).filter(Boolean))].map(alias);
    const inputSizes = [...new Set(records.filter(record => record.image).map(record => `${record.image.width}x${record.image.height}`))];
    const detectionSizes = [...new Set(records.filter(record => record.detection).map(record => `${record.detection.width}x${record.detection.height}`))];
    const galleryCounts = [...new Set(records.map(record => record.profile_count).filter(numeric))];
    const galleryRevisions=[...new Set(records.map(record=>record.gallery_revision).filter(value=>/^[a-f0-9]{16}$/.test(value || '')))];
    const provenance=[...new Map(records.map(record=>publicProvenance(record.provenance)).filter(Boolean).map(value=>[value.backend_revision,value])).values()];
    const video=records.filter(record=>record.source==='camera' && record.temporal);
    const temporal={frames:video.length,confirmed:0,pending:0,unconfirmed:0,discarded:0,confirmation_events:0,
      annotated_confirmed:0,correct_confirmed:0,wrong_confirmed:0,known_without_confirmation:0,confirmation_precision:null,
      confirmation_latency_ms:statistics(video.filter(record=>record.temporal.new_confirmation).map(record=>record.temporal.confirmation_latency_ms))};
    for (const record of video) {
      const decision=record.temporal;
      if (Object.hasOwn(temporal,decision.status) && numeric(temporal[decision.status])) temporal[decision.status]++;
      temporal.confirmation_events+=Number(Boolean(decision.new_confirmation));
      if (decision.status==='confirmed' && record.expected) {
        temporal.annotated_confirmed++;
        if (decision.profile_id===record.expected) temporal.correct_confirmed++;
        else temporal.wrong_confirmed++;
      }
      if (record.expected && record.expected!=='__unknown__' && decision.status!=='confirmed') temporal.known_without_confirmation++;
    }
    if (temporal.annotated_confirmed) temporal.confirmation_precision=temporal.correct_confirmed/temporal.annotated_confirmed;
    const findings = [];
    if (!frames.total) findings.push('Nenhuma captura foi analisada. Não há dados para avaliar a identificação.');
    else if (!metrics.scored) findings.push('Sem observações pontuadas: só foi possível avaliar desempenho, detecção e qualidade, não a precisão das identidades.');
    else {
      findings.push(`${metrics.correct} decisões corretas entre ${metrics.scored} observações pontuadas; ${metrics.fp} falsos positivos e ${metrics.fn} falsos negativos.`);
      if (metrics.fp) findings.push('Há identidades aceitas incorretamente. Revise os exemplos de erro e as referências antes de ajustar o limiar.');
      if (!metrics.fp && !metrics.fn) findings.push('Não foram observados erros de identidade nos casos anotados desta sessão. Isso não comprova precisão em outras pessoas ou condições.');
    }
    if (frames.no_face) findings.push(`${frames.no_face} capturas não tiveram rosto detectado. Confira enquadramento, distância e iluminação.`);
    if (quality.small) findings.push(`${quality.small} rostos ficaram abaixo do tamanho mínimo na imagem original. Aproxime a câmera ou aumente a resolução real de captura.`);
    if (quality.blurred) findings.push(`${quality.blurred} rostos apresentaram baixa nitidez. Foco, movimento ou compressão podem estar envolvidos; este resumo não distingue essas causas.`);
    if (quality.lighting) findings.push(`${quality.lighting} rostos ficaram escuros ou superexpostos. Teste iluminação frontal mais uniforme.`);
    if (competing) findings.push(`${competing} comparações tiveram pouca diferença entre os dois melhores perfis. Revise a consistência das referências.`);
    if (galleryCounts.includes(0)) findings.push('Houve análises sem perfis de referência cadastrados. Nesses casos, localizar um rosto não permite identificar uma pessoa.');
    if (galleryCounts.length > 1) findings.push('A quantidade de perfis mudou durante o teste; as comparações usaram galerias diferentes.');
    if (galleryRevisions.length>1) findings.push('As referências da galeria mudaram durante as capturas, mesmo que a quantidade de perfis tenha permanecido igual.');
    if (records.some(record=>record.gallery_changed)) findings.push('A galeria mudou durante algumas análises. Essas capturas ficaram incertas e foram excluídas da avaliação de identidade.');
    if (provenance.length>1) findings.push('As capturas usaram versões diferentes do backend; separe as versões para comparação.');
    if (expected.length && !expected.includes('Pessoa não cadastrada')) findings.push('Não houve teste anotado de pessoa não cadastrada. A capacidade de rejeitar desconhecidos não foi avaliada.');
    if (!ruleSets.length) findings.push('Regras do serviço indisponíveis neste conjunto de capturas; os parâmetros de processamento não podem ser reproduzidos integralmente.');
    if (ruleSets.length > 1) findings.push('As regras do serviço mudaram durante as capturas; separe as revisões para comparar resultados.');
    const target = ruleSets.length === 1 ? ruleSets[0].capture?.target_analyses_per_second : null;
    if (numeric(target) && target > 0 && timings.total_ms.p95 > 1000/target) findings.push(`O P95 do processamento ultrapassou ${rounded(1000/target)} ms, o intervalo alvo de ${target} análises por segundo. Use os tempos por etapa para investigar a demora.`);
    if (context.errors?.length) findings.push(`${context.errors.length} erros interromperam ou afetaram a captura; consulte os erros registrados.`);
    if (temporal.wrong_confirmed) findings.push(`${temporal.wrong_confirmed} capturas tiveram confirmação temporal incorreta. Concordância repetida também pode confirmar o perfil errado.`);
    const examples = records.filter(record => record.observation?.fp || record.observation?.fn || !record.faces?.length || record.faces.some(face => ['low_quality','uncertain','unknown'].includes(face.status)))
      .sort((a,b) => (b.observation?.fp || 0) - (a.observation?.fp || 0) || (b.observation?.fn || 0) - (a.observation?.fn || 0))
      .slice(0,8).map(record => ({at:record.at, expected:alias(record.expected), outcome:record.observation?.reason || 'unannotated',
        faces:(record.faces || []).map(face => ({status:face.status, identity:face.profile?.id ? alias(face.profile.id) : null,
          similarity:face.similarity ?? null, margin:face.comparison?.margin ?? null, reason:face.reason || '',
          face_pixels:face.quality?.face_pixels ?? null, brightness:face.quality?.brightness ?? null, sharpness:face.quality?.sharpness ?? null})),
        processing_ms:record.timings?.total_ms ?? null}));
    const runtime = context.runtime || {};
    const camera = context.camera || {};
    return {
      report_version:2, source:'AEGIS Developer Test',
      session:{started_at:context.started_at || null, ended_at:context.ended_at || null, duration_seconds:rounded(duration/1000),
        requested_seconds:context.requested_seconds ?? null, end_reason:context.end_reason || 'manual',
        retained_limit:context.retained_limit ?? context.rules?.capture?.max_records ?? null, discarded_records:context.discarded_records || 0},
      runtime:{backend:runtime.backend || null, target:runtime.target || null, opencv:runtime.opencv || null, threads:runtime.threads ?? null,
        threads_mode:runtime.threads_mode || null,available_cpus:runtime.available_cpus ?? null},
      camera:{width:camera.width ?? null, height:camera.height ?? null, frame_rate:camera.frameRate ?? null},
      configuration:{scales:[...new Set(records.map(record => record.scale))], thresholds:[...new Set(records.map(record => record.threshold).filter(numeric))],
        input_sizes:inputSizes, detection_sizes:detectionSizes, expected_identities:expected, gallery_counts:galleryCounts, gallery_revisions:galleryRevisions,
        profiles, rule_sets:ruleSets, provenance, client_revisions:[...new Set(records.map(record=>record.client_revision).filter(numeric))]},
      frames, faces:{total:faces.length, ...statuses},
      observed_identification_rate:faces.length ? rounded(statuses.matched/faces.length*100) : null,
      analyses_per_second:duration ? rounded(frames.total/(duration/1000)) : null,
      evaluation:metrics, temporal, quality_signals:quality,
      quality_statistics:Object.fromEntries(['face_pixels','brightness','sharpness'].map(key => [key,statistics(faces.map(face => face.quality?.[key]))])),
      competing_profiles:competing,
      similarity:statistics(faces.map(face => face.similarity)), margin:statistics(faces.map(face => face.comparison?.margin)),
      timings, slowest_stage:stages[0] || null,
      reason_counts:[...reasons].sort((a,b) => b[1]-a[1]).map(([reason,count]) => ({reason,count})),
      identifications:[...identifications].map(([identity,count]) => ({identity,count})),
      findings, examples,
      errors:(context.errors || []).slice(0,10).map(error => ({at:error.at, message:error.message})),
      exclusions:{benchmark:allRecords.length-records.length, unscored:metrics.excluded},
      limitations:['Quadros consecutivos de vídeo são correlacionados; não representam pessoas ou testes independentes.',
        'Identificação aceita e similaridade não são probabilidade de acerto. Precisão exige identidade esperada anotada antes da captura.',
        'Uma sessão não comprova precisão geral nem detecta prova de vida. Fotos e telas podem produzir correspondências.',
        'O resumo contém somente texto e estatísticas. Nomes foram substituídos por rótulos; não há fotos, vetores faciais nem token da sessão.']
    };
  };
  const formatReport = report => {
    const number = value => numeric(value) ? value.toLocaleString('pt-BR',{maximumFractionDigits:2}) : 'não disponível';
    const percent = value => value == null ? 'não mensurável' : number(value*100)+'%';
    const m = report.evaluation;
    const statuses = {matched:'identificado',unknown:'não identificado',uncertain:'incerto',low_quality:'qualidade insuficiente'};
    const stages = {total_ms:'Total de processamento e leitura',decode_ms:'Leitura',detect_ms:'Detecção',recognize_ms:'Reconhecimento',embedding_ms:'Vetor facial',match_ms:'Comparação',queue_ms:'Espera no modelo',roundtrip_ms:'Captura até resposta'};
    const end = {completed:'tempo concluído',interrupted:'interrompido',error:'erro durante a captura',camera_error:'câmera não iniciou',manual:'resumo das capturas atuais'};
    const lines = [
      'AEGIS — RESUMO DE IDENTIFICAÇÃO / v'+report.report_version,
      `Início (UTC): ${report.session.started_at || 'não disponível'}`,
      `Fim (UTC): ${report.session.ended_at || 'não disponível'}`,
      `Duração: ${number(report.session.duration_seconds)} s / ${end[report.session.end_reason] || report.session.end_reason}`,
      `Capturas analisadas: ${report.frames.total}; com rosto: ${report.frames.with_faces}; sem rosto: ${report.frames.no_face}; múltiplos rostos: ${report.frames.multiple_faces}`,
      `Análises por segundo: ${number(report.analyses_per_second)} (não é o FPS da câmera)`,
      `Rostos: ${report.faces.total}; identificados: ${report.faces.matched}; incertos: ${report.faces.uncertain}; não identificados: ${report.faces.unknown}; qualidade insuficiente: ${report.faces.low_quality}`,
      `Taxa de identificação aceita: ${report.observed_identification_rate == null ? 'não mensurável' : number(report.observed_identification_rate)+'%'} (não é precisão)`,
      '', 'AVALIAÇÃO DOS CASOS ANOTADOS — POR QUADRO',
      `Anotadas: ${report.frames.annotated}; pontuadas: ${m.scored}; excluídas: ${m.excluded}`,
      `TP ${m.tp} / FP ${m.fp} / FN ${m.fn} / TN ${m.tn}`,
      `Precisão: ${percent(m.precision)}; recall: ${percent(m.recall)}; acurácia: ${percent(m.accuracy)}`,
      `Identidades esperadas: ${report.configuration.expected_identities.join(', ') || 'nenhuma'}`,
      '', 'CONFIRMAÇÃO TEMPORAL — CÂMERA',
      `Capturas avaliadas: ${report.temporal.frames}; confirmadas: ${report.temporal.confirmed}; aguardando concordância: ${report.temporal.pending}; sem confirmação: ${report.temporal.unconfirmed}; descartadas: ${report.temporal.discarded}`,
      `Transições para confirmado: ${report.temporal.confirmation_events}; mediana até confirmar: ${number(report.temporal.confirmation_latency_ms.median)} ms`,
      `Confirmações anotadas: ${report.temporal.annotated_confirmed}; corretas: ${report.temporal.correct_confirmed}; incorretas: ${report.temporal.wrong_confirmed}; precisão das confirmações: ${percent(report.temporal.confirmation_precision)}`,
      `Capturas de pessoa conhecida sem confirmação: ${report.temporal.known_without_confirmation} (inclui aquecimento, rejeições e respostas descartadas).`,
      'Esta precisão considera somente confirmações anotadas. Não mede recall nem pessoas independentes; decisões por quadro permanecem na avaliação acima.',
      '', 'CAPTURA E CONFIGURAÇÃO',
      `Câmera: ${number(report.camera.width)} × ${number(report.camera.height)} / ${number(report.camera.frame_rate)} FPS do dispositivo`,
      `Entradas: ${report.configuration.input_sizes.join(', ') || 'não disponível'}; detector: ${report.configuration.detection_sizes.join(', ') || 'não disponível'}`,
      `Escalas: ${report.configuration.scales.join(', ') || 'não disponível'}; limiares: ${report.configuration.thresholds.join(', ') || 'não disponível'}`,
      `Regras: ${report.configuration.rule_sets.map(rules => 'v'+rules.version+' / '+rules.revision).join(', ') || 'não disponíveis'}`,
      `Backend: ${report.configuration.provenance.map(value=>value.backend_revision).join(', ') || 'não disponível'}; versões da interface: ${report.configuration.client_revisions.join(', ') || 'não disponíveis'}`,
      `OpenCV: ${report.runtime.opencv || 'não disponível'} / ${report.runtime.backend || 'não disponível'} / ${report.runtime.target || 'não disponível'} / ${number(report.runtime.threads)} threads`,
      `Referências: ${report.configuration.profiles.map(profile => profile.label+' ('+profile.references+' fotos)').join(', ') || 'nenhuma'}`,
      '', 'TEMPOS (mediana / P95 / média, em ms)',
      ...Object.entries(report.timings).map(([key,stats]) => `${stages[key]}: ${number(stats.median)} / ${number(stats.p95)} / ${number(stats.mean)} (${stats.samples} medições)`),
      `Etapa mais demorada em média: ${stages[report.slowest_stage] || 'não disponível'}`,
      `Similaridade cosseno — mediana: ${number(report.similarity.median)}; margem entre perfis — mediana: ${number(report.margin.median)}`,
      '', 'SINAIS DE QUALIDADE (podem ocorrer juntos)',
      `Rosto pequeno: ${report.quality_signals.small}; baixa nitidez: ${report.quality_signals.blurred}; iluminação inadequada: ${report.quality_signals.lighting}; cortado: ${report.quality_signals.cropped}; pose/alinhamento: ${report.quality_signals.pose}`,
      ...Object.entries(report.quality_statistics).map(([key,stats]) => `${{face_pixels:'Tamanho do rosto (px)',brightness:'Iluminação (0–255)',sharpness:'Nitidez (Laplaciano)'}[key]} — mediana: ${number(stats.median)}; mínimo: ${number(stats.min)}; máximo: ${number(stats.max)} (${stats.samples} medições)`),
      `Comparações com perfis próximos: ${report.competing_profiles}`,
      '', 'MOTIVOS RETORNADOS',
      ...report.reason_counts.map(item => `${item.count}× ${item.reason}`),
      '', 'LEITURA DOS RESULTADOS', ...report.findings.map(text => '- '+text),
      '', 'EXEMPLOS PARA REVISÃO (até 8)',
      ...report.examples.map(example => `${example.at} / esperado: ${example.expected} / ${example.outcome} / ${example.faces.length ? example.faces.map(face => `${statuses[face.status] || face.status}${face.identity ? ' '+face.identity : ''}; cosseno ${number(face.similarity)}; margem ${number(face.margin)}; rosto ${number(face.face_pixels)} px; luz ${number(face.brightness)}; nitidez ${number(face.sharpness)}; ${face.reason}`).join(' | ') : 'nenhum rosto'} / ${number(example.processing_ms)} ms`),
      '', 'ERROS', ...report.errors.map(error => `${error.at}: ${error.message}`),
      '', 'LIMITES DO RESUMO', ...report.limitations.map(text => '- '+text),
      `Benchmark excluído: ${report.exclusions.benchmark} registros; capturas descartadas por limite: ${report.session.discarded_records}.`
    ];
    return lines.join('\n');
  };
  const utilities = Object.freeze({statistics, buildReport, formatReport});
  if (typeof module !== 'undefined' && module.exports) module.exports = utilities;
  else globalThis.AegisDeveloperReport = utilities;
})();
