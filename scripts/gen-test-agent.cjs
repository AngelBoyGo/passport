const crypto = require("node:crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(Buffer.from(input, "utf-8")).digest("hex");
}

async function main() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const pubHex = Buffer.from(publicKey).toString("hex");
  const privHex = Buffer.from(privateKey).toString("hex");

  // Log DER structures for debugging
  console.error("Public key DER (" + publicKey.length + " bytes): " + pubHex);
  console.error("Private key DER (" + privateKey.length + " bytes): " + privHex);

  // For ed25519 PKCS8: the raw seed is the last 32 bytes
  // SPKI public key: last 32 bytes is the raw public key
  if (publicKey.length === 44) {
    const rawPub = publicKey.subarray(12);
    const pub32 = Buffer.from(rawPub).toString("hex");

    if (privateKey.length === 48) {
      // PKCS8 for ed25519: 16 bytes header + 32 bytes seed
      const rawPriv = privateKey.subarray(16, 48);
      const priv32 = Buffer.from(rawPriv).toString("hex");
      const commitment = sha256Hex("agent-id:" + pub32.toLowerCase() + ":passport-v1");

      console.log(JSON.stringify({ publicKey: pub32, privateKey: priv32, subjectCommitment: commitment }, null, 2));
    }
  }
}

main().catch(console.error);