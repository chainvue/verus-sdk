declare module 'bs58check' {
  export function encode(payload: Buffer): string;
  export function decode(string: string): Buffer;
  export function decodeUnsafe(string: string): Buffer | undefined;
}
