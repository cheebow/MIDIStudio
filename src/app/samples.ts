// Sample songs shipped with the app (ADR-058): the author's own MIDI data, served from
// public/samples/ next to the app and opened through the same SMF import as any file.
export interface SampleSong {
  id: string;
  file: string;
  title: string;
  /** one line shown next to the title */
  note: string;
}

export const SAMPLE_SONGS: readonly SampleSong[] = [
  { id: 'vision', file: 'vision.mid', title: 'VISION (GS Version)', note: '23 トラック、テンポチェンジあり' },
  { id: 'xmas', file: 'xmas.mid', title: "Merry X'mas For You!", note: '22 トラック' },
];

export const SAMPLE_CREDIT = '作曲・制作: cheebow。MIDI Studio で聴く・編集するためのサンプル曲で、曲そのものの再配布・商用利用はできません。';

export function sampleUrl(song: SampleSong): string {
  return `${import.meta.env.BASE_URL}samples/${song.file}`;
}
