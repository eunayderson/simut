---
tags: [hardware, ble, observado]
status: observado em 2026-11-14
---

# Persono-8154CC: GATT observado

Coleta feita do Mac (bleak sobre CoreBluetooth), somente leitura. Nada foi escrito no sensor.

## Anúncio (advertising)

- Nome: `Persono-8154CC` (sufixo provavelmente são os 3 últimos bytes do MAC; o macOS esconde o MAC real)
- Serviço anunciado: `81cf8254-454d-11e8-adc0-fa7ae01bd428` (serviço de aplicação)
- Sem manufacturer data, sem service data, sem TX power
- Só anuncia quando acordado por movimento: em repouso não apareceu em 15 s de scan
- RSSI a cerca de 30 cm: -53 dBm
- MTU negociado: 247

## Serviço 1: `00007001-0000-0041-4c50-574953450000` (base "ALPWISE")

| Char | Handle | Props | Valor lido |
|---|---|---|---|
| 7002 | 15 | write, write-without-response | (não legível) |
| 7005 | 17 | write, indicate | CCCD 00 00 |
| 7007 | 20 | read, write | vazio (0 bytes) |
| 7006 | 22 | read | `02` |
| 70f0 | 24 | read, write | `00 00 00 00` |
| 70f1 a 70f6 | 26 a 36 | read, write | 16 bytes zerados cada |
| 70f7 | 38 | read | `00 02` |
| 70f8 | 40 | read | `00` |
| 70f9 | 42 | read | `00 00 00 00` |

Leitura: 7002 parece canal de dados em bloco (write sem resposta, típico de envio de imagem), 7005 canal de controle com indicação, 70f1 a 70f6 blocos de 16 bytes graváveis (cara de chave/IV ou parâmetros de 128 bits), 70f7 `00 02` pode ser versão de protocolo.

## Serviço 2: `81cf8254-454d-11e8-adc0-fa7ae01bd428` (aplicação Persono)

| Char | Handle | Props | Papel provável |
|---|---|---|---|
| 81cf8376 | 45 | write, indicate | canal de comando/resposta |
| 81cf8768 | 48 | notify | fluxo de dados (sensor) |

Com as três notificações/indicações assinadas por 30 s, **nenhum dado chegou**. O sensor não transmite espontaneamente: precisa de um comando em 8376 para começar.

## Ausências notáveis

- Sem Device Information (0x180A): não há fabricante, modelo nem versão de firmware legíveis
- Sem Battery Service (0x180F)
- Sem serviço SUOTA padrão da Dialog (`0xFEF5`, chars `8082caa8-...`)

## Correção na hipótese do SoC

O serviço de OTA da Dialog/Renesas (SUOTA) usa o UUID 16 bits `0xFEF5`. A base `...4c50574953450000` é ASCII de "ALPWISE", nome da empresa francesa que vende uma pilha BLE licenciada para vários fabricantes de chip. Então o serviço 7001 indica **pilha/perfil de OTA da Alpwise**, não necessariamente chip Dialog. A família do SoC continua **não identificada**. (Confiança moderada: verificar se surgir firmware ou app.)

## Protocolo de comando (canal 81cf8376), varredura de 1 byte em 2026-11-14

Todos os 256 opcodes (`0x00` a `0xFF`) foram enviados sozinhos (1 byte). Toda escrita teve resposta por indicação em 8376. Nenhum dado chegou em 8768. Nenhuma desconexão.

Formato da resposta: `80 <opcode> <status> [payload]`

| Status | Significado inferido | Quantos |
|---|---|---|
| `01` | OK | 9 opcodes |
| `02` | opcode desconhecido | 230 |
| `03` | opcode existe, mas falta parâmetro (comando de escrita) | 17 |

Opcodes que existem (24 no total):

| Op | Resposta a 1 byte | Interpretação |
|---|---|---|
| 01, 02 | precisa de parâmetro | ? |
| 03 | `1c 34 8b 32` | **relógio**: uint32 LE, segundos desde 2000-01-01 (bateu com a hora atual) |
| 04 | precisa de parâmetro | provável "ajustar relógio" |
| 05 | `0f 62 02 00 01 1d 61 5f` | info do aparelho; último byte 0x5f = 95, talvez bateria % |
| 40 a 42, 44 a 47 | precisa de parâmetro | bloco 0x4x, provável coleta/memória |
| 43 | `06 00 00 02 00 5f` | status; também termina em 0x5f (95) |
| 60 | OK sem payload | **ação executada**, efeito desconhecido |
| 61 | precisa de parâmetro | set avulso |
| 62/63 | set / get `03` | par de configuração |
| 64/65 | set / get `01 07 10 0e` | par de configuração |
| 66/67 | set / get `00 02 00 08` | par de configuração |
| 68/69 | set / get `00 01 00 1f` | par de configuração |
| 6a | precisa de parâmetro | set |
| 70/71 | set / get `5e 00 00 5c 00 00` | par; parecem dois contadores (94 e 92) |

Padrão: no bloco 0x6x/0x7x, opcode ímpar lê e o par anterior grava a mesma configuração.
