import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
// Synthetic probes. Never print credentials, request headers or response bodies.
const probes = [
  {
    name: "Sarvam JSON output",
    key: "SARVAM_API_KEY",
    url: `https://api.sarvam.ai/${(process.env.SARVAM_MODEL || "sarvam-105b").startsWith("sarvam-") ? "v1" : "v2"}/chat/completions`,
    header: "api-subscription-key",
    body: {
      model: process.env.SARVAM_MODEL || "sarvam-105b",
      max_tokens: 128,
      response_format: { type: "json_object" },
      ...((process.env.SARVAM_MODEL || "sarvam-105b").startsWith("sarvam-")
        ? {}
        : { extra_body: { chat_template_kwargs: { enable_thinking: false } } }),
      messages: [{ role: "user", content: 'Return JSON only: {"ok":true}' }],
    },
  },
  {
    name: "Parallel search",
    key: "PARALLEL_API_KEY",
    url: "https://api.parallel.ai/v1/search",
    header: "x-api-key",
    body: {
      objective:
        "Find an authoritative definition of percentage for an educational quiz.",
      search_queries: ["percentage definition mathematics"],
    },
  },
];
for (const probe of probes) {
  if (process.argv.includes("--sarvam-only") && probe.key !== "SARVAM_API_KEY")
    continue;
  if (!process.env[probe.key]) {
    console.log(probe.name + ": key missing");
    process.exitCode = 1;
    continue;
  }
  try {
    const response = await fetch(probe.url, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "content-type": "application/json",
        [probe.header]: process.env[probe.key],
      },
      body: JSON.stringify(probe.body),
    });
    if (!response.ok) {
      console.log(probe.name + ": HTTP " + response.status);
      const details = JSON.stringify(await response.json()).toLowerCase();
      const reason =
        details.includes("whitelist") || details.includes("beta")
          ? "model requires beta access"
          : details.includes("model")
            ? "model or model parameter rejected"
            : details.includes("key")
              ? "credential rejected"
              : details.includes("quota")
                ? "quota exhausted"
                : "request rejected";
      console.log("Category: " + reason);
      process.exitCode = 1;
      continue;
    }
    const result = await response.json();
    const valid =
      probe.key === "SARVAM_API_KEY"
        ? JSON.parse(result.choices?.[0]?.message?.content || "null")?.ok ===
          true
        : Array.isArray(result.results) && result.results.length > 0;
    console.log(
      probe.name + ": " + (valid ? "verified" : "unexpected response shape"),
    );
    if (!valid) process.exitCode = 1;
  } catch {
    console.log(probe.name + ": connection or response validation failed");
    process.exitCode = 1;
  }
}
