"""Baixa a memória do sensor Persono pelo Mac e salva um .bin para importar no painel.

Uso:
    python3 -m venv venv && venv/bin/pip install bleak
    venv/bin/python baixar_sensor.py simut.bin

No macOS, rode pelo Terminal.app (ele pede a permissão de Bluetooth).
Mexa no sensor antes: ele só anuncia quando está acordado.
Formato do .bin: repetição de [tamanho u16 LE][pacote].
"""
import asyncio, sys, time, zlib
from bleak import BleakScanner, BleakClient

CMD = "81cf8376-454d-11e8-adc0-fa7ae01bd428"
DATA = "81cf8768-454d-11e8-adc0-fa7ae01bd428"


async def main(out):
    print("procurando Persono (mexa no sensor)...")
    dev = await BleakScanner.find_device_by_filter(
        lambda d, a: (a.local_name or "").startswith("Persono"), timeout=120)
    if not dev:
        sys.exit("sensor não encontrado")
    pk, last, resp = [], [time.time()], asyncio.Queue()
    async with BleakClient(dev, timeout=30) as c:
        await c.start_notify(CMD, lambda _, d: resp.put_nowait(bytes(d)))
        await c.start_notify(DATA, lambda _, d: (pk.append(bytes(d)), last.__setitem__(0, time.time())))
        await c.write_gatt_char(CMD, bytes([0x40, 0x00]), response=True)
        print("resposta:", (await asyncio.wait_for(resp.get(), 3)).hex(" "))
        last[0] = time.time()
        while time.time() - last[0] < 4 and c.is_connected:
            await asyncio.sleep(0.25)
            print(f"\r{len(pk)} pacotes", end="", flush=True)
    ok = [b for b in pk if zlib.crc32(b[:-4]).to_bytes(4, "little") == b[-4:]]
    with open(out, "wb") as f:
        for b in ok:
            f.write(len(b).to_bytes(2, "little") + b)
    print(f"\n{len(ok)} pacotes válidos de {len(pk)} salvos em {out}")


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "simut.bin"))
