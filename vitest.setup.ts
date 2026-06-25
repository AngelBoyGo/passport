import { configureEd25519 } from "./src/lib/receipt/crypto";

configureEd25519();

process.env.SIGNING_PRIVATE_KEY =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
