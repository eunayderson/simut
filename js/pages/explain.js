// Textos de explicação (popovers "?" e painéis). Curtos, sem inventar resultados.

// Detalhe do selo "Processado": cita os parâmetros em uso (todos provisórios).
export const processedDetail = (s) =>
  `Parâmetros em uso: ${s.hz} Hz (suposição), janelas de ${s.epoch} s, limiares de ${s.tLight} mg (leve) e ${s.tVig} mg (intenso), ainda provisórios.`;

export const EXPLAIN = {
  actogram: [
    "Um actograma mostra a atividade ao longo do dia: cada linha é um dia, da meia-noite (0h) à meia-noite seguinte, com hoje embaixo.",
    "As cores indicam a classe de cada janela de 60 s (repouso, leve, intenso), calculada pela intensidade média do movimento em mg. Trechos de repouso com 2 horas ou mais mostram \"zzz\".",
    "O sensor guarda só cerca de 20 a 25 minutos de movimento por download, então a maior parte do dia aparece hachurada: sem dados, não repouso.",
    "Passe o mouse para ver detalhes, clique numa linha para escolher o dia ou arraste para selecionar um período. No celular, toque num bloco.",
  ],
  trend: [
    "Cada ponto é o total de minutos em atividade leve ou intensa no dia, contado só nos trechos medidos.",
    "Dias sem dados não têm ponto e a linha é interrompida: ausência não é zero. A faixa cinza embaixo mostra quanto de cada dia foi medido; um ponto com pouca cobertura representa pouco do dia.",
  ],
  profile: [
    "A área mostra a intensidade média do movimento (mg) em cada faixa de 30 minutos, juntando os últimos 7 dias. A linha verde é o dia selecionado.",
    "Faixas sem nenhuma medição ficam vazias e hachuradas. Picos indicam horários em que o animal costuma se movimentar mais nos trechos medidos.",
  ],
  panels: [
    ["Como interpretar este padrão?", [
      "Procure regularidade: blocos de atividade em horários parecidos em vários dias sugerem uma rotina estável; mudanças grandes de um dia para outro merecem atenção.",
      "Compare só trechos medidos. Como cada download cobre poucos minutos, conclusões sobre o dia inteiro ainda não são possíveis. Estimativa, não diagnóstico.",
    ]],
    ["O que significa atividade elevada?", [
      "\"Intenso\" quer dizer que a intensidade média do movimento na janela passou do limiar intenso (hoje, um valor provisório). Trotar, brincar e correr costumam cair aqui.",
      "Atividade elevada não é boa nem ruim por si só. O que importa é a mudança em relação ao padrão do próprio animal. Estimativa, não diagnóstico.",
    ]],
    ["Como identificar fragmentação do repouso?", [
      "Repouso fragmentado aparece como blocos de repouso curtos, interrompidos por trechos leves ou intensos. No cartão Noite, \"Despertares\" conta essas interrupções entre 22h e 6h.",
      "Só dá para avaliar onde houve medição. Uma noite sem dados não indica sono ruim nem bom. Estimativa, não diagnóstico.",
    ]],
    ["O que ainda é provisório?", [
      "A decodificação dos pacotes do sensor (feita por engenharia reversa), a taxa de amostragem (suposta em 32 Hz) e os limiares de repouso, leve e intenso.",
      "Os números só passam a \"validados\" depois de duas sessões de validação com vídeo e concordância substancial (kappa a partir de 0,6). Modelos de machine learning ainda não existem.",
    ]],
  ],
};
