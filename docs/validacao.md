# Protocolo de validação: sensor Persono no Simut

Objetivo: mostrar, com dados, que o sensor separa **repouso**, **atividade leve** e **atividade intensa** do Simut, e definir os limiares (em mg) específicos para ele.

Método inspirado nos estudos de acelerometria em cães: observação direta como referência, estados de intensidade conhecida, comparação janela a janela e definição de limiares (cut points). Referências para conferir antes de citar: Hansen et al. 2007 (Am J Vet Res), Yam et al. 2011 (J Small Anim Pract), Michel e Brown 2011 (Am J Vet Res).

## 1. Material

- Sensor no peitoral, **no dorso entre as escápulas**, seta apontando para a cabeça, sem folga.
- Celular com o painel aberto (a marcação ao vivo funciona em qualquer navegador, inclusive Safari).
- Opcional, mas recomendado: um segundo celular filmando, para conferir as marcações depois.
- Um ajudante ajuda muito: um conduz o Simut, o outro marca.

## 2. Preparação

1. Sincronize o sensor antes de começar (limpa o caminho e confirma que está gravando).
2. Desligue o Bluetooth do celular que vai marcar, se ele não for o que sincroniza (o sensor aceita uma conexão por vez).
3. Confira se o relógio do celular está no automático.

## 3. Sequência (sessão de cerca de 40 minutos)

Cada estado dura **pelo menos 7 minutos** (as bordas são descartadas e cada janela tem 60 s, então 7 minutos rendem cerca de 5 janelas, o mínimo para a análise). Toque no botão do estado **no momento em que ele começa**. Se o Simut sair do estado (levantou, parou para cheirar), toque no estado real ou em **Pausa**.

| Ordem | Estado | Classe esperada | Como conduzir |
|---|---|---|---|
| 1 | Deitado | repouso | na caminha, sem estímulo |
| 2 | Parado em pé | repouso | em pé, guia curta, sem andar |
| 3 | Andando | leve | passeio no ritmo dele, terreno plano |
| 4 | Trotando | intenso | passo rápido do condutor, se ele aguentar |
| 5 | Brincando | intenso | brinquedo ou bolinha, opcional |
| 6 | Deitado | repouso | descanso no fim |

Ele tem 12 anos: **respeite o cansaço**. Se ele não quiser trotar, pule. Menos dados é melhor que um cão exausto.

No fim, toque em **Encerrar** e sincronize o sensor.

## 4. Repetição

Repita a sessão em **pelo menos 2 dias diferentes**. A primeira sessão define os limiares, a segunda testa se eles funcionam em dados novos. É isso que torna o resultado defensável.

## 5. Análise (o painel faz)

1. As marcações viram trechos com horário de início e fim.
2. Descartam-se 30 s no começo e no fim de cada trecho (transições).
3. Cada janela de 60 s dentro de um trecho recebe a classe esperada.
4. O painel calcula:
   - **intensidade média (mg)** por estado, com mediana e faixa;
   - **limiares sugeridos**: o corte que melhor separa repouso de leve e leve de intenso (maior acurácia balanceada);
   - **concordância** entre o sensor e a observação: acurácia, **kappa de Cohen** e matriz de confusão.

Interpretação do kappa (Landis e Koch): acima de 0,6 é concordância substancial; acima de 0,8, quase perfeita.

## 6. O que registrar

Para cada sessão: data, duração de cada estado, limiares usados, acurácia, kappa e observações (chuva, piso, se ele estava cansado). O painel exporta as janelas em CSV.

## Limitações a declarar

- Um único cão: os limiares valem para o Simut, não para cães em geral.
- O formato interno do sensor foi obtido por engenharia reversa; a taxa de amostragem ainda é uma suposição até ser confirmada.
- A marcação ao vivo tem atraso humano de alguns segundos, compensado pelo descarte de 30 s nas bordas.
