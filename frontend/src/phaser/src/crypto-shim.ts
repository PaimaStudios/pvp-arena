// crypto-browserify does not implement timingSafeEqual; re-export everything
// from it and add the missing function.
// @ts-ignore – no types for crypto-browserify
export * from 'crypto-browserify';

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
