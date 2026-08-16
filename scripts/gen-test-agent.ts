const { createHash, randomBytes } = require("node:crypto");

function sha256Hex(input) {
  return createHash("sha256").update(Buffer.from(input, "utf-8")).digest("hex");
}

async function main() {
  // Generate using Node.js crypto Ed25519
  // ed25519 keypair generation requires @noble/ed25519 or similar
  // Using noble/ed25519 which is ESM-only, need a workaround
  console.log(
    JSON.stringify({
      note: "Cannot import @noble/ed25519 directly from CJS. Use the /docs/integrate page in-browser generator instead.",
    })
  );
}

main();