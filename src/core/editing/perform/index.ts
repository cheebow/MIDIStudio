// Performance tools (ADR-077 / 078, revived under 入力支援 in ADR-092): pure transforms of the selected notes.
export type { TransformResult } from './types';
export { strumChords, detectStrokes, type StrumOptions, type StrokeMode, type StrumSpeed, type Stroke } from './strum';
export { arpeggiateChords, arpeggioStepTicks, arpeggioStepLengths, noteValueName, type ArpeggioPattern, type ArpeggioOptions, type ArpeggioRhythm, type ArpeggioEnds } from './arpeggio';
export { legatoNotes, type LegatoMode, type LegatoOptions } from './legato';
export { shapeVelocities, type VelocityShape, type VelocityShaperOptions } from './velocityShaper';
