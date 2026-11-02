// User-initiated local file save (REQ-NFR-04: nothing is uploaded anywhere).

export function downloadBytes(bytes: Uint8Array | string, fileName: string, mime: string): void {
  const part: BlobPart = typeof bytes === 'string' ? bytes : (bytes.slice().buffer as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-name safe version of a project title. */
export function safeFileName(title: string, ext: string): string {
  const base = [...title].map((c) => (c.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(c) ? '_' : c)).join('').trim() || 'untitled';
  return `${base.slice(0, 100)}.${ext}`;
}
