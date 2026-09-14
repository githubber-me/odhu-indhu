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

function logoMark(page: PDFPage, x: number, top: number, size = 26) {
  const scale = size / 40;
  page.drawSvgPath("M4 12v19l16 7 16-7V12l-16 7z", {
    x,
    y: top,
    scale,
    color: ink,
  });
  page.drawSvgPath("M10 5v18l7 3V8zm13 3v18l7-3V5z", {
    x,
    y: top,
    scale,
    color: red,
  });
  page.drawSvgPath("M19 21h2v12h-2z", {
    x,
    y: top,
    scale,
    color: paper,
  });
}

function openBook(page: PDFPage, x: number, y: number, scale = 1) {
  const width = 38 * scale;
  const height = 23 * scale;
  page.drawLine({ start: { x, y: y + height }, end: { x: x + width / 2, y: y + height - 5 * scale }, thickness: 1, color: ink });
  page.drawLine({ start: { x: x + width, y: y + height }, end: { x: x + width / 2, y: y + height - 5 * scale }, thickness: 1, color: ink });
  page.drawLine({ start: { x, y: y + height }, end: { x, y }, thickness: 1, color: ink });
  page.drawLine({ start: { x: x + width, y: y + height }, end: { x: x + width, y }, thickness: 1, color: ink });
  page.drawLine({ start: { x, y }, end: { x: x + width / 2, y: y - 4 * scale }, thickness: 1, color: ink });
  page.drawLine({ start: { x: x + width, y }, end: { x: x + width / 2, y: y - 4 * scale }, thickness: 1, color: ink });
  page.drawLine({ start: { x: x + width / 2, y: y + height - 5 * scale }, end: { x: x + width / 2, y: y - 4 * scale }, thickness: 1, color: ink });
  page.drawCircle({ x: x + width / 2, y: y + height + 9 * scale, size: 4 * scale, color: red });
}

function speechMark(page: PDFPage, x: number, y: number) {
  page.drawRectangle({ x, y, width: 31, height: 20, borderColor: ink, borderWidth: 1 });
  page.drawLine({ start: { x: x + 8, y }, end: { x: x + 4, y: y - 5 }, thickness: 1, color: ink });
  [8, 15.5, 23].forEach((offset, index) =>
    page.drawCircle({ x: x + offset, y: y + 10, size: 1.5, color: index === 1 ? red : ink }),
  );
}

function completionVisual(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  goals: WeeklyReportMetrics["goals"],
  top: number,
) {
  page.drawText("INTENTION TO EVIDENCE", { x: MARGIN, y: top, size: 8, font: bold, color: muted });
  const achieved = goals.filter((goal) => goal.status === "achieved").length;
  const partial = goals.filter((goal) => goal.status === "partial").length;
  const total = goals.length;
  const centerX = 68;
  const centerY = top - 49;
  const segments = 28;
  for (let index = 0; index < segments; index += 1) {
    const angle = Math.PI / 2 - (index / segments) * Math.PI * 2;
    const rank = Math.floor((index / segments) * Math.max(1, total));
    const color = !total
      ? line
      : rank < achieved
        ? red
        : rank < achieved + partial
          ? ink
          : line;
    page.drawCircle({
      x: centerX + Math.cos(angle) * 27,
      y: centerY + Math.sin(angle) * 27,
      size: 2.2,
      color,
    });
  }
  const score = `${achieved}/${total}`;
  page.drawText(score, {
    x: centerX - bold.widthOfTextAtSize(score, 13) / 2,
    y: centerY - 4,
    size: 13,
    font: bold,
    color: total ? ink : muted,
  });
  page.drawText("ACHIEVED", { x: 45, y: centerY - 39, size: 6, font: bold, color: muted });

  const engaged = achieved + partial;
  const path = [
    { x: 150, value: total, label: "PLANNED" },
    { x: 242, value: engaged, label: "ATTEMPTED" },
    { x: 334, value: achieved, label: "EVIDENCED" },
  ];
  page.drawLine({ start: { x: 150, y: centerY }, end: { x: 334, y: centerY }, thickness: 1, color: line });
  path.forEach((point, index) => {
    page.drawCircle({ x: point.x, y: centerY, size: 7, color: index === 2 ? red : ink });
    page.drawCircle({ x: point.x, y: centerY, size: 3, color: paper });
    const value = String(point.value);
    page.drawText(value, {
      x: point.x - bold.widthOfTextAtSize(value, 8) / 2,
      y: centerY + 13,
      size: 8,
      font: bold,
      color: ink,
    });
    page.drawText(point.label, {
      x: point.x - regular.widthOfTextAtSize(point.label, 5.5) / 2,
      y: centerY - 19,
      size: 5.5,
      font: regular,
      color: muted,
    });
  });
}

function frame(
  pdf: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  pageNumber: number,
) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: paper });
  page.drawLine({ start: { x: 20, y: PAGE_HEIGHT - 24 }, end: { x: 52, y: PAGE_HEIGHT - 24 }, thickness: 1, color: ink });
  page.drawLine({ start: { x: 20, y: PAGE_HEIGHT - 24 }, end: { x: 20, y: PAGE_HEIGHT - 56 }, thickness: 1, color: ink });
  logoMark(page, MARGIN - 2, PAGE_HEIGHT - 20, 28);
  page.drawText("ODHU INDHU", { x: 59, y: PAGE_HEIGHT - 43, size: 9, font: bold, color: ink });
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
  [0, 1, 2].forEach((step) => {
    const offset = step * 5;
    page.drawLine({ start: { x: 329 + offset, y: 47 + offset }, end: { x: 364, y: 47 + offset }, thickness: 0.7, color: step === 2 ? red : muted });
    page.drawLine({ start: { x: 329 + offset, y: 47 + offset }, end: { x: 329 + offset, y: 57 + offset }, thickness: 0.7, color: step === 2 ? red : muted });
  });
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
  const chartX = MARGIN;
  const chartY = 242;
  const chartWidth = PAGE_WIDTH - MARGIN * 2;
  const chartHeight = 142;
  const graphLeft = chartX + 18;
  const graphRight = chartX + chartWidth - 18;
  const graphY = chartY + 30;
  const graphHeight = chartHeight - 48;
  const maxMinutes = Math.max(60, ...report.dailyMinutes.map((day) => day.minutes));
  overview.drawRectangle({
    x: chartX,
    y: chartY,
    width: chartWidth,
    height: chartHeight,
    borderColor: ink,
    borderWidth: 1,
  });
  overview.drawLine({
    start: { x: graphLeft, y: graphY + (60 / maxMinutes) * graphHeight },
    end: { x: graphRight, y: graphY + (60 / maxMinutes) * graphHeight },
    thickness: 0.5,
    color: muted,
  });
  overview.drawText("60", {
    x: graphRight - 11,
    y: graphY + (60 / maxMinutes) * graphHeight + 4,
    size: 6,
    font: bold,
    color: muted,
  });
  const points = report.dailyMinutes.map((day, index) => ({
    day,
    x:
      graphLeft +
      (index * (graphRight - graphLeft)) /
        Math.max(1, report.dailyMinutes.length - 1),
    y: graphY + (day.minutes / maxMinutes) * graphHeight,
  }));
  points.slice(1).forEach((point, index) => {
    overview.drawLine({
      start: { x: points[index].x, y: points[index].y },
      end: { x: point.x, y: point.y },
      thickness: 2,
      color: red,
    });
  });
  points.forEach(({ day, x, y }) => {
    const [, month, date] = day.date.split("-");
    overview.drawCircle({ x, y, size: 4, color: day.minutes >= 60 ? red : ink });
    overview.drawCircle({ x, y, size: 1.5, color: paper });
    const minuteLabel = String(day.minutes);
    overview.drawText(minuteLabel, {
      x: x - bold.widthOfTextAtSize(minuteLabel, 7) / 2,
      y: Math.min(y + 8, chartY + chartHeight - 12),
      size: 7,
      font: bold,
      color: ink,
    });
    const dateLabel = `${date}/${month}`;
    overview.drawText(dateLabel, {
      x: x - regular.widthOfTextAtSize(dateLabel, 6) / 2,
      y: chartY + 10,
      size: 6,
      font: regular,
      color: muted,
    });
  });
  overview.drawText("WHAT THE LEDGER SAYS", { x: MARGIN, y: 202, size: 8, font: bold, color: muted });
  paragraph(overview, regular, report.summary, 178, 7);

  const comparison = frame(pdf, regular, bold, 2);
  title(comparison, bold, "INTENTION / EVIDENCE", "What you meant.", "What appeared.");
  comparison.drawText("PLANNED GOALS", { x: MARGIN, y: 628, size: 8, font: bold, color: muted });
  const shownGoals = report.goals.slice(0, 7);
  const compactGoals = shownGoals.length > 5;
  const goalRowHeight = compactGoals ? 40 : 52;
  let goalsBottom = 568;
  if (!report.goals.length) {
    openBook(comparison, MARGIN, 568, 0.8);
    comparison.drawText("No Monday plan was recorded for this week.", { x: 74, y: 586, size: 10, font: regular, color: muted });
  } else {
    shownGoals.forEach((goal, index) => {
      const y = 603 - index * goalRowHeight;
      comparison.drawText(goal.status.toUpperCase(), {
        x: MARGIN,
        y,
        size: 7,
        font: bold,
        color: goal.status === "achieved" ? red : muted,
      });
      wrap(goal.title, compactGoals ? 46 : 42).slice(0, compactGoals ? 1 : 2).forEach((text, lineIndex) =>
        comparison.drawText(text, { x: 112, y: y - lineIndex * 13, size: compactGoals ? 9 : 10, font: regular, color: ink }),
      );
      comparison.drawLine({ start: { x: MARGIN, y: y - 20 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 20 }, thickness: 0.5, color: line });
    });
    goalsBottom = 603 - (shownGoals.length - 1) * goalRowHeight - 20;
  }
  const visualTop = Math.min(385, goalsBottom - 20);
  completionVisual(comparison, regular, bold, shownGoals, visualTop);
  const categoryHeadingY = visualTop - 118;
  comparison.drawText("CATEGORY BALANCE", { x: MARGIN, y: categoryHeadingY, size: 8, font: bold, color: muted });
  const topCategories = report.categories.slice(0, 4);
  const largest = Math.max(1, ...topCategories.map((category) => category.minutes));
  if (!topCategories.length) {
    openBook(comparison, MARGIN, categoryHeadingY - 56, 0.75);
    comparison.drawText("No category evidence was recorded.", { x: 68, y: categoryHeadingY - 35, size: 9, font: regular, color: muted });
  } else {
    topCategories.forEach((category, index) => {
      const y = categoryHeadingY - 34 - index * 27;
      comparison.drawText(safe(category.name).slice(0, 22) || "Study", { x: MARGIN, y, size: 8, font: regular, color: ink });
      comparison.drawRectangle({ x: 148, y: y - 1, width: (category.minutes / largest) * 155, height: 8, color: index === 0 ? red : ink });
      comparison.drawText(`${category.minutes}m`, { x: 312, y, size: 7, font: bold, color: muted });
    });
  }

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
      if (items.length) reflection.drawRectangle({ x: MARGIN, y: y + 3, width: 5, height: 5, color: red });
      else speechMark(reflection, MARGIN, y - 5);
      wrap(item, 45).slice(0, 2).forEach((text, index) =>
        reflection.drawText(text, { x: items.length ? 42 : 68, y: y - index * 14, size: 10, font: regular, color: items.length ? ink : muted }),
      );
      y -= 46;
    }
    y -= 12;
  }
  const nextWeekY = Math.min(335, y - 18);
  reflection.drawText("A BETTER NEXT WEEK", { x: MARGIN, y: nextWeekY, size: 8, font: bold, color: muted });
  report.improvements.slice(0, 3).forEach((item, index) => {
    const itemY = nextWeekY - 34 - index * 48;
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
