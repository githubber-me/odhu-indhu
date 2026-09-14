export type StudyTopic = { topic: string; subject: string };

const NEWSPAPER_REFERENCE =
  /\b(?:newspaper|news\s*paper|daily\s+news|news\s+roundup)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function hasNewspaperReference(value: string) {
  return NEWSPAPER_REFERENCE.test(value);
}

function calendarDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  )
    return null;
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function explicitStudyDate(value: string) {
  const iso = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Numeric dates follow the Indian day/month/year convention used by the app.
  const numeric = value.match(
    /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})\b/,
  );
  if (numeric)
    return calendarDate(
      Number(numeric[3]),
      Number(numeric[2]),
      Number(numeric[1]),
    );

  const dayFirst = value.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*,?\s*(\d{4})\b/i,
  );
  if (dayFirst)
    return calendarDate(
      Number(dayFirst[3]),
      MONTHS[dayFirst[2].toLowerCase()],
      Number(dayFirst[1]),
    );

  const monthFirst = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*,?\s*(\d{4})\b/i,
  );
  if (monthFirst)
    return calendarDate(
      Number(monthFirst[3]),
      MONTHS[monthFirst[1].toLowerCase()],
      Number(monthFirst[2]),
    );

  return null;
}

function studyDateLabel(studyDate: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${studyDate}T12:00:00+05:30`));
}

export function dailyNewsTopic(studyDate: string): StudyTopic {
  return {
    topic: `News and current affairs for ${studyDateLabel(studyDate)}`,
    subject: "Current Affairs",
  };
}

export function isDailyNewsTopic(topic: string, subject: string) {
  return (
    subject.trim().toLowerCase() === "current affairs" &&
    topic.startsWith("News and current affairs for ")
  );
}

export function contextualizeStudyTopics(
  rawContent: string,
  studyDate: string,
  parsedTopics: StudyTopic[],
) {
  if (!hasNewspaperReference(rawContent)) return parsedTopics;

  const datedNews = dailyNewsTopic(explicitStudyDate(rawContent) ?? studyDate);
  let topics = parsedTopics.map((item) => {
    const topic = item.topic.trim().toLowerCase();
    const subject = item.subject.trim().toLowerCase();
    const isGenericNews =
      hasNewspaperReference(`${item.subject} ${item.topic}`) ||
      topic === "news" ||
      topic === "current affairs" ||
      (subject === "current affairs" && topic === "daily current affairs");
    return isGenericNews ? datedNews : item;
  });

  if (!topics.some((item) => isDailyNewsTopic(item.topic, item.subject))) {
    topics =
      topics.length >= 20
        ? [...topics.slice(0, 19), datedNews]
        : [...topics, datedNews];
  }

  const seen = new Set<string>();
  return topics
    .filter((item) => {
      const key = `${item.subject}:${item.topic}`.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

export function quizResearchRequest(
  topic: string,
  subject: string,
  studyDate: string,
  retrievedOn: string,
  explicitNewsDate?: string | null,
) {
  // The newspaper check also keeps queued entries created before the canonical
  // dated topic was introduced on the correct research path.
  const dailyNews =
    isDailyNewsTopic(topic, subject) || hasNewspaperReference(topic);
  if (dailyNews) {
    const newsDate = explicitNewsDate ?? explicitStudyDate(topic) ?? studyDate;
    return {
      dailyNews,
      newsDate,
      objective: `Authoritative evidence for news and current-affairs practice questions tied specifically to the newspaper date ${newsDate}. Find significant events that occurred on, or were prominently reported on, ${newsDate}, with useful coverage of India, Karnataka, and major international events. Use the newspaper date as the news window, not the research date ${retrievedOn}. Prefer primary sources and official releases, supported where needed by reputable reporting. Retain explicit publication and event dates, and do not include later developments as though they were known on the newspaper date.`,
      queries: [
        `${newsDate} India major news current affairs official`,
        `${newsDate} Karnataka major news current affairs`,
        `${newsDate} world major news current affairs`,
      ],
    };
  }

  const qualifiedTopic = `${subject} ${topic}`.trim();
  return {
    dailyNews,
    newsDate: null,
    objective:
      "Authoritative evidence for practice questions on " +
      qualifiedTopic +
      `. Research date: ${retrievedOn}. Prefer primary sources, government publications, established dictionaries, textbooks, and educational institutions. For current affairs, prioritize recent official sources and retain explicit event dates. Retrieve definitions, factual details, and worked examples appropriate to the studied material.`,
    queries: [
      qualifiedTopic + " authoritative reference",
      qualifiedTopic + " core concepts " + retrievedOn.slice(0, 4),
    ],
  };
}
