try {
  const noble = require("@noble/ed25519");
  console.log("noble OK:", typeof noble.sign);
} catch(e) {
  console.log("noble FAIL:", e.message);
  try {
    const noble2 = require("/app/node_modules/@noble/ed25519/index.js");
    console.log("noble2 OK:", typeof noble2.sign);
  } catch(e2) {
    console.log("noble2 FAIL:", e2.message);
  }
}
try {
  const { sha256 } = require("@noble/hashes/sha2.js");
  console.log("sha256 OK:", typeof sha256);
} catch(e) {
  console.log("sha256 FAIL:", e.message);
}