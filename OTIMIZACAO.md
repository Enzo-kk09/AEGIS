# Otimização do laboratório — 11/10/2026

## Entrega Aegis3t

O commit `25a3a1e1fd3066881f007d6059ca98c1e5c6c161` está na `main` de `Enzo-kk09/aegis3t`. A cópia de entrega fica em `.runtime/aegis3t-visual`, separada do projeto local. Não foram enviados Python, modelos, bancos, fotos nem mudanças no Developer Test.

Os 13 cenários de frontend passaram tanto na cópia estática do commit quanto no site publicado em https://aegistcc.netlify.app. Cobrem login, bloqueio de armazenamento, recuperação de dados, todas as telas em desktop/celular, cadastros e filtros de alunos, conflitos entre abas, busca, configurações, suporte, consultas, PRB, menus, foco e CSV. A suíte usa contextos isolados e dados demonstrativos.

A comparação dos 27 arquivos alterados encontrou 26 correspondências exatas e uma única transformação em `Privacidade.html`: o link estático `DadosGerais.html` tornou-se `/dadosgerais`, com mudança de aspas. Todo o restante desse HTML corresponde ao commit. O destino responde HTTP 200. Essa transformação é compatível com o [processamento de Pretty URLs do Netlify](https://docs.netlify.com/build/post-processing/overview/). O relatório detalhado está em `.runtime/validation/deployment-audit.json`; não há workflows ou checks de CI associados ao commit. A evidência de funcionamento vem dos testes e da leitura do site publicado.

## Python

PNG e WebP comuns passam a usar decodificação direta em BGR pelo OpenCV, como já acontecia com JPEG comum. Isso evita a leitura do buffer RGB seguida de conversão e cópia para BGR. Os limites de arquivo e de dimensões, a rejeição de animações e a validação de formato continuam antes da leitura nativa.

PNGs sem metadados de orientação passam por verificação dos CRCs dos chunks e término IEND. PNGs com EXIF, inclusive após IDAT, e XMP conservam a leitura com Pillow. Orientações EXIF diferentes da original, paletas, transparência em RGBA e imagens de maior profundidade também conservam o caminho apropriado de conversão. Os testes comparam pixels, não somente dimensões.

Medições alternadas, 30 execuções por caminho, uma imagem local de 1536 × 1536 pixels:

| Formato | Mediana anterior | Mediana otimizada | Razão anterior/otimizada |
| --- | ---: | ---: | ---: |
| PNG | 68,92 ms | 55,53 ms | 1,24× |
| WebP | 125,28 ms | 63,33 ms | 1,98× |

Não houve diferença nos pixels decodificados dessa amostra. Essas medições são de leitura de imagem nesta máquina; não representam aumento equivalente da velocidade total nem melhoria de precisão facial. O relatório e o script de reprodução estão em `.runtime/validation/native-formats-results.json` e `measure_native_formats.py`.

## Developer Test

O benchmark compara Auto, 100%, 50%, 25% e 10%. Auto conserva tentativas e refinamentos; as escalas fixas conservam seu comportamento anterior. Cada estratégia recebe aquecimento e três ou cinco medições. A resposta acrescenta mediana, mínimo, máximo e estabilidade das decisões; a interface mostra média e P95 junto da mediana e da faixa.

O destaque de velocidade exige decisões estáveis e o mesmo conjunto de estados/identidades observado em 100%. Uma linha que muda de identidade entre repetições é sinalizada e não recebe destaque. Repetir uma decisão não comprova que ela esteja correta. A ajuda contextual descreve leitura única, custo de leitura incluído nos totais, fila separada e limites da amostra pequena.

A reconexão automática também funciona após erros de rede ou invalidação de sessão quando o Python reinicia. Nome e fotos selecionadas permanecem no formulário; cadastros não são reenviados automaticamente. O serviço local foi reiniciado com a nova implementação, está pronto na porta 8765 e preservou a contagem de perfis existente.

## Resumos de identificação

A aba Validação recebe um teste de câmera por 30, 60 ou 180 segundos. O prazo começa depois da abertura da câmera; a câmera é desligada ao concluir ou interromper o teste. O resumo considera somente capturas concluídas dentro da sessão, preserva dados em caso de erro e pode ser copiado ou baixado em TXT/JSON. Há também um botão para resumir capturas individuais já realizadas.

O relatório separa detecção, identificação aceita e correção nos casos anotados. Inclui resolução, parâmetros, referências por perfil anônimo, estados, falsos positivos/negativos, qualidade e suas distribuições, mediana/P95 dos tempos, similaridade, margem, motivos de falha e exemplos para revisão. Não contém fotos, vetores, nomes, IDs biométricos ou token. Sem anotação, não informa precisão. Benchmarks ficam fora do resumo e das métricas de identificação.

O teste bloqueia alterações de escala, limiar e cadastro durante a captura, mas permite atualizar a identidade esperada. Uma resposta que estava em andamento antes do início não entra na nova sessão. O histórico preenchido revelou uma expansão indevida do grid no celular; a largura do laboratório foi corrigida para manter a rolagem dentro da tabela.

A consulta de saúde do Python deixa de esperar o bloqueio de uma inferência após os modelos estarem inicializados. Dois testes de concorrência verificam resposta durante o bloqueio e ausência de publicação de um estado parcialmente inicializado.

## Análise de CPU antes da pausa

O perfil de 120 inferências confirmou que detecção YuNet e extração SFace concentram cerca de 95% do tempo medido. A comparação vetorizada ficou abaixo de 0,5 ms mesmo com 5.000 perfis simulados e três referências por perfil. Trocar a linguagem do código de controle não resolve esse custo nativo.

A máquina informou 12 CPUs lógicas disponíveis. Uma comparação alternada, com quatro blocos, aquecimento por configuração e 12 execuções medidas por imagem/configuração, encontrou:

| Imagem de teste | Mediana com 2 threads | Mediana com 4 threads | Redução observada |
| --- | ---: | ---: | ---: |
| Quadro simulado de 1280 × 720 | 98,92 ms | 65,37 ms | 33,9% |
| Imagem de 1536 × 1536 | 94,95 ms | 64,82 ms | 31,7% |

As decisões permaneceram iguais e a diferença de similaridade ficou dentro de 0,0001. São medições de inferência nestas duas imagens nesta máquina; não incluem captura, transmissão ou leitura, nem demonstram precisão geral. Os scripts e resultados estão em `.runtime/validation/profile_processing.py`, `processing-profile.json`, `measure_cpu_threads.py` e `cpu-threads-results.json`.

A configuração do serviço de uso normal permaneceu em duas threads. A próxima melhoria pode avaliar quatro threads na inicialização, com limite conforme o processador e respeito à variável `AEGIS_CPU_THREADS`. A configuração deve ocorrer antes das operações concorrentes, pois [setNumThreads não é thread-safe](https://docs.opencv.org/4.13.0/db/de0/group__core__utils.html). Nenhuma mudança de produção foi feita nesta análise; o usuário solicitou pausar o objetivo ao concluí-la.

## Validação local

- 104 testes Python passaram, incluindo concorrência na consulta de saúde, todas as orientações EXIF em PNG/WebP, EXIF tardio no PNG, paleta, RGBA, 16 bits, CRC inválido, truncamento, animações, outliers e decisões instáveis no benchmark.
- 36 casos síncronos de utilitários JavaScript passaram no Chromium, incluindo estatísticas, anonimização, exclusão de benchmarks, falhas, qualidade e ausência de métricas inventadas sem anotação.
- 15 cenários de navegador passaram com banco temporário, modelos reais e câmera simulada. O teste específico do laboratório passou em 320, 390, 768 e 1440 pixels, inclusive exportação do resumo de uma imagem sem incluir suas cinco linhas de benchmark.
- Nove cenários novos verificaram os prazos de 30/60/180 segundos, erros/cancelamentos, anotação, cópia, downloads e relatório preenchido nas quatro larguras.
- Duas sessões de 30 segundos reais concluíram 145 e 130 capturas da mesma imagem conhecida, todas com correspondência correta nesse teste controlado e sem FP/FN. As taxas observadas foram 4,83 e 4,33 análises/s; medianas de processamento 68,31 e 98,17 ms; P95 84,59 e 118,88 ms. Os testes ocorreram com outras verificações em execução, portanto esses tempos não são um benchmark isolado. A câmera foi liberada e o relatório foi exportado. Isso mede consistência na imagem usada, não precisão em condições reais.
- As regressões de conexão passaram, incluindo rotação do token após reinício, preservação das fotos e ausência de cadastro automático.
- O serviço de uso normal respondeu ao benchmark com as cinco estratégias e as novas estatísticas. A contagem de perfis permaneceu a mesma antes e depois; nenhum cadastro existente foi removido.

Todo este trabalho de Python e laboratório permanece no AegisPy local. Nenhum novo commit foi enviado ao Aegis3t nesta etapa.

## Implementação dos seis temas — 11/10/2026

A configuração de CPU agora escolhe automaticamente até quatro threads, conforme a capacidade disponível, respeitando `AEGIS_CPU_THREADS` e aplicando o ajuste antes das operações concorrentes. O cancelamento usa um evento observado ao aguardar o modelo e entre etapas; não interrompe chamadas nativas em andamento. Cancelar antes da gravação impede o cadastro; transações já iniciadas terminam atomicamente.

`developer_test/rules.py` reúne regras versionadas de decisão, qualidade, limites, detector, captura e confirmação temporal. Controles e ajuda usam o contrato validado do Python; relatórios não presumem limites ausentes. Falha de versão bloqueia o processamento. O relatório v2 inclui regras completas, versão do backend, checksums dos modelos e revisões opacas da galeria, sem exportar IDs de perfis. As revisões da galeria são aleatórias e não derivam dos vetores biométricos.

O novo diagnóstico de cadastro avalia cada foto sem gravar: medidas, orientações, consistência dos pares, redundância e semelhança com perfis existentes. A gravação final repete as verificações. A confirmação temporal exige três capturas concordantes por 400 ms, com continuidade de posição e idade limitada; expira durante solicitações travadas e reinicia após ausência, múltiplos rostos, troca de contexto ou interrupção. O relatório mantém as decisões por quadro e avalia as confirmações separadamente, inclusive as incorretas.

Testes simultâneos revelaram recusas de arquivos estáticos pelo limite global de 12 conexões. O limite passou a 64 e o keepalive a dois segundos, mantendo duas solicitações de processamento. Quatro abas carregaram recursos, controles e saúde sem erros. Cadastros concorrentes não duplicaram o mesmo rosto; exclusão/substituição de referências durante inferência tornou o resultado incerto. Capturas com galeria alterada não recebem pontuação de identidade, e benchmarks invalidados não recebem destaque de velocidade.

Validação final: 138 testes Python, 61 casos JavaScript, 15 cenários gerais no navegador, 12 cenários de sessão, regressões específicas de cadastro/reconexão/cancelamento/contrato/layout e testes PowerShell passaram. Sondas com modelos reais cobriram foto válida, referências repetidas/inconsistentes, pessoa desconhecida, desfoque, escuridão, rosto pequeno, compressão e múltiplos rostos. Resultados em `enrollment-diagnostics-real-models.json` e `degraded-recognition-real-models.json`, dentro de `.runtime/validation/review/`.

A sessão final de 30 segundos com câmera simulada concluiu 136 capturas, 136 correspondências corretas por quadro, duas capturas pendentes e 134 confirmações corretas, com primeira confirmação em 569,1 ms. É consistência sobre uma imagem pública conhecida; não demonstra precisão em pessoas independentes ou condições reais. `python -m developer_test.compare_reports anterior.json atual.json` compara parâmetros registrados, contagens e medianas sem tirar essa conclusão indevida.

O serviço final ficou ativo e seus arquivos foram conferidos com o workspace. O banco normal recebeu um cadastro adicional durante o trabalho; os dois perfis atuais foram preservados. Os testes reais usaram bancos temporários. A auditoria do runtime está em `final-runtime-audit.json`; o checkout de entrega continuou limpo no mesmo commit visual, sem publicar este trabalho local.
