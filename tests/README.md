Os testes abrem contextos isolados do Chromium. Eles não usam o armazenamento do navegador pessoal nem alteram cadastros biométricos existentes.

Com o servidor local iniciado, execute:

```powershell
.runtime\python\python.exe -m pip install -r tests\requirements.txt
.runtime\python\python.exe tests\browser_regression.py
```

Use `.venv\Scripts\python.exe` se estiver usando um ambiente virtual. Chrome e Edge instalados são encontrados automaticamente no Windows. Em outro ambiente, passe `--browser CAMINHO_DO_CHROMIUM` ou instale o Chromium com `python -m playwright install chromium`.

A suíte verifica todas as páginas em desktop e celular, login, formulários, cadastro e edição de alunos, filtros, conflito entre abas, menus, modais, PRB, consultas, suporte, solicitações, CSV e os erros do Developer Test. As imagens comuns são geradas em memória, sem downloads.

Para também verificar identificação e câmera simulada com os modelos reais, forneça duas fotos nítidas de pessoas diferentes:

```powershell
.runtime\python\python.exe tests\browser_regression.py --face foto-conhecida.jpg --other-face outra-pessoa.jpg
```

Esse teste cria um perfil com nome único e remove apenas o perfil criado por ele. Se a foto já corresponder a um cadastro existente, o teste é ignorado e o cadastro é preservado. A câmera física não é acionada.

O cenário real verifica também a avaliação sem gravação antes do cadastro, as cinco estratégias, sessão de 30 segundos, confirmação temporal e exportação anônima. Para executar toda a suíte real com banco descartável nesta máquina, use `.runtime\python\python.exe .runtime\validation\run_local_review.py`. Esse runner mantém os dados de uso normal intactos.

Para outra porta, use `--base-url http://127.0.0.1:8766`. Para executar um único cenário, acrescente `BrowserRegression.test_student_crud_filters_photo_and_export`.

As verificações adicionais do laboratório são:

```powershell
.runtime\python\python.exe tests\rule_contract.py
.runtime\python\python.exe tests\enrollment_diagnostics.py
.runtime\python\python.exe tests\operation_cancellation.py
.runtime\python\python.exe tests\cancellation_integration.py
.runtime\python\python.exe tests\concurrent_pages.py
```

O contrato testa regras alternativas e versões incompatíveis. O cadastro verifica diagnóstico por foto, avisos, invalidação e quatro larguras. Cancelamento verifica preservação dos arquivos e desconexão TCP. Quatro abas simultâneas verificam a carga dos recursos estáticos e conexão. `diagnostic_session.py` cobre também confirmação temporal, expiração durante solicitação travada, confirmação incorreta e mudança de galeria sem pontuação.

`python -m pytest developer_test/tests -q` inclui cadastros simultâneos, exclusão durante inferência, limite de processamento, snapshots imutáveis, comparação de relatórios e imagens degradadas. Sondas com modelos reais usam as fotos públicas locais de `.runtime/downloads`; são ignoradas se arquivos/modelos não estiverem instalados. Elas validam casos controlados, sem medir precisão geral em pessoas independentes. Evidências numéricas ficam em `.runtime/validation/review/`.

O teste específico do novo laboratório usa respostas simuladas e imagens geradas em memória, sem alterar o banco facial:

```powershell
.runtime\python\python.exe tests\laboratory_interface.py
```

Ele verifica abas com teclado, abertura e fechamento das explicações com retorno de foco, envio da escala automática, diagnóstico de qualidade, seleção de um benchmark comparável, métricas, CSV e layouts de 320, 390, 768 e 1440 pixels. As capturas e o CSV desse cenário de teste ficam em `.runtime/validation/review/`; suas identidades e métricas são simuladas.

O benchmark inclui Auto e quatro escalas fixas, mediana, média, faixa e estabilidade das decisões. As regressões de conexão verificam que as fotos selecionadas são preservadas quando o serviço volta, sem cadastrar automaticamente:

```powershell
.runtime\python\python.exe tests\developer_browser_regressions.py
```

Para verificar a versão estática de entrega sem depender da API facial, a partir do checkout local em `.runtime/aegis3t-visual`:

```powershell
.runtime\python\python.exe tests\delivery_regression.py
.runtime\python\python.exe tests\delivery_regression.py --base-url https://aegistcc.netlify.app
```

Essa seleção executa os 13 cenários de frontend, incluindo os cadastros demonstrativos, e exclui os testes da API de laboratório. Os contextos de navegador continuam isolados do navegador pessoal; nenhum teste desse comando chama o serviço facial.

Sem Node instalado, `python tests/js_utility_regressions.py` avalia os casos síncronos dos utilitários no Chromium com um adaptador de assertions. Isso complementa os testes de navegador; não executa o runner de testes do Node.

O teste do resumo por tempo usa uma câmera de canvas e respostas simuladas. Verifica encerramento automático, liberação da câmera, cancelamento enquanto a câmera abre, descarte de uma resposta anterior ao teste, mudanças de identidade esperada, falta de anotação, múltiplos rostos, baixa qualidade, erros de câmera/rede/servidor, cópia e exportação TXT/JSON. Também verifica a página com relatório e histórico preenchidos em quatro larguras:

```powershell
.runtime\python\python.exe tests\diagnostic_session.py
```

As nove regressões usam relógio controlado para exercitar prazos sem esperar cada sessão inteira. Nenhum cadastro é enviado à API real e a câmera física não é acionada. Os arquivos `diagnostic-summary-simulated.*` em `.runtime/validation/review/` são exemplos com decisões simuladas.

O cenário opcional `BrowserRegression.test_developer_real_models_camera_benchmark_and_cleanup`, com `--face` e `--other-face`, também executa uma sessão de 30 segundos reais usando YuNet/SFace, uma câmera de canvas com a foto conhecida e um perfil exclusivo do teste. Exporta `diagnostic-summary-real-models.json` e verifica a liberação da câmera e a ausência de nomes/IDs/token. Esse resultado mede consistência na imagem de teste; não mede precisão em pessoas ou condições novas.
