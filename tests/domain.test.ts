import test from "node:test";
import assert from "node:assert/strict";
import {
  csv,
  entrySchema,
  istDate,
  shiftDate,
  streakStats,
  publicQuestions,
  questionSchema,
} from "../lib/domain";
test("IST midnight is authoritative regardless of machine timezone", () => {
  assert.equal(istDate(new Date("2026-09-13T18:29:59Z")), "2026-09-13");
  assert.equal(istDate(new Date("2026-09-13T18:30:00Z")), "2026-09-14");
});
test("sessions add to exactly one qualified day; yesterday survives until today closes", () => {
  const sessions = [
    { date: "2026-09-12", duration: 60 },
    { date: "2026-09-13", duration: 30 },
    { date: "2026-09-13", duration: 30 },
  ];
  assert.equal(streakStats(sessions, "2026-09-13").current, 2);
  assert.equal(streakStats(sessions, "2026-09-14").current, 2);
  assert.equal(streakStats(sessions, "2026-09-15").current, 0);
  assert.equal(streakStats(sessions, "2026-09-15").best, 2);
  assert.equal(
    streakStats([{ date: "2026-09-13", duration: 59 }], "2026-09-13").current,
    0,
  );
});
test("two-calendar-day unlock crosses month, year and leap boundaries", () => {
  assert.equal(shiftDate("2026-12-31", 2), "2027-01-02");
  assert.equal(shiftDate("2028-02-28", 2), "2028-03-01");
});
test("clients cannot backdate or submit fractional, oversized and empty entries", () => {
  const entry = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    content: "Read percentages",
    duration: 60,
  };
  assert.equal(entrySchema.safeParse(entry).success, true);
  for (const patch of [
    { date: "2026-01-01" },
    { duration: 1.5 },
    { duration: 721 },
    { duration: 0 },
    { content: "   " },
  ])
    assert.equal(entrySchema.safeParse({ ...entry, ...patch }).success, false);
});
test("pre-submit projection contains no explanations, answer or evidence", () => {
  const q = {
    stem: "What is half of one hundred?",
    options: ["50", "25", "75", "100"].map((text) => ({
      text,
      explanation: "An explanation of this option.",
    })),
    correct: 0,
    solution: "Half of 100 is 100 divided by 2, or 50.",
    sources: ["https://example.org/math"],
  };
  assert.equal(questionSchema.safeParse(q).success, true);
  assert.deepEqual(publicQuestions([q]), [
    { stem: q.stem, options: ["50", "25", "75", "100"] },
  ]);
  assert.equal(
    questionSchema.safeParse({
      ...q,
      options: [q.options[0], q.options[0], ...q.options.slice(2)],
    }).success,
    false,
  );
});
test("CSV handles quotes, Kannada, line breaks and spreadsheet injection", () => {
  const output = csv([{ content: 'ಓದು\n"quoted"', formula: " =SUM(A1)" }]);
  assert.ok(output.includes('ಓದು\n""quoted""'));
  assert.ok(output.includes("' =SUM(A1)"));
});
