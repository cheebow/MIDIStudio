// English help contents (ADR-061): the same sections and ids as content.tsx, written for an
// English-speaking MIDI-sequencer user rather than translated sentence by sentence. Keys are shown
// for the current platform, as in the Japanese version.
import type { ReactNode } from 'react';
import { GS_PARAMS } from '../../core/gs/gsSysex';
import { ALT_LABEL as ALT, IS_MAC, MOD_LABEL as MOD } from '../../ui/platform';
import type { HelpSection } from './content';

const K = ({ children }: { children: ReactNode }) => <kbd className="help-key">{children}</kbd>;

export const SHORTCUTS_EN: [string, string][] = [
  ['Space / Shift+Space', 'Play / pause / play from the first selected note'],
  ['Enter / Home', 'Go to the start'],
  [', / .', 'One bar back / forward'],
  ['L / Shift+L', 'Loop on / off / loop the selection'],
  ['I / O', 'Set the loop start / end to the bar at the playhead'],
  ['M / S', 'Mute / solo the selected track'],
  ['K / J / F', 'Metronome / snap / follow playback'],
  ['1 – 5', 'Piano roll / Drums / List / Mixer / Conductor'],
  [`${MOD}Z / ${IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'}`, 'Undo / redo'],
  [`${MOD}C / X / V / D`, 'Copy / cut / paste (at the playhead) / duplicate'],
  [`${MOD}A`, 'Select all notes of the selected track'],
  ['Delete / Backspace', 'Delete the selection'],
  ['V / P', 'Select tool / draw tool'],
  ['Q / Shift+Q', 'Quantize (to the edit grid) / quantize dialog'],
  ['T', 'Visual mode (Esc closes it)'],
  ['R', 'Start / stop real-time recording'],
  [`${ALT}K / ${ALT}P`, 'PC keyboard / drum pad input mode (again to go back to editing)'],
  ['Keyboard mode: ↑ ↓ / Tab', 'Octave / sustain while held'],
  ['Step input: → ← - Backspace', 'Rest / back / tie / undo the last step'],
  ['Esc', 'Back to edit mode, clear the selection'],
  ['F1', 'This help'],
  ['↑ ↓ / ← → (piano roll)', 'Move a semitone (Shift: an octave) / move by one grid step'],
  [`${ALT}↑ ↓`, 'Move the selected track up / down'],
  [`${MOD}+drag / ${MOD}+wheel`, 'Drag without snap / zoom the piano roll'],
  [`${MOD}S / ${MOD}O`, 'Save to browser / open a project'],
];

export const HELP_SECTIONS_EN: HelpSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <>
        <p>At launch, the “Start MIDI Studio” dialog lets you choose the song (a new song or the last autosave) and whether to use a MIDI keyboard. “Start” turns the sound engine on.</p>
        <p>A new song starts with four tracks: piano, bass, guitar and drums. Add or remove tracks from the Track menu.</p>
        <h4>The screen</h4>
        <ul>
          <li>From the top: the menu bar, the transport (play, loop, position, tempo, metronome, seek bar), the input-mode row, the track view, the editor at the bottom (switched with tabs) and the status bar.</li>
          <li>The inspector on the right holds the selected track’s settings (name, color, port, channel, display, patch). The View menu can hide it.</li>
          <li>Drag the border above the editor to change its height; ▾ collapses it.</li>
        </ul>
        <p>Your songs and the sound bank stay inside the browser. Nothing is sent anywhere.</p>
      </>
    ),
  },
  {
    id: 'arrangement',
    title: 'Track view',
    body: (
      <>
        <ul>
          <li>With the draw tool (<K>P</K>), drag on empty space to create a clip (region); the right-click “Create a one-bar clip here” does the same. Notes recorded or entered inside a clip’s range join that clip, and notes put where there is no clip get a bar-aligned clip of their own. Notes that belong to no clip are drawn as outlines. Drag a clip’s middle to move it, <K>{ALT}</K>+drag to duplicate it, drag an edge to change its length (the notes inside stay put; notes that fall outside the range leave the clip).</li>
          <li>With the select tool (<K>V</K>), drag on empty space for a rubber-band selection (it can span several tracks). Shift+click / Shift+drag adds to the selection. Selected clips move and duplicate together and respond to <K>{MOD}C</K> / <K>{MOD}X</K> / <K>{MOD}V</K> / <K>{MOD}D</K> / <K>Delete</K>; pasting puts each clip back on its own track. Right-click on empty space › “Select the clips at this position on all tracks” picks that bar on every track at once.</li>
          <li>Right-click a clip for: open in the piano roll, name and color, take in the loose notes inside, split, duplicate, quantize, humanize, velocity, delete, release the clip only. Double-click opens the editor.</li>
          <li>Drag the ⋮⋮ handle of a track header to reorder tracks (<K>{ALT}↑↓</K> also works). Double-click the name to rename. M / S / R are mute, solo and record-arm.</li>
          <li>Click the ruler to seek. Drag the ends of the loop range to resize it, or its band at the bottom to move it (snaps to bars; Shift for beats).</li>
          <li>Right-click or double-click the tempo lane to add or change a tempo. Time signatures, key signatures and markers appear next to the bar numbers.</li>
          <li>− / + at the top left zoom in and out. The faint area before bar 1 is a margin.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'piano-roll',
    title: 'Piano roll',
    body: (
      <>
        <ul>
          <li>Tools: select (<K>V</K>) and draw (<K>P</K>). With the draw tool, a click places a note of the grid length; keep dragging to set its length.</li>
          <li>Drag a note’s middle to move it, its right edge to change its length, <K>{ALT}</K>+drag to duplicate, Shift+click to add to the selection. Drag on empty space for a rubber-band selection.</li>
          <li>Snap and the edit grid (1/1 to 1/64, triplets, dotted) are in the tool row. Hold <K>{MOD}</K> while dragging to ignore snap for that drag.</li>
          <li>The lane below switches between Velocity, CC and Pitch Bend. Paint velocities by dragging; click to add CC / Pitch Bend points, then select, drag or Delete them.</li>
          <li>Edit › Notes: quantize (<K>Q</K> applies the edit grid at once, <K>Shift+Q</K> opens the dialog), humanize, velocity, align note lengths to the grid. The same commands are in a note’s right-click menu.</li>
          <li>Click the keyboard on the left to audition. Keys you play light up red; keys sounding during playback light up blue.</li>
          <li>Notes of the other tracks are shown faintly (ghost notes; toggle in the View menu).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'drum',
    title: 'Drum editor',
    body: (
      <>
        <ul>
          <li>Notes are placed in one lane per instrument. With the draw tool, a click enters a hit and another click removes it.</li>
          <li>The drum map (GM / GS / user) changes only the lane names and order, never the note numbers. Double-click a lane name to rename it; right-click to hide or reorder lanes.</li>
          <li>Click the pads on the right to audition. In the “Pads” input mode the letter keys and the numeric keypad play them.</li>
          <li>Switch between the drum and melody displays with “Display” in the inspector or Track › “Make this a drum track”.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'list',
    title: 'List editor',
    body: (
      <>
        <table className="summary">
          <tbody>
            <tr>
              <td>MEAS / STEP</td>
              <td>Bar number and the event’s order within the bar</td>
            </tr>
            <tr>
              <td>NOTE / K#</td>
              <td>Note name (C4 = 60) / note number; for CC and others, the kind and number</td>
            </tr>
            <tr>
              <td>ST</td>
              <td>Time until the next event (step time)</td>
            </tr>
            <tr>
              <td>GT</td>
              <td>Length of the note (gate time)</td>
            </tr>
            <tr>
              <td>VEL</td>
              <td>Velocity, or the CC value</td>
            </tr>
          </tbody>
        </table>
        <ul>
          <li>Move with ↑↓←→ / Tab, start editing with Enter or a digit, confirm with Enter, cancel with Esc. Shift+↑↓ selects several rows.</li>
          <li>Changing ST moves the events after it (ripple). GT changes only that note.</li>
          <li>Units can be ticks or ♩=48 (Recomposer style). Values that do not divide evenly are shown as fractions.</li>
          <li>The filter narrows the list to notes only, CC only and so on.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'mixer',
    title: 'Mixer',
    body: (
      <>
        <ul>
          <li>Volume (fader), Pan, Reverb, Chorus and Expression per track. Drag, scroll or use the arrow keys; double-click restores the default.</li>
          <li>The values are stored as CCs at the start of the song and exported to the MIDI file. If the same CC also appears later in the song, an “automated” mark is shown.</li>
          <li>Changes during playback take effect immediately, without a dropout.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'conductor',
    title: 'Conductor',
    body: (
      <>
        <ul>
          <li>Add, change and delete tempos, time signatures, key signatures and markers in one list. Filter by kind.</li>
          <li>“Go to this position” moves the playhead there. Clicking the BPM or the time signature in the transport also adds or changes them.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'visual',
    title: 'Visual mode',
    body: (
      <>
        <ul>
          <li>Open it with <K>T</K> or the “Visual” button in the toolbar; <K>Esc</K> goes back.</li>
          <li>Three views: the event list (Recomposer style; split panes, follow mode, units, staff), the piano roll (all tracks) and keyboards (one per track).</li>
          <li>Color scheme, text size and full screen are on the right of the toolbar.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'play',
    title: 'Playback',
    body: (
      <>
        <ul>
          <li><K>Space</K> plays / pauses, ■ stops (back to the start, or to the loop start). Click or drag the seek bar, or click the ruler, to move.</li>
          <li>Loop with <K>L</K>; set the range with the bar numbers, by dragging in the ruler or seek bar, or with <K>Shift+L</K> (the selection).</li>
          <li>Metronome: <K>K</K>. Follow playback: <K>F</K>.</li>
          <li>Notes, patches and tempos changed during playback take effect at the next stop, seek or loop wrap, so the sound never breaks up (the transport shows “changes apply after stop”). Mute / solo, the loop range and the mixer are immediate.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'input',
    title: 'Playing and recording',
    body: (
      <>
        <h4>Input modes</h4>
        <ul>
          <li>“Edit / Keys / Pads / Step” in the toolbar. In Edit the letter keys are shortcuts; in Keys and Pads they are instruments. Switch with <K>{ALT}K</K> / <K>{ALT}P</K>, back to Edit with <K>Esc</K>.</li>
          <li>Keys: the bottom row Z–M is C4–B4, the top row Q–I is C5–C6 (the same physical keys on JIS and US layouts). <K>↑↓</K> changes the octave, <K>Tab</K> held is sustain, Shift held is an accent.</li>
          <li>Pads: drums on the letter keys and the numeric keypad. Change the assignment in Tools › Key bindings.</li>
          <li>MIDI keyboard: choose “Use” at startup, or connect it in MIDI › MIDI input settings.</li>
        </ul>
        <h4>Real-time recording</h4>
        <ul>
          <li>Press R (record-arm) on the track you want to record, then ● or <K>R</K> to start. Playback begins after the count-in; ■ or <K>R</K> stops. The take is one undoable step.</li>
          <li>Notes played during the last beat of the count-in are moved to the start position.</li>
          <li>Recording settings (⚙): overdub / replace, count-in, punch in / out, loop-recording takes, record quantize, latency compensation.</li>
        </ul>
        <h4>Step input</h4>
        <ul>
          <li>In the “Step (keys / drums)” input mode, the notes you press on the keys or pads are entered at the cursor, which then advances by the step length. Press keys together for a chord.</li>
          <li><K>→</K> rest, <K>←</K> back, <K>-</K> tie, <K>Backspace</K> undo the last step. Step length and gate are in the step panel.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'file',
    title: 'Files',
    body: (
      <>
        <ul>
          <li>Save to browser (<K>{MOD}S</K>) keeps the song inside this browser; open it again from File › Recent projects. The song you are editing is autosaved, and the next start offers to restore it.</li>
          <li>Save as .midstudio / Open project (<K>{MOD}O</K>) save and load the song as a file.</li>
          <li>Sample songs: File › Sample songs (also in the startup dialog). VISION (GS Version) and Merry X'mas For You! (composed and produced by cheebow; for listening and editing).</li>
          <li>Import MIDI: SMF format 0 / 1. Notes, CCs, SysEx and unknown events are kept, never dropped. Export MIDI: format 1.</li>
          <li>Export WAV renders with the built-in sound engine (mute / solo apply, the loop is ignored).</li>
          <li>Choose SoundFont uses your own .sf2 / .sf3 / .dls as the sound bank.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    body: (
      <>
        <table className="summary">
          <tbody>
            {SHORTCUTS_EN.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">Single-letter shortcuts work only while the input mode is “Edit”. Shortcuts with a modifier key, and Esc, work in every mode.</p>
      </>
    ),
  },
  {
    id: 'gm-gs',
    title: 'GM / GS',
    body: (
      <>
        <ul>
          <li>Sound comes from the loaded SoundFont (GeneralUser GS by default). This is not a reproduction of the patches or effects of a real Roland SC-55 / SC-88Pro.</li>
          <li>GS SysEx is kept and exported. The parameters in the table below are shown and edited with their meaning; everything else stays as hex (MIDI › GS / SysEx › SysEx / event inspector).</li>
          <li>Multiple ports (FF 21) are saved and exported, and playback uses 16 channels per port. A port change in the middle of a song is not reflected in playback.</li>
        </ul>
        <table className="summary">
          <thead>
            <tr>
              <th>GS parameter</th>
              <th>Shown / edited</th>
              <th>Built-in engine</th>
            </tr>
          </thead>
          <tbody>
            {GS_PARAMS.map((p) => (
              <tr key={p.name}>
                <td>
                  {p.name} <span className="note">{p.address.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ').replace(/^40 10/, '40 1x')}</span>
                </td>
                <td>Yes</td>
                <td>{p.engine ? 'Applied' : 'Ignored'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    body: (
      <>
        <ul>
          <li><strong>No sound</strong>: “Start” in the startup dialog has not been pressed, or the sound bank is still loading. Check the “Sound” indicator in the toolbar. If loading failed, reload from the startup dialog or use your own .sf2 via File › Choose SoundFont.</li>
          <li><strong>The MIDI keyboard does not respond</strong>: check that the browser supports Web MIDI (Chrome / Edge and others), that you allowed it, and that the device is enabled in MIDI › MIDI input settings. Recording also needs R on the target track.</li>
          <li><strong>Keys make no sound / shortcuts do nothing</strong>: check the input mode. In Keys and Pads the letter keys are instruments; in Edit they are shortcuts.</li>
          <li><strong>Edits during playback make no difference</strong>: they take effect at the next stop, seek or loop wrap.</li>
          <li><strong>Where is my song saved?</strong>: Save to browser and the autosave live inside this browser (IndexedDB). To move a song to another device or share it, export a .midstudio or a MIDI file.</li>
        </ul>
      </>
    ),
  },
];
