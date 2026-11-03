// English beginner's guide (ADR-061): the same chapters and ids as tutorial.tsx, written for someone
// who has never used a MIDI sequencer. Each chapter ends with something that can be heard.
import type { HelpSection } from './content';
import { ALT_LABEL as ALT, MOD_LABEL as MOD } from '../../ui/platform';
import type { ReactNode } from 'react';

const K = ({ children }: { children: ReactNode }) => <kbd className="help-key">{children}</kbd>;

export const TUTORIAL_CHAPTERS_EN: HelpSection[] = [
  {
    id: 'what-is-midi',
    title: 'What MIDI is',
    body: (
      <>
        <p>MIDI is not sound. It is a set of performance instructions: which note to play, when, how hard and on which instrument. A sequencer records those instructions in order, and a sound engine reads them and makes the sound.</p>
        <ul>
          <li>A sound instruction is a <strong>note</strong>. It has a pitch (C4 and so on), a position, a length and a strength (<strong>velocity</strong>, 1–127).</li>
          <li>The instrument is chosen with a <strong>patch</strong> (Program Change): piano, bass, strings… the GM standard defines 128 of them.</li>
          <li>A track is one “row” per instrument. Each track talks to the sound engine on a <strong>channel</strong> (1–16); channel 10 is reserved for drums.</li>
          <li>The speed of the song is the <strong>tempo</strong> (BPM); beats are grouped by the <strong>time signature</strong>. Positions are written “bar . beat . tick”.</li>
        </ul>
        <p>Because only the instructions are stored, you can change the patch or the tempo later and the performance stays intact. Files are small (tens of KB) and travel to other software as .mid.</p>
      </>
    ),
  },
  {
    id: 'screen',
    title: 'Reading the screen',
    body: (
      <>
        <ul>
          <li><strong>Transport</strong> (top): play, stop, record, loop, current position, tempo, metronome, seek bar.</li>
          <li><strong>Track view</strong> (middle): the whole song. Tracks are listed on the left, time runs to the right, and the ranges that hold notes appear as <strong>clips</strong>.</li>
          <li><strong>Editor</strong> (bottom): the contents of the selected track. Tabs switch between piano roll, drums, list, mixer and conductor.</li>
          <li><strong>Inspector</strong> (right): the selected track’s name, color, channel and patch.</li>
        </ul>
        <p>If you get lost, <K>Esc</K> returns to edit mode and <K>{MOD}Z</K> undoes.</p>
      </>
    ),
  },
  {
    id: 'first-notes',
    title: '1. Place the first notes',
    body: (
      <>
        <ol>
          <li>In the startup dialog choose “New song”, then “Start”. Four tracks appear: piano, bass, guitar and drums. (If you would rather hear a finished song first, pick “Sample songs”.)</li>
          <li>Click “Piano” in the track view to select it. Make sure the editor below shows the “Piano roll” tab.</li>
          <li>Press <K>P</K> for the draw tool, then click at the start of bar 1 at the height of C4 on the keyboard to the left. One note is placed (its length is the edit grid, 1/16 at first).</li>
          <li>Place three more to the right at the same pitch. Keep the mouse button down and drag to make a note longer.</li>
          <li>Press <K>Space</K> to play. <K>Space</K> again pauses, <K>Enter</K> goes back to the start.</li>
        </ol>
        <p>To move a note, press <K>V</K> for the select tool and drag its middle; to delete it, select it and press <K>Delete</K>. Notes snap to the grid as you place them.</p>
      </>
    ),
  },
  {
    id: 'rhythm',
    title: '2. Add a beat',
    body: (
      <>
        <ol>
          <li>Select “Drums” in the track view. The editor switches to “Drums”, with one lane per instrument.</li>
          <li>In the Bass Drum 1 lane click beats 1 and 3; in the Acoustic Snare lane click beats 2 and 4.</li>
          <li>In the Closed Hi-Hat lane click every eighth note (eight per bar).</li>
          <li>Press <K>L</K> to turn the loop on, then <K>Space</K>. Bar 1 repeats. Change the loop range with the “Bars” numbers in the transport or by dragging the ends of the range in the ruler.</li>
        </ol>
        <p>On drums, pitch selects the instrument (C1 = bass drum, D1 = snare…). That is the rule of channel 10. Click the pads on the right to hear each one.</p>
      </>
    ),
  },
  {
    id: 'bass-chords',
    title: '3. Bass and chords',
    body: (
      <>
        <ol>
          <li>Select “Bass” and, in the piano roll, place quarter notes at C2 for one bar (set the edit grid to 1/4 and click).</li>
          <li>Back on “Piano”, stack E4 and G4 on top of the first note you placed. C, E and G together make a C chord.</li>
          <li>Make the loop two bars long and, in bar 2, move the bass to F2 and the piano to F4, A4 and C5. Just going C → F already sounds like a song.</li>
        </ol>
        <p>Select notes and <K>{MOD}C</K>, move the playhead and <K>{MOD}V</K> to paste; <K>{MOD}D</K> duplicates. <K>↑↓</K> moves by a semitone, Shift+<K>↑↓</K> by an octave.</p>
      </>
    ),
  },
  {
    id: 'sound-tempo',
    title: '4. Patches, tempo and volume',
    body: (
      <>
        <ul>
          <li><strong>Patch</strong>: select a track and pick one under “Patch” in the inspector on the right. Try Electric Piano 1 for the piano and String Ensemble 1 for the guitar to change the mood.</li>
          <li><strong>Tempo</strong>: click the BPM in the transport and type a number. 120 is average, 90 relaxed, 140 brisk. To change it in the middle of the song, use the conductor.</li>
          <li><strong>Volume and stereo position</strong>: move Volume and Pan on the “Mixer” tab. You can do this while the song plays.</li>
        </ul>
        <p>The patch is stored as a Program Change at the start of the song and the volume as a CC, and both go into the MIDI file.</p>
      </>
    ),
  },
  {
    id: 'play-in',
    title: '5. Play it in',
    body: (
      <>
        <p>Besides clicking notes in, you can turn the keyboard into an instrument and play.</p>
        <ol>
          <li>Press <K>{ALT}K</K> to switch the input mode to “Keys”. The bottom row Z–M is C4–B4 and the top row Q–I is one octave higher. <K>↑↓</K> changes the octave.</li>
          <li>Press R (record-arm) on “Piano”, then <K>R</K> to start recording. After a one-bar count-in, what you play goes straight in. <K>R</K> stops.</li>
          <li>If the timing is off, select the notes and press <K>Q</K>. They line up with the edit grid (quantize).</li>
          <li>Press <K>Esc</K> to return to edit mode. While in Keys mode, the single-letter shortcuts play notes instead, so keep that in mind.</li>
        </ol>
        <p>With a MIDI keyboard, choosing “Use” in the startup dialog is all it takes. For drums, use the “Pads” mode (<K>{ALT}P</K>).</p>
      </>
    ),
  },
  {
    id: 'arrange',
    title: '6. Shape it into a song',
    body: (
      <>
        <ul>
          <li>In the track view, drag from empty space to select the clips of all four tracks at once. <K>{MOD}D</K> duplicates them right after themselves: two bars four times makes eight. A single clip can also be duplicated with <K>{ALT}</K>+drag.</li>
          <li>Change notes only where you want variation. Changing velocities adds dynamics (drag in the Velocity lane under the piano roll).</li>
          <li>If it feels too mechanical, select the notes and use Edit › Notes › Humanize…. Positions and velocities get a little looser.</li>
          <li>Markers (right-click the marker row in the track view, or use the conductor) named Intro / A / B keep you oriented.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'save',
    title: '7. Save and export',
    body: (
      <>
        <ul>
          <li><K>{MOD}S</K> saves to the browser. The next time you open the app, the startup dialog offers to continue where you left off.</li>
          <li>To keep the song as a file, use File › Save as .midstudio…. To pass it to other software, Export MIDI… (.mid).</li>
          <li>To let people hear it as audio, Export WAV….</li>
        </ul>
        <p>Data inside the browser disappears together with the browser’s site data when that is cleared. Keep important songs as files too.</p>
      </>
    ),
  },
  {
    id: 'next',
    title: 'Where to go next',
    body: (
      <>
        <ul>
          <li>Open VISION or Merry X'mas For You! from File › Sample songs to see how a song with more than 20 tracks is put together. Your own .mid files open with File › Import MIDI….</li>
          <li>For exact numeric entry use the “List” tab: Recomposer-style MEAS / STEP / NOTE / ST / GT / VEL, entirely from the PC keyboard.</li>
          <li>Visual mode (<K>T</K>) lets you watch every track while the song plays.</li>
          <li>The details of every operation are in the help (<K>F1</K>); the GS SysEx support is summarised under “GM / GS” there.</li>
        </ul>
      </>
    ),
  },
];
