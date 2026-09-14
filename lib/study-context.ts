export type StudyTopic = { topic: string; subject: string };

const NEWSPAPER_REFERENCE =
  /\b(?:newspaper|news\s*paper|daily\s+news|news\s+roundup)\b/i;

export function hasNewspaperReference(value: string) {
  return NEWSPAPER_REFERENCE.test(value);
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

  const datedNews = dailyNewsTopic(studyDate);
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
) {
  // The newspaper check also keeps queued entries created before the canonical
  // dated topic was introduced on the correct research path.
  const dailyNews =
    isDailyNewsTopic(topic, subject) || hasNewspaperReference(topic);
  if (dailyNews) {
    return {
      dailyNews,
      objective: `Authoritative evidence for news and current-affairs practice questions tied specifically to the study date ${studyDate}. Find significant events that occurred on, or were prominently reported on, ${studyDate}, with useful coverage of India, Karnataka, and major international events. Use the study date as the news window, not the research date ${retrievedOn}. Prefer primary sources and official releases, supported where needed by reputable reporting. Retain explicit publication and event dates, and do not include later developments as though they were known on the study date.`,
      queries: [
        `${studyDate} India major news current affairs official`,
        `${studyDate} Karnataka major news current affairs`,
        `${studyDate} world major news current affairs`,
      ],
    };
  }

  const qualifiedTopic = `${subject} ${topic}`.trim();
  return {
    dailyNews,
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
