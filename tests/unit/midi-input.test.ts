import { describe, expect, it } from 'vitest';
import { MidiInputAdapter, type MidiAccessLike, type MidiInputLike } from '../../src/input/MidiInputAdapter';

function fakeAccess() {
  const inputs = new Map<string, MidiInputLike>();
  const access: MidiAccessLike = { inputs: { forEach: (cb) => inputs.forEach((i) => cb(i)) }, onstatechange: null };
  const plug = (id: string, name: string) => {
    inputs.set(id, { id, name, manufacturer: 'Test', state: 'connected', onmidimessage: null });
    access.onstatechange?.({ port: { id, type: 'input', state: 'connected' } });
  };
  const unplug = (id: string) => {
    inputs.get(id)!.state = 'disconnected';
    access.onstatechange?.({ port: { id, type: 'input', state: 'disconnected' } });
  };
  const send = (id: string, data: number[], t = 0) => inputs.get(id)!.onmidimessage?.({ data: new Uint8Array(data), timeStamp: t });
  return { access, plug, unplug, send, inputs };
}

describe('MidiInputAdapter (pseudo device; real hardware is verified manually)', () => {
  it('I13: unsupported browsers report "unsupported" and nothing else breaks', () => {
    const a = new MidiInputAdapter({ onMessage: () => {}, onDeviceLost: () => {}, onChange: () => {} }, null);
    expect(a.state).toBe('unsupported');
    expect(a.deviceList).toEqual([]);
  });

  it('I13: permission denied is reported with a fallback message', async () => {
    const a = new MidiInputAdapter({ onMessage: () => {}, onDeviceLost: () => {}, onChange: () => {} }, () => Promise.reject(new Error('SecurityError')));
    await a.enable();
    expect(a.state).toBe('denied');
    expect(a.error).toMatch(/PC キーボード/);
  });

  it('enable() called twice (StrictMode / several startup paths) delivers each message once', async () => {
    // Chrome returns a NEW MIDIAccess with NEW MIDIInput objects for the same device on every
    // request, so a handler left on the first one would fire alongside the second (doubled notes).
    const made: ReturnType<typeof fakeAccess>[] = [];
    let requests = 0;
    const got: string[] = [];
    const a = new MidiInputAdapter({ onMessage: (m) => got.push(m.type), onDeviceLost: () => {}, onChange: () => {} }, () => {
      requests++;
      const f = fakeAccess();
      f.plug('in1', 'Keys');
      made.push(f);
      return Promise.resolve(f.access);
    });
    await Promise.all([a.enable(), a.enable()]); // concurrent
    await a.enable(); // after granted
    expect(requests).toBe(1);
    for (const f of made) f.send('in1', [0x90, 60, 100]);
    expect(got).toEqual(['note-on']);
    expect(a.deviceList).toHaveLength(1);
  });

  it('asks without SysEx permission, receives notes (velocity 0 = off), filters channels', async () => {
    const f = fakeAccess();
    f.plug('in1', 'Keys');
    const got: string[] = [];
    let asked: { sysex: boolean } | null = null;
    const a = new MidiInputAdapter(
      { onMessage: (m, dev) => got.push(`${dev}:${m.type}:${'pitch' in m ? m.pitch : ''}`), onDeviceLost: () => {}, onChange: () => {} },
      (opts) => ((asked = opts), Promise.resolve(f.access)),
    );
    await a.enable();
    expect(asked).toEqual({ sysex: false });
    expect(a.deviceList.map((d) => [d.name, d.state])).toEqual([['Keys', 'connected']]);
    f.send('in1', [0x90, 60, 100]);
    f.send('in1', [0x90, 60, 0]);
    a.setChannelFilter(1);
    f.send('in1', [0x90, 61, 100]); // channel 0: filtered out
    expect(got).toEqual(['in1:note-on:60', 'in1:note-off:60']);
  });

  it('I14: unplugging a device reports it so held notes can be released; replugging works', async () => {
    const f = fakeAccess();
    f.plug('in1', 'Keys');
    const lost: string[] = [];
    const a = new MidiInputAdapter({ onMessage: () => {}, onDeviceLost: (id) => lost.push(id), onChange: () => {} }, () => Promise.resolve(f.access));
    await a.enable();
    f.unplug('in1');
    expect(lost).toEqual(['in1']);
    expect(a.deviceList[0].state).toBe('disconnected');
    f.inputs.get('in1')!.state = 'connected';
    f.access.onstatechange?.({ port: { id: 'in1', type: 'input', state: 'connected' } });
    expect(a.deviceList[0].state).toBe('connected');
    a.setDeviceEnabled('in1', false);
    expect(lost).toEqual(['in1', 'in1']);
  });
});
