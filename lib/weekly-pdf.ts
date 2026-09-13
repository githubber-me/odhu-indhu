import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { weekLabel, WeeklyReportMetrics } from "./weekly-domain";

const PAGE_WIDTH = 390;
const PAGE_HEIGHT = 844;
const MARGIN = 26;
const ink = rgb(0.07, 0.07, 0.07);
const red = rgb(0.65, 0.11, 0.13);
const paper = rgb(0.957, 0.941, 0.902);
const muted = rgb(0.42, 0.4, 0.37);
const line = rgb(0.82, 0.79, 0.73);

function safe(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(value: string, width: number) {
  const words = safe(value).split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current) lines.push(current);
      current = word;
    } else current = (current + " " + word).trim();
  }
  if (current) lines.push(current);
  return lines;
}

function frame(
  pdf: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  pageNumber: number,
) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: paper });
  page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 50, width: 20, height: 20, color: red });
  page.drawText("ODHU INDHU", { x: 55, y: PAGE_HEIGHT - 43, size: 9, font: bold, color: ink });
  page.drawText(`WEEKLY LEDGER  /  ${String(pageNumber).padStart(2, "0")}`, {
    x: 256,
    y: PAGE_HEIGHT - 43,
    size: 7,
    font: bold,
    color: muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 65 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 65 },
    thickness: 1,
    color: ink,
  });
  page.drawLine({
    start: { x: MARGIN, y: 35 },
    end: { x: PAGE_WIDTH - MARGIN, y: 35 },
    thickness: 1,
    color: ink,
  });
  page.drawText("A LITTLE MORE, EVERY DAY.", { x: MARGIN, y: 20, size: 7, font: bold, color: muted });
  return page;
}

function title(page: PDFPage, bold: PDFFont, eyebrow: string, lead: string, accent: string) {
  page.drawText(eyebrow, { x: MARGIN, y: 747, size: 8, font: bold, color: muted });
  page.drawText(lead, { x: MARGIN, y: 706, size: 28, font: bold, color: ink });
  page.drawText(accent, { x: MARGIN, y: 670, size: 28, font: bold, color: red });
}

function paragraph(page: PDFPage, font: PDFFont, value: string, y: number, maxLines = 6) {
  const lines = wrap(value, 50).slice(0, maxLines);
  lines.forEach((text, index) =>
    page.drawText(text, { x: MARGIN, y: y - index * 17, size: 11, font, color: ink }),
  );
  return y - lines.length * 17;
}

export async function weeklyPdf(name: string, report: WeeklyReportMetrics) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const overview = frame(pdf, regular, bold, 1);
  title(overview, bold, "YOUR WEEK, ACCOUNTED FOR", "Showed up.", "Kept the record.");
  overview.drawText(`${safe(name)}  /  ${weekLabel(report.weekStart)}`, {
    x: MARGIN,
    y: 640,
    size: 9,
    font: regular,
    color: muted,
  });
  const metrics = [
    [String(report.totalMinutes), "MINUTES"],
    [String(report.activeDays), "ACTIVE DAYS"],
    [String(report.qualifiedDays), "HOURS KEPT"],
    [String(report.sessionCount), "SESSIONS"],
  ];
  metrics.forEach(([value, metricLabel], index) => {
    const x = MARGIN + (index % 2) * 169;
    const y = 580 - Math.floor(index / 2) * 82;
    overview.drawText(value, { x, y, size: 29, font: bold, color: index === 0 ? red : ink });
    overview.drawText(metricLabel, { x, y: y - 15, size: 7, font: bold, color: muted });
  });
  overview.drawText("THE SEVEN DAYS", { x: MARGIN, y: 402, size: 8, font: bold, color: muted });
  const graphY = 255;
  const graphHeight = 115;
  const maxMinutes = Math.max(60, ...report.dailyMinutes.map((day) => day.minutes));
  overview.drawLine({
    start: { x: MARGIN, y: graphY + (60 / maxMinutes) * graphHeight },
    end: { x: PAGE_WIDTH - MARGIN, y: graphY + (60 / maxMinutes) * graphHeight },
    thickness: 0.5,
    color: muted,
  });
  overview.drawText("60", { x: PAGE_WIDTH - 38, y: graphY + (60 / maxMinutes) * graphHeight + 4, size: 6, font: bold, color: muted });
  const dayNames = ["M", "T", "W", "T", "F", "S", "S"];
  report.dailyMinutes.forEach((day, index) => {
    const x = MARGIN + index * 49;
    const barHeight = (day.minutes / maxMinutes) * graphHeight;
    overview.drawRectangle({
      x,
      y: graphY,
      width: 28,
      height: Math.max(1, barHeight),
      color: day.minutes >= 60 ? red : ink,
    });
    overview.drawText(dayNames[index], { x: x + 10, y: graphY - 17, size: 7, font: bold, color: muted });
    overview.drawText(String(day.minutes), { x: x + 5, y: graphY + Math.max(4, barHeight) + 6, size: 7, font: bold, color: ink });
  });
  overview.drawText("WHAT THE LEDGER SAYS", { x: MARGIN, y: 202, size: 8, font: bold, color: muted });
  paragraph(overview, regular, report.summary, 178, 7);

  const comparison = frame(pdf, regular, bold, 2);
  title(comparison, bold, "INTENTION / EVIDENCE", "What you meant.", "What appeared.");
  comparison.drawText("PLANNED GOALS", { x: MARGIN, y: 628, size: 8, font: bold, color: muted });
  if (!report.goals.length) {
    comparison.drawText("No Monday plan was recorded for this week.", { x: MARGIN, y: 600, size: 11, font: regular, color: muted });
  } else {
    report.goals.slice(0, 7).forEach((goal, index) => {
      const y = 603 - index * 55;
      comparison.drawText(goal.status.toUpperCase(), {
        x: MARGIN,
        y,
        size: 7,
        font: bold,
        color: goal.status === "achieved" ? red : muted,
      });
      wrap(goal.title, 42).slice(0, 2).forEach((text, lineIndex) =>
        comparison.drawText(text, { x: 112, y: y - lineIndex * 13, size: 10, font: regular, color: ink }),
      );
      comparison.drawLine({ start: { x: MARGIN, y: y - 20 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 20 }, thickness: 0.5, color: line });
    });
  }
  comparison.drawText("CATEGORY BALANCE", { x: MARGIN, y: 198, size: 8, font: bold, color: muted });
  const topCategories = report.categories.slice(0, 4);
  const largest = Math.max(1, ...topCategories.map((category) => category.minutes));
  topCategories.forEach((category, index) => {
    const y = 164 - index * 31;
    comparison.drawText(safe(category.name).slice(0, 22) || "Study", { x: MARGIN, y, size: 8, font: regular, color: ink });
    comparison.drawRectangle({ x: 148, y: y - 1, width: (category.minutes / largest) * 155, height: 8, color: index === 0 ? red : ink });
    comparison.drawText(`${category.minutes}m`, { x: 312, y, size: 7, font: bold, color: muted });
  });

  const reflection = frame(pdf, regular, bold, 3);
  title(reflection, bold, "REFLECTION / NEXT WEEK", "Keep what worked.", "Change what did not.");
  let y = 625;
  const blocks: [string, string[]][] = [
    ["WHAT FELT GOOD", report.reflection.highlights],
    ["WHAT GOT IN THE WAY", report.reflection.challenges],
  ];
  for (const [heading, items] of blocks) {
    reflection.drawText(heading, { x: MARGIN, y, size: 8, font: bold, color: muted });
    y -= 25;
    const shown = items.length ? items.slice(0, 3) : ["Nothing was singled out in the reflection."];
    for (const item of shown) {
      reflection.drawRectangle({ x: MARGIN, y: y + 3, width: 5, height: 5, color: red });
      wrap(item, 45).slice(0, 2).forEach((text, index) =>
        reflection.drawText(text, { x: 42, y: y - index * 14, size: 10, font: regular, color: ink }),
      );
      y -= 46;
    }
    y -= 12;
  }
  reflection.drawText("A BETTER NEXT WEEK", { x: MARGIN, y: 222, size: 8, font: bold, color: muted });
  report.improvements.slice(0, 3).forEach((item, index) => {
    const itemY = 188 - index * 48;
    reflection.drawText(String(index + 1).padStart(2, "0"), { x: MARGIN, y: itemY, size: 13, font: bold, color: red });
    wrap(item, 44).slice(0, 2).forEach((text, lineIndex) =>
      reflection.drawText(text, { x: 58, y: itemY - lineIndex * 14, size: 10, font: regular, color: ink }),
    );
  });

  pdf.setTitle(`Odhu Indhu weekly ledger, ${weekLabel(report.weekStart)}`);
  pdf.setAuthor("Odhu Indhu");
  pdf.setSubject("A mobile-first weekly study report");
  return pdf.save();
}
