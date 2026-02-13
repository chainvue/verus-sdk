declare module 'create-hash' {
  import { Hash } from 'crypto';
  function createHash(algorithm: string): Hash;
  export = createHash;
}
