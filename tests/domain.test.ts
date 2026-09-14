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
import { DAILY_HEROES, dailyHero } from "../lib/daily-hero";
import {
  completedStudyDays,
  goalEvidence,
  startOfIstWeek,
} from "../lib/weekly-domain";
import {
  contextualizeStudyTopics,
  dailyNewsTopic,
  explicitStudyDate,
  quizResearchRequest,
} from "../lib/study-context";
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
test("weekly rituals use Monday through Sunday IST calendar weeks", () => {
  assert.equal(startOfIstWeek("2026-09-14"), "2026-09-14");
  assert.equal(startOfIstWeek("2026-09-20"), "2026-09-14");
  assert.equal(startOfIstWeek("2026-09-21"), "2026-09-21");
  assert.equal(startOfIstWeek("2027-01-01"), "2026-12-28");
});
test("weekly reflection opens only after two completed study days", () => {
  const sessions = [
    { date: "2026-09-14", duration: 30 },
    { date: "2026-09-14", duration: 30 },
    { date: "2026-09-15", duration: 59 },
    { date: "2026-09-20", duration: 60 },
    { date: "2026-09-21", duration: 90 },
  ];
  assert.equal(completedStudyDays(sessions, "2026-09-14"), 2);
  assert.equal(completedStudyDays(sessions, "2026-09-21"), 1);
});
test("weekly goal comparison is deterministic and evidence based", () => {
  const actual = [
    { subject: "Geography", topic: "Types of soils" },
    { subject: "Mathematics", topic: "Percentages" },
  ];
  assert.deepEqual(
    goalEvidence(
      { title: "Revise soil types", category: "Geography", target: "" },
      actual,
    ),
    { status: "achieved", evidence: ["Types of soils"] },
  );
  assert.deepEqual(
    goalEvidence(
      { title: "Read modern poetry", category: "Literature", target: "" },
      actual,
    ).status,
    "not observed",
  );
});
test("daily hero uses every line once before reshuffling", () => {
  assert.equal(DAILY_HEROES.length, 40);
  const firstCycle = Array.from({ length: 40 }, (_, index) =>
    dailyHero(shiftDate("2026-01-01", index)),
  );
  assert.equal(new Set(firstCycle).size, 40);
  assert.notEqual(firstCycle[39], dailyHero(shiftDate("2026-01-01", 40)));
  const longRun = Array.from({ length: 800 }, (_, index) =>
    dailyHero(shiftDate("2026-01-01", index)),
  );
  longRun.forEach((hero, index) => {
    if (index) assert.notEqual(hero, longRun[index - 1]);
  });
  assert.deepEqual(dailyHero("2026-09-13"), dailyHero("2026-09-13"));
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
test("newspaper study becomes date-specific current affairs", () => {
  assert.deepEqual(
    contextualizeStudyTopics("Read the newspaper", "2026-09-14", [
      { topic: "Newspaper", subject: "General" },
    ]),
    [dailyNewsTopic("2026-09-14")],
  );
});
test("an explicit newspaper date overrides the session date", () => {
  assert.deepEqual(
    contextualizeStudyTopics("Read 13/09/2026 newspaper", "2026-09-14", [
      { topic: "Newspaper", subject: "General" },
    ]),
    [dailyNewsTopic("2026-09-13")],
  );
  assert.deepEqual(
    contextualizeStudyTopics("Read 11/9/2026 news paper", "2026-09-14", [
      { topic: "News paper", subject: "General" },
    ]),
    [dailyNewsTopic("2026-09-11")],
  );
});
test("newspaper dates are strict and invalid dates fall back to context", () => {
  assert.equal(explicitStudyDate("31/02/2026 newspaper"), null);
  assert.equal(explicitStudyDate("2026-09-13 newspaper"), "2026-09-13");
  assert.equal(explicitStudyDate("13 September 2026 newspaper"), "2026-09-13");
  assert.equal(explicitStudyDate("September 13, 2026 newspaper"), "2026-09-13");
  assert.deepEqual(
    contextualizeStudyTopics("Read 31/02/2026 newspaper", "2026-09-14", []),
    [dailyNewsTopic("2026-09-14")],
  );
});
test("newspaper context keeps other topics and is added only once", () => {
  assert.deepEqual(
    contextualizeStudyTopics("Newspaper and percentages", "2026-09-14", [
      { topic: "Percentages", subject: "Mathematics" },
      { topic: "Current affairs", subject: "Current Affairs" },
      { topic: "Newspaper", subject: "Current Affairs" },
    ]),
    [
      { topic: "Percentages", subject: "Mathematics" },
      dailyNewsTopic("2026-09-14"),
    ],
  );
});
test("daily news research is anchored to the explicit newspaper date", () => {
  const request = quizResearchRequest(
    dailyNewsTopic("2026-09-13").topic,
    "Current Affairs",
    "2026-09-14",
    "2026-09-18",
  );
  assert.equal(request.dailyNews, true);
  assert.equal(request.newsDate, "2026-09-13");
  assert.ok(request.objective.includes("newspaper date 2026-09-13"));
  assert.ok(request.objective.includes("not the research date 2026-09-18"));
  assert.ok(request.queries.every((query) => query.includes("2026-09-13")));
  assert.equal(
    quizResearchRequest(
      dailyNewsTopic("2026-09-14").topic,
      "Current Affairs",
      "2026-09-14",
      "2026-09-18",
      "2026-09-11",
    ).newsDate,
    "2026-09-11",
  );
  assert.equal(
    quizResearchRequest("Newspaper", "General", "2026-09-14", "2026-09-18")
      .dailyNews,
    true,
  );
});
