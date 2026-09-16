"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { istDate, shiftDate, streakStats, Question } from "@/lib/domain";
import { authClient } from "@/lib/auth-client";
import { Mark } from "@/app/mark";
import { AuthIntro } from "@/app/auth/auth-intro";
import { AuthView } from "@neondatabase/auth-ui";
import { dailyHero } from "@/lib/daily-hero";
import { WeeklyRitual, WeeklyState } from "@/app/weekly-ritual";
import { weekLabel } from "@/lib/weekly-domain";
import { reportClientIssue } from "@/lib/client-observability";
import { DayLedger } from "@/app/day-ledger";
import { DayEntry } from "@/lib/day-ledger";
type Session = {
  id: string;
  date: string;
  duration: number;
  content: string;
  submittedAt: string;
  status: string;
};
type SetInfo = {
  id: string;
  topic: string;
  subject: string;
  studyDate: string;
  availableOn: string;
  count: number;
  status: string;
  locked: boolean;
};
type Data = {
  today: string;
  displayName: string;
  email: string;
  recallVisible: boolean;
  sessions: Session[];
  sets: SetInfo[];
  attempts: { id: string; setId: string; score: number; count: number }[];
  dayEntries: DayEntry[];
  weekly: WeeklyState;
};
type Quiz = {
  id: string;
  topic: string;
  questions: { stem: string; options: string[] }[];
};
type Review = { score: number; answers: number[]; questions: Question[] };
function label(d: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(d + "T12:00:00+05:30"));
}
export default function Home() {
  const [gate, setGate] = useState<"loading" | "setup" | "login" | "open">(
    "loading",
  );
  const [data, setData] = useState<Data>({
    today: istDate(),
    displayName: "",
    email: "",
    recallVisible: false,
    sessions: [],
    sets: [],
    attempts: [],
    dayEntries: [],
    weekly: {
      storageReady: false,
      currentWeekStart: "",
      planPending: false,
      currentGoals: [],
      pendingSummaries: [],
      reports: [],
      voiceNotes: [],
    },
  });
  const [tab, setTab] = useState<"today" | "history" | "quizzes">("today");
  const [content, setContent] = useState(""),
    [duration, setDuration] = useState(60);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedDate, setSelectedDate] = useState("");
  const [quiz, setQuiz] = useState<Quiz | null>(null),
    [answers, setAnswers] = useState<number[]>([]),
    [review, setReview] = useState<Review | null>(null);
  const [settings, setSettings] = useState(false),
    [legacy, setLegacy] = useState(false),
    [profileName, setProfileName] = useState("");
  const entryId = useRef<string | null>(null),
    studyField = useRef<HTMLTextAreaElement>(null),
    draftLoaded = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) setGate("login");
      throw new Error(result.error || "Please try again.");
    }
    return result;
  }, []);
  const reload = useCallback(async () => setData(await api("data")), [api]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("odhu-indhu-entry-draft");
      if (saved) {
        const draft = JSON.parse(saved);
        if (typeof draft.content === "string") setContent(draft.content);
        if (
          Number.isInteger(draft.duration) &&
          draft.duration >= 1 &&
          draft.duration <= 720
        )
          setDuration(draft.duration);
      }
    } catch {}
    draftLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      if (content)
        sessionStorage.setItem(
          "odhu-indhu-entry-draft",
          JSON.stringify({ content, duration }),
        );
      else sessionStorage.removeItem("odhu-indhu-entry-draft");
    } catch {}
  }, [content, duration]);
  useEffect(() => {
    const field = studyField.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = Math.min(field.scrollHeight, 320) + "px";
  }, [content]);
  useEffect(() => {
    let playOpening = false;
    try {
      playOpening =
        sessionStorage.getItem("odhu-indhu-opening-played") !== "1" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (playOpening) sessionStorage.setItem("odhu-indhu-opening-played", "1");
    } catch {}
    const opening = playOpening
      ? new Promise((resolve) => setTimeout(resolve, 2400))
      : Promise.resolve();
    Promise.all([api("status"), opening])
      .then(async ([state]) => {
        if (!state.configured) setGate("setup");
        else if (!state.authenticated) setGate("login");
        else {
          await reload();
          try {
            localStorage.setItem("odhu-indhu-has-entered", "1");
          } catch {}
          setGate("open");
        }
      })
      .catch(() => {
        setNotice("Unable to connect. Please refresh to try again.");
        setGate("login");
      });
    try {
      setLegacy(
        Boolean(
          localStorage.getItem("odhu-indhu-sessions") &&
          localStorage.getItem("odhu-indhu-sessions") !== "[]",
        ),
      );
    } catch {}
  }, [api, reload]);
  useEffect(() => {
    if (gate !== "open") return;
    const tick = () => {
      reload().catch(() => {});
      if (document.visibilityState === "visible")
        api("work", {}).catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [gate, api, reload]);
  useEffect(() => {
    if (settings) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settings]);
  useEffect(() => setProfileName(data.displayName), [data.displayName]);
  const stats = streakStats(data.sessions, data.today),
    todayEntries = data.sessions.filter((s) => s.date === data.today),
    available = data.sets.filter((s) => !s.locked && s.count > 0),
    hero = dailyHero(data.today);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    entryId.current ??= crypto.randomUUID();
    try {
      await api("entries", { id: entryId.current, content, duration });
      entryId.current = null;
      setContent("");
      setDuration(60);
      try {
        sessionStorage.removeItem("odhu-indhu-entry-draft");
      } catch {}
      await reload();
      setNotice("Entry sealed. A little more knowledge, kept.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start(set: SetInfo) {
    setBusy(true);
    try {
      const result = await api("quiz/start", { id: set.id });
      setQuiz(result);
      setAnswers(Array(result.questions.length).fill(-1));
      setReview(null);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    if (!quiz) return;
    setBusy(true);
    try {
      setReview(await api("quiz/submit", { id: quiz.id, answers }));
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    try {
      await api("retry", { id });
      setNotice("Recall preparation resumed.");
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("profile", { displayName: profileName });
      await reload();
      setNotice("Your name has been updated.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function downloadLegacy() {
    const url = URL.createObjectURL(
      new Blob([localStorage.getItem("odhu-indhu-sessions") || "[]"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "odhu-indhu-previous-ledger.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            setTab("today");
            setQuiz(null);
          }}
        >
          <Mark />
          <span>ODHU INDHU</span>
        </button>
        <div className="topMeta">
          <span>
            {gate === "open" && data.displayName
              ? `${data.displayName.toLocaleUpperCase("en-IN")}’S STUDY COMPANION`
              : "A PRIVATE STUDY COMPANION"}
          </span>
          {gate === "open" && (
            <button
              className="iconButton"
              onClick={() => setSettings(true)}
              aria-label="Open settings"
            >
              ☰
            </button>
          )}
        </div>
      </header>
      {gate === "login" ? (
        <section className="inlineAuth">
          <AuthIntro />
          <section className="authPanel">
            <AuthView
              path="sign-in"
              callbackURL="/auth/callback?redirectTo=/"
              redirectTo="/"
            />
          </section>
        </section>
      ) : gate === "loading" ? (
        <section className="ledgerLoading" aria-live="polite">
          <div>
            <div className="openingSequence" aria-hidden="true">
              {[1, 2, 3, 4].map((frame) => (
                <img
                  className={`openingFrame openingFrame${frame}`}
                  src={`/opening-ledger/frame-${frame}.png`}
                  alt=""
                  width="512"
                  height="512"
                  fetchPriority={frame === 1 ? "high" : "auto"}
                  key={frame}
                />
              ))}
            </div>
            <p role="status">Opening your ledger…</p>
          </div>
        </section>
      ) : gate === "setup" ? (
        <section className="welcome">
          <p className="eyebrow">ಓದು ಇಂದು · A LITTLE MORE, EVERY DAY</p>
          <h1>
            A quiet place
            <br />
            to <em>get there.</em>
          </h1>
          <p className="welcomeCopy">
            An hour of focus. A record of progress.
            <br />A little recall, when it matters.
          </p>
          <div className="setupCard">
            <p className="eyebrow">YOUR LEDGER IS ALMOST READY</p>
            <h2>
              Preparing your <em>space.</em>
            </h2>
            <p>
              Private access is being configured. Once it’s ready, you can start
              your first study streak here.
            </p>
          </div>
          {notice && (
            <p role="alert" className="notice">
              {notice}
            </p>
          )}
        </section>
      ) : gate === "open" ? (
        <>
          <WeeklyRitual
            weekly={data.weekly}
            onChanged={reload}
            onNotice={setNotice}
          />
          <section className="hero">
            <div>
              <p className="eyebrow">
                {label(data.today)} · INDIA STANDARD TIME
              </p>
              <h1>
                {hero.lead}
                <br />
                <em>{hero.accent}</em>
              </h1>
              <p className="heroCopy">{hero.support}</p>
            </div>
            <div className="streakStamp">
              <span className="stampLabel">CURRENT STREAK</span>
              <strong>{String(stats.current).padStart(2, "0")}</strong>
              <span className="stampUnit">DAYS IN A ROW</span>
            </div>
          </section>
          <div className="metricStrip">
            <span>
              <b>{stats.best}</b> BEST STREAK
            </span>
            <span>
              <b>
                {Math.floor(
                  data.sessions.reduce((n, s) => n + s.duration, 0) / 60,
                )}
                h
              </b>{" "}
              TOTAL STUDY
            </span>
            {data.recallVisible && (
              <span>
                <b>{available.length}</b> TOPICS TO RECALL
              </span>
            )}
          </div>
          <nav className="tabs" aria-label="Main navigation">
            {(data.recallVisible
              ? (["today", "history", "quizzes"] as const)
              : (["today", "history"] as const)
            ).map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "active" : ""}
                onClick={() => {
                  setTab(t);
                  setQuiz(null);
                  setNotice("");
                }}
              >
                {t === "today"
                  ? "01 / TODAY"
                  : t === "history"
                    ? "02 / THE LEDGER"
                    : "03 / RECALL"}
                {t === "quizzes" && available.length > 0 && (
                  <span className="badge">{available.length}</span>
                )}
              </button>
            ))}
          </nav>
          {notice && (
            <p className="notice banner" role="status">
              {notice}
            </p>
          )}
          {tab === "today" && (
            <>
              <section className="progressPanel">
                <div className="sectionHead">
                  <div>
                    <p className="eyebrow">TODAY’S COMMITMENT</p>
                    <h2>
                      {stats.total}
                      <small> / 60 MINUTES</small>
                    </h2>
                  </div>
                  <span
                    className={
                      "status " + (stats.total >= 60 ? "statusGood" : "")
                    }
                  >
                    {stats.total >= 60
                      ? "✓ DAY COMPLETE"
                      : `${60 - stats.total} MIN TO GO`}
                  </span>
                </div>
                <div
                  className="progressTrack"
                  role="progressbar"
                  aria-label="Daily study target"
                  aria-valuenow={Math.min(stats.total, 60)}
                  aria-valuemin={0}
                  aria-valuemax={60}
                >
                  <span
                    style={{
                      width: Math.min(100, (stats.total / 60) * 100) + "%",
                    }}
                  />
                </div>
                <p className="microcopy">
                  Small sessions add up. Today closes at midnight IST.
                </p>
              </section>
              <DayLedger
                today={data.today}
                entries={data.dayEntries || []}
                onNotice={setNotice}
                onSave={async (entry) => {
                  await api("day-entries", entry);
                  await reload();
                }}
              />
              <form className="entryForm" onSubmit={submit}>
                <div className="formHeader">
                  <span className="eyebrow">QUICK STUDY ENTRY</span>
                  <span className="entryDate">{data.today}</span>
                </div>
                <label htmlFor="study">WHAT DID YOU STUDY?</label>
                <textarea
                  id="study"
                  ref={studyField}
                  required
                  minLength={3}
                  maxLength={12000}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    entryId.current = null;
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Percentages: successive changes and 20 profit & loss problems. Revised fundamental rights…"
                  rows={4}
                />
                <div className="entryAssist" aria-live="polite">
                  <span>{content.length.toLocaleString("en-IN")} / 12,000</span>
                  <span>⌘ / CTRL + ENTER TO SEAL</span>
                </div>
                <div className="formFooter">
                  <div className="durationBlock">
                    <label className="duration" htmlFor="duration">
                      TIME SPENT{" "}
                      <span>
                        <input
                          id="duration"
                          type="number"
                          required
                          min={1}
                          max={720}
                          step={1}
                          value={duration}
                          onChange={(e) => {
                            setDuration(Number(e.target.value));
                            entryId.current = null;
                          }}
                        />{" "}
                        MIN
                      </span>
                    </label>
                    <div
                      className="durationPresets"
                      aria-label="Quick duration"
                    >
                      {[30, 45, 60, 90, 120].map((minutes) => (
                        <button
                          type="button"
                          key={minutes}
                          aria-pressed={duration === minutes}
                          onClick={() => {
                            setDuration(minutes);
                            entryId.current = null;
                          }}
                        >
                          {minutes}m
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className="primaryButton"
                    disabled={
                      busy ||
                      content.trim().length < 3 ||
                      duration < 1 ||
                      duration > 720
                    }
                  >
                    {busy ? "SAVING…" : "SEAL ENTRY ↗"}
                  </button>
                </div>
                <p className="microcopy">
                  Check your note before sealing. Saved entries stay as you
                  wrote them.
                </p>
              </form>
              <section className="sessionList">
                <div className="sectionHead">
                  <p className="eyebrow">TODAY’S SESSIONS</p>
                  <span className="count">
                    {String(todayEntries.length).padStart(2, "0")}
                  </span>
                </div>
                {!todayEntries.length ? (
                  <p className="empty">
                    Your first line starts here. Make it count.
                  </p>
                ) : (
                  todayEntries.map((s) => (
                    <article key={s.id} className="sessionRow">
                      <time dateTime={s.submittedAt}>
                        {new Intl.DateTimeFormat("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Kolkata",
                        }).format(new Date(s.submittedAt))}
                      </time>
                      <div>
                        <p>{s.content}</p>
                        <small className="processingText">
                          {s.status === "ready"
                            ? "Recall prepared"
                            : s.status === "failed"
                              ? "Recall needs another try"
                              : "Preparing your recall…"}
                          {s.status === "failed" && (
                            <button
                              disabled={busy}
                              className="textButton"
                              onClick={() => retry(s.id)}
                            >
                              Retry
                            </button>
                          )}
                        </small>
                      </div>
                      <span className="sessionMinutes">{s.duration}m</span>
                    </article>
                  ))
                )}
              </section>
            </>
          )}
          {tab === "history" && (
            <section className="history">
              <div className="sectionHead">
                <div>
                  <p className="eyebrow">THE LAST FOUR WEEKS</p>
                  <h2>
                    Proof you <em>showed up.</em>
                  </h2>
                </div>
              </div>
              <div className="dayGrid">
                {Array.from({ length: 28 }, (_, i) =>
                  shiftDate(data.today, i - 27),
                ).map((date) => (
                  <button
                    key={date}
                    className={
                      "day " +
                      ((stats.totals[date] || 0) >= 60
                        ? "qualified"
                        : stats.totals[date]
                          ? "partial"
                          : "") +
                      (selectedDate === date ? " selected" : "")
                    }
                    aria-label={`${label(date)}: ${stats.totals[date] || 0} minutes`}
                    onClick={() => setSelectedDate(date)}
                  >
                    <span>{date.slice(-2)}</span>
                    <small>
                      {stats.totals[date] ? stats.totals[date] + "m" : "·"}
                    </small>
                  </button>
                ))}
              </div>
              <p className="microcopy">
                Red marks an hour kept. Select a day to open its pages.
              </p>
              <div className="historyEntries">
                <p className="eyebrow">
                  {selectedDate ? label(selectedDate) : "ALL ENTRIES"}
                </p>
                {data.sessions
                  .filter((s) => !selectedDate || s.date === selectedDate)
                  .map((s) => (
                    <article className="sessionRow" key={s.id}>
                      <time>{label(s.date)}</time>
                      <p>{s.content}</p>
                      <span className="sessionMinutes">{s.duration}m</span>
                    </article>
                  ))}
                {!data.sessions.filter(
                  (s) => !selectedDate || s.date === selectedDate,
                ).length && (
                  <p className="empty">No entries on these pages yet.</p>
                )}
              </div>
            </section>
          )}
          {data.recallVisible && tab === "quizzes" && (
            <section className="quizzes">
              {!quiz ? (
                <>
                  <div className="sectionHead">
                    <div>
                      <p className="eyebrow">LET IT SETTLE. THEN RECALL.</p>
                      <h2>
                        What stayed <em>with you?</em>
                      </h2>
                    </div>
                  </div>
                  <p className="microcopy">
                    Each topic opens two mornings after you study it. No timer.
                    Just you and what you remember.
                  </p>
                  {!data.sets.length && (
                    <div className="recallEmpty">
                      <span className="largeSymbol">↺</span>
                      <h3>A little distance makes room for recall.</h3>
                      <p>
                        Log your first study session. Your topic quizzes will
                        find their way here.
                      </p>
                    </div>
                  )}
                  {data.sets.map((set) => {
                    const last = data.attempts.find((a) => a.setId === set.id);
                    return (
                      <article
                        className={"quizCard " + (set.locked ? "locked" : "")}
                        key={set.id}
                      >
                        <div>
                          <span className="quizNumber">
                            {set.locked
                              ? "IN THE MAKING"
                              : set.subject.toUpperCase()}
                          </span>
                          <h3>{set.topic}</h3>
                          <p>
                            {set.locked
                              ? `Opens ${label(set.availableOn)}`
                              : `${set.count} questions · Studied ${label(set.studyDate)}`}
                            {last &&
                              ` · Last score ${last.score}/${last.count}`}
                          </p>
                        </div>
                        {set.locked ? (
                          <span className="lock">LOCKED</span>
                        ) : set.count > 0 ? (
                          <button
                            className="outlineButton"
                            disabled={busy}
                            onClick={() => start(set)}
                          >
                            {last ? "REVISIT" : "BEGIN"} ↗
                          </button>
                        ) : (
                          <span className="lock">PREPARING</span>
                        )}
                      </article>
                    );
                  })}
                </>
              ) : (
                <>
                  <button
                    className="textButton"
                    onClick={() => {
                      setQuiz(null);
                      setReview(null);
                    }}
                  >
                    ← Back to topics
                  </button>
                  <h2 className="quizTitle">{quiz.topic}</h2>
                  {review ? (
                    <>
                      <div className="scorePanel">
                        <p className="eyebrow">RECALL COMPLETE</p>
                        <strong>
                          {review.score}
                          <small> / {review.questions.length}</small>
                        </strong>
                        <p>
                          {review.score === review.questions.length
                            ? "Every answer held. Well studied."
                            : "Every gap is a useful place to return to."}
                        </p>
                      </div>
                      {review.questions.map((q, i) => (
                        <article className="question review" key={i}>
                          <p className="eyebrow">
                            {String(i + 1).padStart(2, "0")} /{" "}
                            {review.answers[i] === q.correct
                              ? "CORRECT"
                              : review.answers[i] === -1
                                ? "SKIPPED"
                                : "INCORRECT"}
                          </p>
                          <h3>{q.stem}</h3>
                          <p className="solution">{q.solution}</p>
                          {q.options.map((o, j) => (
                            <div
                              className={
                                "optionReview " +
                                (j === q.correct ? "correct" : "")
                              }
                              key={j}
                            >
                              <b>
                                {"ABCD"[j]} / {o.text}{" "}
                                {j === q.correct ? "✓" : ""}
                                {review.answers[i] === j
                                  ? " · Your answer"
                                  : ""}
                              </b>
                              <p>{o.explanation}</p>
                            </div>
                          ))}
                          <div className="sources">
                            {q.sources.map((url, j) => (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source {j + 1} ↗
                              </a>
                            ))}
                          </div>
                        </article>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="microcopy">
                        Choose your answers, then submit to reveal the
                        explanations. Unanswered questions count as skipped.
                      </p>
                      {quiz.questions.map((q, i) => (
                        <fieldset className="question" key={i}>
                          <legend>
                            {String(i + 1).padStart(2, "0")} / {q.stem}
                          </legend>
                          {q.options.map((text, j) => (
                            <label
                              className={
                                "answerOption " +
                                (answers[i] === j ? "chosen" : "")
                              }
                              key={j}
                            >
                              <input
                                type="radio"
                                name={"q" + i}
                                checked={answers[i] === j}
                                onChange={() =>
                                  setAnswers((current) =>
                                    current.map((a, index) =>
                                      index === i ? j : a,
                                    ),
                                  )
                                }
                              />
                              <span className="optionLetter">{"ABCD"[j]}</span>
                              {text}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <div className="quizSubmit">
                        <p>
                          {answers.filter((a) => a !== -1).length} of{" "}
                          {answers.length} answered
                        </p>
                        <button
                          className="primaryButton"
                          disabled={busy}
                          onClick={finish}
                        >
                          {busy ? "SUBMITTING…" : "SUBMIT & REVIEW ↗"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          )}
          {data.weekly.currentGoals.length > 0 && (
            <details className="weeklyGoals">
              <summary>
                <span>
                  <small className="eyebrow">THIS WEEK’S INTENTIONS</small>
                  <strong>
                    {data.weekly.currentGoals.length} goal
                    {data.weekly.currentGoals.length === 1 ? "" : "s"}, quietly
                    in view.
                  </strong>
                </span>
                <b aria-hidden="true">OPEN +</b>
              </summary>
              <div className="weeklyGoalList">
                {data.weekly.currentGoals.map((goal, index) => (
                  <article key={`${goal.title}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>{goal.category || "STUDY"}</small>
                      <h3>{goal.title}</h3>
                      {goal.target && <p>{goal.target}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </details>
          )}
          <dialog
            ref={dialog}
            className="modal"
            onCancel={() => setSettings(false)}
          >
            <button
              className="close"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              ×
            </button>
            <p className="eyebrow">YOUR SPACE</p>
            <h2>
              Your name. Your <em>record.</em>
            </h2>
            <form className="profileForm" onSubmit={saveProfile}>
              <label htmlFor="profile-name">DISPLAY NAME</label>
              <div>
                <input
                  id="profile-name"
                  value={profileName}
                  minLength={1}
                  maxLength={60}
                  required
                  onChange={(event) => setProfileName(event.target.value)}
                />
                <button
                  className="outlineButton"
                  disabled={busy || profileName.trim() === data.displayName}
                >
                  SAVE
                </button>
              </div>
              {data.email && <small>{data.email}</small>}
            </form>
            {(data.weekly.reports.length > 0 ||
              data.weekly.voiceNotes.length > 0) && (
              <section className="weeklyArchive">
                <p className="eyebrow">YOUR WEEKS</p>
                {data.weekly.reports.map((report) => (
                  <a
                    className="archiveReport"
                    href={`/api/weekly/report?id=${encodeURIComponent(report.id)}`}
                    onClick={() =>
                      window.setTimeout(() => reload().catch(() => {}), 1000)
                    }
                    key={report.id}
                  >
                    <span>
                      <b>WEEKLY PDF</b>
                      {weekLabel(report.weekStart)}
                    </span>
                    <strong>PDF ↓</strong>
                  </a>
                ))}
                {data.weekly.voiceNotes.map((note) => (
                  <article className="archiveVoice" key={note.id}>
                    <div>
                      <b>
                        {note.kind === "plan"
                          ? "WEEKLY INTENTION"
                          : "WEEKLY REFLECTION"}
                      </b>
                      <span>{weekLabel(note.weekStart)}</span>
                    </div>
                    <audio
                      controls
                      preload="none"
                      src={`/api/weekly/voice?id=${encodeURIComponent(note.id)}`}
                      onError={() =>
                        reportClientIssue({
                          eventType: "voice.archive.playback_failed",
                          message: "Archived voice note could not be played",
                          errorCode: "MEDIA_PLAYBACK_ERROR",
                          metadata: {
                            kind: note.kind,
                            weekStart: note.weekStart,
                            noteId: note.id,
                          },
                        })
                      }
                    >
                      Your browser cannot play this voice note.
                    </audio>
                  </article>
                ))}
              </section>
            )}
            <p className="modalCopy">
              Download your study records anytime. Question exports include
              completed topics.
            </p>
            <div className="exportLinks">
              {["raw", "day-ledger", "topics", "questions", "attempts"].map(
                (type) => (
                  <a href={"/api/exports/" + type} key={type}>
                    {type === "raw"
                      ? "Study entries"
                      : type === "day-ledger"
                        ? "Day ledger"
                        : type.charAt(0).toUpperCase() + type.slice(1)}{" "}
                    <span>CSV ↓</span>
                  </a>
                ),
              )}
            </div>
            {legacy && (
              <button className="textButton" onClick={downloadLegacy}>
                Download entries from the previous browser ledger
              </button>
            )}
            <button
              className="outlineButton"
              onClick={async () => {
                try {
                  await authClient.signOut();
                  window.location.assign("/auth/sign-in");
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              SIGN OUT
            </button>
          </dialog>
        </>
      ) : null}
      <footer className="footer">
        <span>ಓದು ಇಂದು</span>
        <span>A LITTLE MORE, EVERY DAY.</span>
      </footer>
    </main>
  );
}
