import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exit(1);
}
process.stdout.write(
  "Choose a private passphrase (12–72 characters; input hidden): ",
);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
let password = "";
process.stdin.on("data", async (chunk) => {
  for (const char of chunk) {
    if (char === "\u0003") process.exit(1);
    if (char === "\r" || char === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (password.length < 12 || Buffer.byteLength(password) > 72) {
        console.error(
          "\nUse at least 12 characters and at most 72 UTF-8 bytes.",
        );
        process.exit(1);
      }
      const digest = await hash(password, 12);
      console.log(
        "\nFor .env.local (dollar signs escaped for Next.js dotenv expansion):",
      );
      console.log("APP_PASSWORD_HASH=" + digest.replaceAll("$", "\\$"));
      console.log("AUTH_SECRET=" + randomBytes(32).toString("hex"));
      console.log("CRON_SECRET=" + randomBytes(32).toString("hex"));
      console.log(
        "\nFor the Vercel APP_PASSWORD_HASH value (no escaping):\n" + digest,
      );
      console.log(
        "Use the same AUTH_SECRET and CRON_SECRET values in Vercel. Keep all output private.",
      );
      process.exit(0);
    }
    if (char === "\u007f") password = password.slice(0, -1);
    else password += char;
  }
});
