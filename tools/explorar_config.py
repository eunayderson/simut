"""Exploração cuidadosa das configurações do sensor Persono (EM Microelectronic EMBP0x).

Uso (Terminal.app, com o Bluetooth do celular desligado):
    venv/bin/python explorar_config.py saida.txt              # fase A: só leitura e regravação do mesmo valor
    venv/bin/python explorar_config.py saida.txt --anuncio    # fase A + mede o intervalo de anúncio por 60 s
    venv/bin/python explorar_config.py saida.txt --teste 66 "00 02 00 04"
        # fase B: grava UM valor novo num comando de escrita, mede o efeito e volta ao original

Pares conhecidos (leitura -> escrita): 63->62, 65->64, 67->66, 69->68, 71->70.
Resposta: 80 <op> <status> [dados]; status 01 ok, 02 desconhecido, 03 falta parâmetro.
Nunca escreve no serviço de atualização de firmware (7001).
"""
import asyncio, sys, time, zlib
from bleak import BleakScanner, BleakClient

CMD = "81cf8376-454d-11e8-adc0-fa7ae01bd428"
DATA = "81cf8768-454d-11e8-adc0-fa7ae01bd428"
PARES = {0x63: 0x62, 0x65: 0x64, 0x67: 0x66, 0x69: 0x68, 0x71: 0x70}
LEITURAS = [0x03, 0x05, 0x43, 0x63, 0x65, 0x67, 0x69, 0x71]

out = open(sys.argv[1], "w", buffering=1)
def p(*a):
    s = " ".join(str(x) for x in a); print(s); out.write(s + "\n")
hexs = lambda b: b.hex(" ") if b is not None else "-"

resp = asyncio.Queue()
pacotes = []

async def enviar(c, dados, espera=2.0):
    while not resp.empty(): resp.get_nowait()
    await c.write_gatt_char(CMD, bytes(dados), response=True)
    try: r = await asyncio.wait_for(resp.get(), espera)
    except asyncio.TimeoutError: return None
    return r

async def ler(c, op):
    r = await enviar(c, [op])
    return r[3:] if r and len(r) >= 3 and r[2] == 1 else None

async def achar(timeout=120):
    p("procurando Persono (mexa no sensor)...")
    return await BleakScanner.find_device_by_filter(lambda d, a: (a.local_name or "").startswith("Persono"), timeout=timeout)

async def medir_anuncio(segundos=60):
    """Registra o horário de cada anúncio recebido. Parado e em movimento dão intervalos diferentes."""
    ts = []
    def cb(d, a):
        if (a.local_name or "").startswith("Persono"): ts.append(time.time())
    async with BleakScanner(cb): await asyncio.sleep(segundos)
    if len(ts) < 2: p(f"anúncios em {segundos}s: {len(ts)} (parado demais ou fora de alcance)"); return
    iv = sorted(b - a for a, b in zip(ts, ts[1:]))
    p(f"anúncios em {segundos}s: {len(ts)}; intervalo mediano {iv[len(iv)//2]*1000:.0f} ms; mínimo {iv[0]*1000:.0f} ms")

async def estado(c):
    v = {}
    for op in LEITURAS:
        v[op] = await ler(c, op)
        p(f"  ler {op:02x}: {hexs(v[op])}")
    return v

async def baixar(c):
    """Baixa a memória e devolve {offset: conteúdo} só dos pacotes com CRC válido."""
    pacotes.clear()
    r = await enviar(c, [0x40, 0x00])
    p("  download:", hexs(r))
    ultimo, n = time.time(), 0
    while time.time() - ultimo < 4:
        await asyncio.sleep(0.3)
        if len(pacotes) != n: n = len(pacotes); ultimo = time.time()
    mem = {int.from_bytes(b[1:4], "little"): b[4:-4] for b in pacotes if zlib.crc32(b[:-4]).to_bytes(4, "little") == b[-4:]}
    p(f"  pacotes válidos {len(mem)}")
    return mem

def taxa(pay):
    """Mediana de amostras entre marcadores 58 00 (hipótese: 1 marcador por segundo)."""
    i, run, gaps = 0, 0, []
    while i + 3 <= len(pay):
        b = pay[i]
        if 0x40 <= b <= 0x5f and pay[i + 1] == 0:
            if b == 0x58 and run: gaps.append(run)
            run = 0; i += 2; continue
        if b == 0x78: i += 3; continue
        if b == 0x38 and i + 4 < len(pay) and pay[i + 4] == 0x32: i += 5; continue
        run += 1; i += 3
    return (sorted(gaps)[len(gaps) // 2], len(gaps)) if gaps else (None, 0)

def comparar(antes, depois, rotulo):
    """Só os trechos da memória reescritos entre os dois downloads são dados novos."""
    novos = sorted(o for o in depois if antes.get(o) != depois[o])
    pay = b"".join(depois[o] for o in novos)
    t, n = taxa(pay)
    p(f"  {rotulo}: {len(novos)} pacotes novos; amostras por marcador (mediana) = {t} em {n} intervalos")

async def main():
    args = sys.argv[2:]
    if "--anuncio" in args:
        p("== intervalo de anúncio (mexa no sensor durante a medição) ==")
        await medir_anuncio()
    dev = await achar()
    if not dev: p("!! sensor não encontrado"); return
    async with BleakClient(dev, timeout=30) as c:
        await c.start_notify(CMD, lambda _, d: resp.put_nowait(bytes(d)))
        await c.start_notify(DATA, lambda _, d: pacotes.append(bytes(d)))
        await asyncio.sleep(1)
        p("== estado atual ==")
        orig = await estado(c)

        p("\n== fase A: regravar o MESMO valor (não muda nada, só confirma o formato) ==")
        for g, s in PARES.items():
            if orig[g] is None: p(f"  {s:02x}: sem valor lido em {g:02x}, pulei"); continue
            r = await enviar(c, [s, *orig[g]])
            depois = await ler(c, g)
            p(f"  escrever {s:02x} {hexs(orig[g])} -> {hexs(r)}; reler {g:02x}: {hexs(depois)}{'  (IGUAL)' if depois == orig[g] else '  !! MUDOU'}")

        if "--teste" in args:
            i = args.index("--teste")
            op_set = int(args[i + 1], 16); novo = bytes.fromhex(args[i + 2].replace(" ", ""))
            op_get = {v: k for k, v in PARES.items()}.get(op_set)
            if op_get is None or orig[op_get] is None or len(novo) != len(orig[op_get]):
                p("!! teste recusado: comando desconhecido ou tamanho diferente do original"); return
            p(f"\n== fase B: {op_set:02x} {hexs(orig[op_get])} -> {hexs(novo)} ==")
            p("  referência com o valor original: 90 s gravando...")
            ref0 = await baixar(c); await asyncio.sleep(90); ref1 = await baixar(c)
            comparar(ref0, ref1, "valor original")
            antes = ref1
            try:
                p("  resposta:", hexs(await enviar(c, [op_set, *novo])))
                p(f"  reler {op_get:02x}: {hexs(await ler(c, op_get))}")
                p("  aguardando 90 s de gravação com o valor novo (mexa no sensor)...")
                await asyncio.sleep(90)
                comparar(antes, await baixar(c), "valor novo")
            finally:
                r = await enviar(c, [op_set, *orig[op_get]])
                volta = await ler(c, op_get)
                p(f"  restaurado {op_set:02x} -> {hexs(r)}; reler {op_get:02x}: {hexs(volta)}{'  (OK, original)' if volta == orig[op_get] else '  !! NAO VOLTOU, anote estes valores'}")
        p("\n== estado final ==")
        await estado(c)
    if "--anuncio" in args:
        p("\n== intervalo de anúncio depois ==")
        await medir_anuncio()
    p("== FIM ==")

asyncio.run(main())
