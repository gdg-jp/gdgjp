const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LINK_PREFIX = "link_";
const LINK_ID_RE = /^link_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function uuidv7Bytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const msBig = BigInt(Date.now());
  bytes[0] = Number((msBig >> 40n) & 0xffn);
  bytes[1] = Number((msBig >> 32n) & 0xffn);
  bytes[2] = Number((msBig >> 24n) & 0xffn);
  bytes[3] = Number((msBig >> 16n) & 0xffn);
  bytes[4] = Number((msBig >> 8n) & 0xffn);
  bytes[5] = Number(msBig & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

function encodeBase32(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const chars = new Array<string>(26);
  for (let i = 25; i >= 0; i--) {
    chars[i] = ALPHABET[Number(n & 31n)];
    n >>= 5n;
  }
  return chars.join("");
}

export function newLinkId(): string {
  return `${LINK_PREFIX}${encodeBase32(uuidv7Bytes())}`;
}

export function isLinkId(value: string): boolean {
  return LINK_ID_RE.test(value);
}
