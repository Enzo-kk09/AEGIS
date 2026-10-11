# AEGIS

Site demonstrativo de acompanhamento escolar, com um laboratório local de identificação facial por IA. As telas compartilham o console AEGIS, com navegação, tipografia, cores e estados consistentes. O Developer Test separa análise, perfis de referência e validação da sessão, com explicações técnicas acessíveis pelos botões `?`.

O resumo da revisão técnica, com as alterações de cada arquivo, está em [REVISAO.md](REVISAO.md).

## Organização do código

As páginas carregam `AegisShared.js` antes do script específico da tela. O módulo comum reúne imagens, ícones, datas, rotas, navegação do console, validação de dados, armazenamento e exportação CSV. Cada script de página mantém sua apresentação e seus eventos. `style.css` fornece as bases e `console.css` define o sistema visual e o laboratório. `Privacidade.html` preserva o conteúdo acessível também sem JavaScript.

Os dados da interface escolar permanecem no navegador. O login e o código PRB são demonstrativos. O Developer Test usa uma API Python separada, no mesmo servidor local, e seu banco de representações faciais não alimenta os registros escolares.

No backend, `app.py` gerencia o serviço e seu ciclo de vida, `uploads.py` limita os envios em memória, `engine.py` executa os modelos e `storage.py` mantém o banco e o cache da galeria. As respostas de API não são armazenadas em cache; JavaScript e CSS usam ETag para revalidação.

## Iniciar no Windows

No PowerShell, dentro desta pasta:

```powershell
.\Setup-DeveloperTest.cmd
.\Start-DeveloperTest.cmd
```

Abra **http://127.0.0.1:8765/DeveloperTest.html**. O menu das páginas do site também contém o link **Developer Test**.

O instalador prepara as dependências e baixa os modelos públicos do OpenCV. Depois da instalação, cadastro e identificação funcionam localmente, sem enviar imagens a serviços externos. O serviço atende somente neste computador.

Os arquivos `.cmd` também podem ser abertos com duplo clique. Se o computador não tiver Python instalado, o instalador prepara uma cópia portátil na pasta `.runtime/` deste projeto. Os scripts não alteram a política de execução do Windows permanentemente.

Com Python 3.12 ou superior, de 64 bits, também é possível executar manualmente:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r developer_test\requirements.txt
.\.venv\Scripts\python.exe -m developer_test.download_models
.\.venv\Scripts\python.exe -m developer_test.app
```

## Usar o laboratório

1. Na aba **Perfis de referência**, selecione fotos nítidas contendo somente seu rosto. Use **Avaliar fotos antes de cadastrar** para consultar tamanho, luz, nitidez, orientações, consistência e referências repetidas. A avaliação não salva perfis. Depois informe um nome e use **Cadastrar perfil**; o serviço repete todas as validações ao salvar.
2. Na aba **Análise**, escolha **Câmera** ou **Arquivo**. Autorize a câmera quando solicitado pelo navegador ou selecione uma imagem.
3. Comece com a escala **Automática**, que limita a entrada do detector e refina regiões pequenas na imagem original. Ajuste o limiar usando uma avaliação independente: similaridade não é uma probabilidade de identificação correta.
4. Informe a **Identidade esperada** antes de analisar. O resultado mostra motivo da decisão, tamanho do rosto, iluminação, nitidez, score do detector e margem entre perfis; a telemetria separa os tempos de cada etapa. A resposta completa pode ser inspecionada em JSON.
5. Em **Arquivo**, execute o benchmark na mesma imagem com três ou cinco medições por estratégia. Ele compara o modo automático e as quatro escalas fixas; somente o automático inclui tentativas e refinamento. Exibe mediana, média, faixa e P95, e destaca a menor mediana com o mesmo resultado observado em 100%, quando há uma referência comparável e as decisões se mantêm entre repetições. Estabilidade não comprova precisão.
6. Na aba **Validação da sessão**, escolha quem deve ser identificado, a duração (30 segundos, 1 minuto ou 3 minutos) e **Iniciar teste com câmera**. A contagem começa quando a câmera fornece uma imagem. Atualize a identidade esperada antes de trocar a pessoa em frente à câmera; para testar rejeição, escolha **Pessoa não cadastrada**. Escala, limiar e cadastros ficam bloqueados durante o teste. Você pode mudar para a aba Análise para acompanhar o vídeo.
7. Ao terminar o tempo, a câmera é desligada e o resumo aparece. **Encerrar e resumir** permite terminar antes; erros e interrupções preservam as capturas já concluídas. Use **Copiar resumo**, **Baixar resumo TXT** ou **Baixar detalhes JSON** e envie o texto ou arquivo nesta conversa. **Resumir capturas atuais** também funciona após análises individuais e exclui os registros de benchmark.
8. Consulte precisão, recall, acurácia, contagens de erro e as últimas observações, ou exporte o CSV. Sem identidade esperada anotada, o relatório descreve detecção, decisões, qualidade e desempenho, mas não calcula precisão de identificação.

O resumo separa identificação aceita de identificação correta. Inclui capturas com/sem rosto, estados das decisões, falsos positivos e negativos, qualidade (tamanho, iluminação e nitidez), similaridade, margem entre perfis, resolução, parâmetros, mediana/P95 dos tempos e até oito exemplos de falhas. Os perfis recebem rótulos como **Perfil 1**; fotos, nomes, IDs biométricos, vetores e token não são incluídos no TXT ou JSON. O relatório permanece no navegador até você copiá-lo ou baixá-lo; não é enviado automaticamente.

Na câmera, **A confirmar** indica uma correspondência ainda sem concordância temporal. A configuração padrão exige três capturas recentes por pelo menos 400 ms, com posição compatível. Ausência, múltiplos rostos, baixa qualidade, troca de identidade, intervalo longo, resposta antiga e mudanças de configuração limpam a confirmação. A indicação também expira quando uma solicitação trava. **Identificado por quadro** continua mostrando a decisão individual do modelo. O relatório distingue decisões por quadro de confirmações, incluindo aquecimento, descartes, latência e confirmações incorretas. Concordância repetida pode confirmar o perfil errado; não verifica vivacidade.

Análise de arquivo, benchmark, envio e avaliação de cadastro possuem botões de cancelamento. As fotos selecionadas são preservadas. Uma chamada nativa já iniciada termina antes de liberar a capacidade; as próximas etapas são interrompidas. Se o envio for cancelado durante uma transação que já começou, atualize a galeria para conferir o resultado.

Controles, ajuda e resumos recebem as mesmas regras versionadas do Python. Regras ausentes ou incompatíveis bloqueiam o processamento e orientam a reiniciar o serviço. O JSON registra essas regras, a versão do backend, hashes dos modelos e revisões anônimas da galeria. Se as referências mudarem durante uma inferência, a resposta fica incerta e não participa das métricas de identidade.

Para comparar dois JSONs exportados, execute:

```powershell
.runtime\python\python.exe -m developer_test.compare_reports resumo-anterior.json resumo-atual.json
```

A comparação aponta parâmetros alterados ou ausentes, misturas de versões/galerias, contagens e diferenças de mediana. Parâmetros iguais não comprovam que pessoas, luz, movimento e distância tenham sido iguais. As revisões da galeria são rótulos aleatórios válidos no serviço em execução; após reiniciar, confira as referências novamente.

Quadros consecutivos não são testes independentes. Uma sessão de vídeo com bons resultados não comprova precisão geral. Múltiplos rostos ficam sem pontuação de identidade; um quadro sem rosto de pessoa não cadastrada também não conta como rejeição correta.

Para avaliar identificação, use fotos diferentes das usadas no cadastro e inclua pessoas não cadastradas. Repetir a mesma foto do cadastro mede consistência, não demonstra precisão em condições reais.

## Redução de imagem

No modo automático, YuNet começa com no máximo 768 pixels no lado maior. Se não detectar rostos, tenta até 1920 pixels. Rostos com menos de 96 pixels na entrada reduzida são detectados novamente em uma região da imagem original; a substituição dos landmarks exige sobreposição de pelo menos 0,40 com a caixa anterior. O cadastro também usa essa estratégia. As tentativas, a escala efetiva e a quantidade de refinamentos aparecem na resposta.

No modo manual, YuNet detecta os rostos em 100%, 50%, 25% ou 10% da largura e da altura. O benchmark compara essas escalas fixas com o modo automático. As coordenadas e os pontos faciais voltam à imagem original, de onde SFace extrai a representação facial alinhada. Ampliar uma imagem reduzida não recupera detalhes; por isso o laboratório conserva a imagem de entrada durante a análise.

Usar 10% em cada dimensão resulta em aproximadamente 1% dos pixels. Essa opção pode perder rostos pequenos e prejudicar o alinhamento. As escalas fixas do comparativo não aumentam a resolução automaticamente; a linha Auto conserva sua estratégia adaptativa. Essa redução afeta o trabalho do detector; não representa uma redução equivalente no tamanho do arquivo transmitido ao serviço local.

O benchmark decodifica a imagem uma vez, aquece cada estratégia e repete somente a inferência. O custo de leitura medido é somado a cada tempo total; a espera pela exclusividade dos modelos fica em `queue_ms`. P95 com três ou cinco medições descreve essa pequena amostra. As linhas com decisões que variam entre repetições são sinalizadas e excluídas do destaque de velocidade.

O pipeline segue as APIs [FaceDetectorYN e FaceRecognizerSF do OpenCV](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html). Os modelos vêm do [OpenCV Zoo](https://github.com/opencv/opencv_zoo), com verificação SHA-256 no download e licenças na pasta dos modelos.

Correspondências na faixa de ±0,05 ao redor do limiar, ou com pouca diferença entre dois perfis, recebem o estado incerto. Fotos muito pequenas, cortadas, desfocadas ou mal iluminadas são rejeitadas no cadastro e sinalizadas durante a análise.

## Câmera e implementação

A câmera interfere no reconhecimento: resolução, foco, exposição, luz, movimento e distância alteram os detalhes disponíveis. O navegador solicita 1280 × 720, mas a resolução efetivamente negociada e a frequência do dispositivo aparecem junto aos controles. O diagnóstico de qualidade usa o rosto na imagem original, com no mínimo 100 pixels no cadastro e 64 na análise; iluminação e nitidez são filtros heurísticos.

O serviço continua em Python porque a detecção, o alinhamento, a inferência e a busca vetorizada já usam OpenCV e NumPy nativos. A revisão reduz o trabalho de detecção, evita executar SFace sem perfis cadastrados e decodifica JPEGs, PNGs e WebPs comuns diretamente em BGR pelo OpenCV. Pillow valida formato, dimensões e número de quadros antes da leitura nativa. PNGs comuns também passam por verificação de CRC e término IEND; PNGs com metadados, imagens com orientação EXIF diferente da original e cores especiais conservam a leitura com Pillow. Após a inicialização completa dos modelos, a consulta de saúde usa um resultado imutável e não espera pelo bloqueio da inferência. As dependências e os modelos existentes foram preservados.

OpenCV usa automaticamente até quatro threads, respeitando as CPUs disponíveis. `AEGIS_CPU_THREADS` permite ajustar esse valor antes de iniciar o serviço, dentro do mesmo limite. O estado de saúde informa o valor efetivo e o modo escolhido. O servidor admite até 64 conexões HTTP e limita separadamente a duas solicitações de processamento, mantendo consultas e recursos da interface disponíveis durante inferência.

## Dados e limites do teste

O banco em `developer_test/data/` mantém os nomes e as representações numéricas dos rostos cadastrados. As fotos e os quadros analisados não são persistidos pelo serviço. Excluir um perfil remove suas representações do banco; arquivos exportados pelo navegador continuam sob seu controle. O banco é aberto quando o servidor inicia e fechado quando ele encerra.

Esta área é um laboratório separado dos registros escolares demonstrativos do site. Não há detecção de vivacidade: uma fotografia apresentada à câmera pode produzir uma correspondência. Precisão em uso escolar exige um conjunto de avaliação representativo e revisão das regras do projeto antes de integrar resultados ao controle de acesso.

## Verificação

```powershell
.\.venv\Scripts\python.exe -m pip install -r developer_test\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest developer_test\tests -q
```

Para usar a cópia portátil preparada nesta máquina, substitua `.\.venv\Scripts\python.exe` por `.\.runtime\python\python.exe`. Também é possível instalar as dependências de teste com `.\Setup-DeveloperTest.cmd -WithTests`.

Os testes automatizados validam o pipeline e a API. O teste físico da sua câmera e a avaliação do seu rosto acontecem no navegador. Os tempos de processamento separam a espera na fila (`queue_ms`) do cálculo do reconhecimento.

Com Node instalado, `node --test aegis_shared.test.cjs developer_frontend.test.cjs developer_report.test.cjs developer_temporal.test.cjs` verifica armazenamento, concorrência entre abas, rotas, datas, métricas, exportação CSV, regras, confirmação temporal e resumos anônimos. Sem Node, use `.runtime\python\python.exe tests\js_utility_regressions.py`. Os testes de regressão da interface usam Playwright e um Chrome ou Edge instalado, com o servidor local em execução:

```powershell
.\.runtime\python\python.exe -m pip install -r tests\requirements.txt
.\.runtime\python\python.exe tests\browser_regression.py
.\.runtime\python\python.exe tests\developer_browser_regressions.py
.\.runtime\python\python.exe tests\laboratory_interface.py
.\.runtime\python\python.exe tests\diagnostic_session.py
.\.runtime\python\python.exe tests\rule_contract.py
.\.runtime\python\python.exe tests\enrollment_diagnostics.py
.\.runtime\python\python.exe tests\operation_cancellation.py
.\.runtime\python\python.exe tests\cancellation_integration.py
.\.runtime\python\python.exe tests\concurrent_pages.py
```

Os testes de navegador usam contextos isolados. Os cenários faciais opcionais usam fotos fornecidas por quem executa e excluem somente o perfil criado pelo teste. Consulte [tests/README.md](tests/README.md) para os cenários e parâmetros disponíveis.

Para verificar os scripts de inicialização:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\developer_tools.tests.ps1
```
