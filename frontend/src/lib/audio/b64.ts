// String.fromCharCode(...bytes) throws RangeError past roughly 100k
// arguments, and a 100ms PCM16 chunk at 16kHz is 3200 bytes, so a naive
// spread works right up until someone raises the chunk size and then fails
// mid-demo. Chunk it.

export function bytesToB64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
