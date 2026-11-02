// GS drum kit program numbers (MIDI program 0..127; UI shows +1). Whether a kit exists depends on
// the loaded SoundFont: the UI checks the synth's preset list and labels missing kits.
export const GS_DRUM_KITS: { program: number; name: string }[] = [
  { program: 0, name: 'Standard' },
  { program: 8, name: 'Room' },
  { program: 16, name: 'Power' },
  { program: 24, name: 'Electronic' },
  { program: 25, name: 'TR-808' },
  { program: 32, name: 'Jazz' },
  { program: 40, name: 'Brush' },
  { program: 48, name: 'Orchestra' },
  { program: 56, name: 'SFX' },
];
