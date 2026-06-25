import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

/** Configures @noble/ed25519 to use @noble/hashes sha512. */
export function configureEd25519(): void {
  ed.hashes.sha512 = sha512;
  ed.hashes.sha512Async = (message: Uint8Array) =>
    Promise.resolve(sha512(message));
}

configureEd25519();

export { ed };
