# Simut

Painel de atividade e repouso do Simut (Shih Tzu, 12 anos), usando um sensor Persono preso no peitoral.

**Painel:** https://eunayderson.github.io/simut/

## Como usar

1. Abra o painel no **Chrome** (computador ou Android). No iPhone, use o app **Bluefy**, porque o Safari não tem Web Bluetooth.
2. Mexa no sensor para ele acordar.
3. Toque em **Conectar sensor** e escolha `Persono-...`.
4. Toque em **Baixar dados**.

Os dados ficam guardados só no navegador (IndexedDB). Nada vai para servidor.

Também dá para baixar pelo Mac com `tools/baixar_sensor.py` e importar o `.bin` no painel.

## Estado da decodificação

O protocolo do sensor foi descoberto por engenharia reversa (ver `docs/protocolo.md`).

| Item | Situação |
|---|---|
| Comandos, relógio, download e CRC32 dos pacotes | confirmado |
| Amostras como x, y, z em int8, cerca de 64 unidades por g | hipótese forte (sensor parado) |
| Marcadores entre amostras | hipótese, ainda sem significado |
| Taxa de amostragem (32 Hz) | **suposição**, ajustável no painel |
| Limiares de repouso, leve e intenso | **provisórios**, precisam de calibração com vídeo |

Os pacotes brutos ficam guardados, então a análise é refeita automaticamente quando a decodificação melhorar.

## Validação

O método previsto segue estudos de acelerometria em cães (Hansen 2007, Yam 2011, Michel e Brown 2011): gravar vídeo e sensor juntos em estados conhecidos (deitado, parado, andando, trotando, correndo), anotar o vídeo, comparar com as janelas exportadas em CSV e definir os limiares do Simut.
