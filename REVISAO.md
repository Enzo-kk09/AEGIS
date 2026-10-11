# Revisão do console e do reconhecimento — 8 de outubro de 2026

As telas agora usam uma identidade consistente de console: navegação em grafite, ação em verde petróleo, superfícies claras, hierarquia de títulos, números monoespaçados e estados de erro mais legíveis. Login, dashboard, tabelas, formulários, relatórios, consultas e páginas públicas compartilham essa direção. Os pontos de acesso sem imagem mostram explicitamente que não há transmissão ao vivo, e o status do console identifica o ambiente demonstrativo.

## Developer Test

- Abas **Análise**, **Perfis de referência** e **Validação da sessão**; câmera e arquivo são fontes distintas. Mudar para outra aba pausa a inferência, preservando a câmera para captura de referências.
- Pipeline clicável e botões `?` com explicações sobre modelos, alinhamento, vetores, qualidade, câmera, limiar, tempos e métricas. Os diálogos suportam Escape e devolvem o foco ao botão; as abas suportam setas, Home e End.
- Escala automática como padrão da interface, com modos manuais preservados.
- Resultado com motivos, tamanho do rosto, luz, nitidez, score de detecção, similaridade e margem entre perfis. Resposta JSON inspecionável e telemetria por etapa.
- Benchmark com aquecimento e três ou cinco medições por escala; dimensões reais do detector e destaque somente quando o resultado observado coincide com o de 100%. Sem rosto de referência ou com baixa qualidade, não sugere uma escala.
- Contagens TP/FP/FN/TN, precisão, recall, acurácia, últimas observações e CSV ampliado com diagnósticos. As métricas continuam exigindo anotação antes da análise.

## Motor e desempenho

`developer_test/engine.py` conserva YuNet e SFace e a implementação nativa do OpenCV. A estratégia automática limita o lado maior inicialmente a 768 pixels, tenta até 1920 quando não há faces e refina regiões pequenas em resolução original. A caixa refinada precisa sobrepor a anterior; um vizinho não pode substituir a detecção. O cadastro também usa esse caminho, evitando depender sempre da detecção em resolução integral.

JPEGs comuns são decodificados diretamente em BGR, reduzindo cópias e conversões. O caminho Pillow preserva orientação EXIF, cores especiais e outros formatos. JPEGs truncados são rejeitados. A galeria vazia evita a extração de vetores SFace; a resposta continua explicando que é necessário cadastrar uma referência. O detector reutiliza o tamanho de entrada quando possível, e a busca continua vetorizada com a galeria em cache.

Os filtros de qualidade agora retornam os valores medidos. Os tempos incluem leitura, detecção, reconhecimento, extração de vetor, busca e espera na fila. O benchmark retorna dimensões, médias por etapa e número de repetições. A API aceita `scale=auto` e conserva os valores numéricos e o padrão anterior para clientes existentes. Nenhuma migração do banco foi necessária.

## Medições locais

Estas medições usam amostras já presentes em `.runtime/downloads/`, banco temporário isolado e a CPU desta máquina. Elas verificam consistência e desempenho; não estimam precisão no ambiente escolar.

| Cenário | Resultado observado |
| --- | --- |
| Referência original, 512 × 512 | Identificada; cosseno 1,00000 (mesma imagem do cadastro) |
| Mesma amostra ampliada a 1536 × 1536 | Automática identificou, cosseno 0,93476; escala fixa 100% não detectou o rosto |
| Rosto pequeno inserido em imagem 1280 × 720 | Identificado, cosseno 0,90640; landmarks refinados; rosto de 70,43 pixels |
| Amostra de outra pessoa | Rejeitada como desconhecida; cosseno −0,20830 |
| Amostras artificialmente escuras e desfocadas | Sem identificação aceita |
| Leitura JPEG 1536 × 1536, mediana de 30 execuções | Caminho anterior 23,93 ms; caminho nativo 7,70 ms, cerca de 3,1 vezes mais rápido |
| Pipeline automático 1536 × 1536, mediana de 7 execuções | 62,94 ms nesta medição; escala 50% na mesma entrada: 63,85 ms |

Os resultados completos estão em `.runtime/validation/review/pipeline-results.json`. Variação de carga e hardware altera os tempos. Ainda é necessário avaliar fotos independentes, pessoas desconhecidas e a câmera física do usuário; não foi feita uma avaliação de precisão representativa. Não há detecção de vivacidade.

## Arquivos e validação

- `console.css` e `style.css`: sistema visual comum e layouts responsivos.
- `AegisShared.js`: navegação e estrutura do console centralizadas, avatar por iniciais quando não há foto e estado demonstrativo explícito.
- Scripts das nove telas administrativas: passam a usar a estrutura compartilhada; dashboard com resumo dos registros e estados de captura claros. `index.js`: nova composição do acesso.
- `DeveloperTest.html` e `DeveloperTest.js`: novo workspace, ajuda contextual, telemetria, benchmark e avaliação.
- `developer_test/app.py`: escala automática, dados do runtime e inclusão da nova folha de estilos na lista de arquivos permitidos.
- `developer_test/tests/`: casos adicionais para automático, refinamento, vizinhos, qualidade, galeria vazia, orientação EXIF, JPEG truncado e parâmetros de API.
- `developer_frontend.test.cjs` e `tests/laboratory_interface.py`: benchmark comparável e comportamento da interface. Regressões existentes adaptadas à navegação por abas.

Validação executada: 74 testes Python e 26 casos síncronos de utilitários JavaScript passaram; 15 cenários de navegador passaram, incluindo modelos reais e câmera simulada, páginas em desktop/celular, formulários, cadastros, filtros, PRB e exportação. O teste específico do laboratório também passou nos quatro tamanhos de tela, assim como as regressões de troca assíncrona de imagem e exclusão de perfis sem modelos. As capturas da interface com respostas simuladas são artefatos de teste, não resultados biométricos reais.

O ambiente não tem Node no PATH. Os testes de utilitários JavaScript foram avaliados no Chromium com um adaptador de assertions; os testes de comportamento foram executados pelo Playwright. A única advertência observada na suíte Python é a depreciação já existente do cliente de testes HTTP da Starlette.
