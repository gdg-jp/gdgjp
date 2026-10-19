/**
 * AudioWorkletGlobalScope lacks globals the wasm-bindgen glue expects. It has
 * no TextDecoder/TextEncoder, but the glue builds both at load (it only uses
 * them for panic messages). Must be imported before the glue.
 */
const scope = globalThis as unknown as Record<string, unknown>;

if (!scope.TextDecoder) {
  scope.TextDecoder = class {
    decode(bytes?: ArrayBufferView | ArrayBuffer): string {
      if (!bytes) return "";
      const view =
        bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let out = "";
      for (let i = 0; i < view.length; ) {
        const b = view[i++] ?? 0;
        let cp = b;
        if (b >= 0xf0) cp = ((b & 7) << 18) | (cont(view, i++) << 12) | (cont(view, i++) << 6);
        else if (b >= 0xe0) cp = ((b & 15) << 12) | (cont(view, i++) << 6);
        else if (b >= 0xc0) cp = (b & 31) << 6;
        if (b >= 0xc0) cp |= cont(view, i++);
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  };
}

// Nor `crypto`, which getrandom (seeding the model's hash maps, nothing
// secret) asks for at df_create; without it the wasm panics.
if (!scope.crypto) {
  scope.crypto = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return array;
    },
  };
}
if (!scope.self) scope.self = globalThis;

function cont(view: Uint8Array, i: number): number {
  return (view[i] ?? 0) & 63;
}

if (!scope.TextEncoder) {
  scope.TextEncoder = class {
    encode(text = ""): Uint8Array {
      const out: number[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) {
          out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else {
          out.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 63),
            0x80 | ((cp >> 6) & 63),
            0x80 | (cp & 63),
          );
        }
      }
      return new Uint8Array(out);
    }
    encodeInto(text: string, dest: Uint8Array) {
      const bytes = this.encode(text);
      dest.set(bytes.subarray(0, dest.length));
      return { read: text.length, written: Math.min(bytes.length, dest.length) };
    }
  };
}
