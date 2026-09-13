import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Odhu Indhu, one hour every day";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ledger = await readFile(
  join(process.cwd(), "public/opening-ledger/frame-4.png"),
  "base64",
);
const ledgerSrc = `data:image/png;base64,${ledger}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#f4f0e6",
        color: "#111111",
        padding: "68px 72px",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "30px",
          border: "2px solid #111111",
          display: "flex",
        }}
      />
      <div
        style={{
          width: "57%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "0.16em",
          }}
        >
          <span
            style={{
              width: 24,
              height: 34,
              marginRight: 16,
              background: "#a51c20",
              borderLeft: "8px solid #111111",
              borderRight: "8px solid #111111",
            }}
          />
          ODHU INDHU
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: "-0.05em" }}>
            One hour.
          </div>
          <div
            style={{
              color: "#a51c20",
              fontSize: 76,
              lineHeight: 1.05,
              letterSpacing: "-0.05em",
            }}
          >
            Every day.
          </div>
          <div
            style={{
              marginTop: 30,
              maxWidth: 530,
              color: "#6c675f",
              fontSize: 23,
              lineHeight: 1.45,
            }}
          >
            Build an honest study streak. Recall what matters when it matters.
          </div>
        </div>
        <div style={{ display: "flex", gap: 28, fontSize: 15, letterSpacing: "0.1em" }}>
          <span>LOG</span>
          <span style={{ color: "#a51c20" }}>01</span>
          <span>STREAK</span>
          <span style={{ color: "#a51c20" }}>02</span>
          <span>RECALL</span>
        </div>
      </div>
      <img
        src={ledgerSrc}
        alt=""
        width="560"
        height="560"
        style={{
          position: "absolute",
          right: "25px",
          bottom: "5px",
          width: "545px",
          height: "545px",
          objectFit: "contain",
        }}
      />
    </div>,
    size,
  );
}
