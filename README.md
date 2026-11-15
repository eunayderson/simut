# SIMUT

Plataforma de pesquisa para monitorar atividade e repouso de animais com um sensor Persono preso no peitoral. Começou com o Simut (Shih Tzu, 12 anos) e agora acompanha vários animais.

**Painel:** https://eunayderson.github.io/simut/

## Como usar

1. Abra o painel no **Chrome** (computador ou Android). No iPhone, use o app **Bluefy**, porque o Safari não tem Web Bluetooth.
2. Na primeira visita, o cadastro pergunta seu nome e os dados do animal (uma pergunta por tela, menos de 3 minutos). Quem já tinha dados do Simut só informa o nome: o Simut aparece pré-cadastrado com todos os downloads e marcações antigas.
3. Nas visitas seguintes o painel abre na grade **Seus animais**. Escolha um animal ou toque em **Adicionar animal** (o cadastro pula o seu nome).
4. Mexa no sensor para ele acordar e toque em **Sincronizar sensor**. Um toque só conecta, baixa, salva e desconecta (poupa bateria).

Os dados ficam no navegador (IndexedDB e localStorage) e, com a chave do Simut, na nuvem (Firebase Firestore). Também dá para baixar pelo Mac com `tools/baixar_sensor.py` e importar o `.bin` em **Dados**.

### Marcações de validação na nuvem

- `dogs/{chave}/meta/marks` guarda **só as marcações do Simut**, no formato antigo `{t, s}`. A versão 9 (publicada antes da plataforma) lê e regrava esse documento sem o campo de animal; se outros animais ficassem lá, viravam marcações do Simut.
- `dogs/{chave}/marks/{animalId}` guarda as marcações de cada outro animal (`{t, s, a}`). Marcações de outros animais que já estavam em `meta/marks` são copiadas para cá na primeira sincronização e só então saem de lá.
- `dogs/{chave}/meta/marksDeleted` guarda as marcações desfeitas ou limpas (`{k: "segundo:estado:animal", at}`). Elas são filtradas em toda junção, então não voltam por outro aparelho nem pela versão 9. Desfazer e limpar só afetam as marcações visadas (limpar, só as do animal atual).
- Cada documento é lido, juntado e gravado numa transação: nada de outro aparelho é apagado.

## Seções de cada animal

| Seção | O que tem |
|---|---|
| Visão Geral | Estado (sensor, último download, nuvem), resumo do dia, actograma interativo (7 ou 14 dias), tendência, perfil de 24 horas, noite, momentos ativos e explicações |
| Avançado | Parâmetros de análise (taxa e unidades do sensor, limiares do animal), sessão de validação, estado da validação (n de 2 sessões), modelos de ML (em desenvolvimento), tabela de 14 dias |
| Sensor | Sincronizar, ajuda de Bluetooth, informações do dispositivo, nível (suspeita de bateria), sensores do animal, sessões recentes |
| Dados | Histórico de coletas, actograma e tendência de 14 dias, exportar janelas e marcações (CSV), copiar marcações, importar `.bin`, informação temporal |
| Opções | Perfil, dados do animal (editar, arquivar), nuvem (chave, link para outro aparelho), métricas do onboarding, diagnóstico, apagar dados deste aparelho |

Navegação: sidebar no desktop (recolhível), sidebar compacta no tablet e barra inferior no celular. Rotas por hash: `#/animais`, `#/onboarding`, `#/a/{animal}/{seção}`. O link `#k=CHAVE` continua funcionando para conectar outro aparelho à nuvem.

Cada cartão com dados tem um selo de origem: observado, processado, estimado, sem dados, ML (em desenvolvimento) ou validado. Ausência de dados aparece hachurada, nunca como zero.

## Desenvolvimento

Sem build: HTML, CSS e ES modules (`js/`). Para rodar local:

```sh
python3 -m http.server 8765
# abra http://localhost:8765
```

Sem sensor por perto, abra `http://localhost:8765/?mock=1`: o painel usa um sensor simulado (`js/mock-sensor.js`) que gera pacotes válidos. Com `?mock=NOME` o sensor simulado usa esse nome (útil para testar o aviso de sensor de outro animal). No modo simulado a nuvem fica desligada, o sensor simulado não é associado ao animal e os downloads simulados (`source: "simulado"`) nunca sobem para a nuvem.

Testes (Node 20 ou mais novo, sem dependências):

```sh
node --test tests/
```

Estrutura: `js/app.js` (início, nuvem, sincronização), `js/router.js`, `js/state.js`, `js/pages/` (onboarding, grade e as cinco seções), `js/charts/` (actograma, tendência, perfil de 24 h), `js/ui/` (componentes), `css/` (tokens, base, componentes, layout, páginas). `tools/componentes.html` é o catálogo das peças visuais. `js/ble.js` e `js/crc32.js` implementam o protocolo do sensor e não devem mudar.

### Publicar uma versão nova

Todos os imports internos e os links do `index.html` levam `?v=N` para o celular não usar código antigo em cache. Para trocar de 10 para 11:

```sh
grep -rl 'v=10' index.html js tools | xargs sed -i '' 's/v=10/v=11/g'
```

e atualize `js/version.js`.

## Estado da decodificação

O protocolo do sensor foi descoberto por engenharia reversa (ver `docs/protocolo.md`).

| Item | Situação |
|---|---|
| Comandos, relógio, download e CRC32 dos pacotes | confirmado |
| Amostras como x, y, z em int8, cerca de 64 unidades por g | hipótese forte (sensor parado) |
| Marcadores entre amostras | hipótese, ainda sem significado |
| Taxa de amostragem (32 Hz) | **suposição**, ajustável em Avançado |
| Limiares de repouso, leve e intenso | **provisórios**, calibrados por animal com sessões de validação |

Os pacotes brutos ficam guardados, então a análise é refeita automaticamente quando a decodificação melhorar.

## Validação

O método segue estudos de acelerometria em cães (Hansen 2007, Yam 2011, Michel e Brown 2011): marcar os estados ao vivo (deitado, parado, andando, trotando, brincando) na sessão de validação, sincronizar o sensor e comparar. Os limiares só passam a "validados" com duas sessões concluídas e kappa a partir de 0,6 na mais recente. Protocolo em `docs/validacao.md`.
