"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  coveredMinutes,
  DAY_ACTIVITIES,
  DayActivity,
  DayEntry,
  dayEntryInterval,
  minuteLabel,
} from "@/lib/day-ledger";

type DayEntryPayload = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  activity: DayActivity;
  subject: string;
  topic: string;
  note: string;
  allowOverlap: boolean;
};

export function DayLedger({
  userId,
  today,
  entries,
  onSave,
  onNotice,
}: {
  userId: string;
  today: string;
  entries: DayEntry[];
  onSave: (entry: DayEntryPayload) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [activity, setActivity] = useState<DayActivity>("Study");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOverlap, setConfirmOverlap] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const entryId = useRef<string | null>(null);
  const submitting = useRef(false);
  const draftKey = `odhu-indhu-day-draft:${userId}`;
  const interval = dayEntryInterval(startTime, endTime);
  const selectedEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.date === date)
        .sort((a, b) => a.startMinute - b.startMinute),
    [date, entries],
  );
  const covered = coveredMinutes(selectedEntries);
  const isStudy = activity === "Study";

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved);
        if (
          typeof draft.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(draft.date) &&
          draft.date <= today
        )
          setDate(draft.date);
        if (
          typeof draft.startTime === "string" &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime)
        )
          setStartTime(draft.startTime);
        if (
          typeof draft.endTime === "string" &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime)
        )
          setEndTime(draft.endTime);
        if (DAY_ACTIVITIES.includes(draft.activity))
          setActivity(draft.activity);
        if (typeof draft.subject === "string")
          setSubject(draft.subject.slice(0, 100));
        if (typeof draft.topic === "string")
          setTopic(draft.topic.slice(0, 200));
        if (typeof draft.note === "string") setNote(draft.note.slice(0, 2000));
        if (
          typeof draft.id === "string" &&
          /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
            draft.id,
          )
        )
          entryId.current = draft.id;
      }
    } catch {}
    setDraftReady(true);
  }, [draftKey, today]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          id: entryId.current,
          date,
          startTime,
          endTime,
          activity,
          subject,
          topic,
          note,
        }),
      );
    } catch {}
  }, [
    draftReady,
    draftKey,
    date,
    startTime,
    endTime,
    activity,
    subject,
    topic,
    note,
    saving,
  ]);

  function changed() {
    entryId.current = null;
    setConfirmOverlap(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!interval || submitting.current || !draftReady) return;
    submitting.current = true;
    setSaving(true);
    onNotice("");
    entryId.current ??= crypto.randomUUID();
    try {
      await onSave({
        id: entryId.current,
        date,
        startTime,
        endTime,
        activity,
        subject,
        topic,
        note,
        allowOverlap: confirmOverlap,
      });
      entryId.current = null;
      setTopic("");
      setNote("");
      setConfirmOverlap(false);
      if (!isStudy) setSubject("");
      if (endTime === "00:00") {
        const next = new Date(`${date}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        setDate(
          next.toISOString().slice(0, 10) <= today
            ? next.toISOString().slice(0, 10)
            : today,
        );
        setStartTime("00:00");
        setEndTime("01:00");
      } else {
        setStartTime(endTime);
        const nextEnd = Math.min(interval.endMinute + 60, 24 * 60);
        setEndTime(nextEnd === 24 * 60 ? "00:00" : minuteLabel(nextEnd));
      }
      onNotice(
        isStudy
          ? "Study row sealed. It now counts toward your streak and recall."
          : "Day row sealed. Add the next line whenever you are ready.",
      );
    } catch (error) {
      const message = (error as Error).message;
      if (/overlap/i.test(message)) setConfirmOverlap(true);
      onNotice(message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="dayLedger" aria-labelledby="day-ledger-title">
      <div className="dayLedgerHeading">
        <div>
          <p className="eyebrow">YOUR DAY, LINE BY LINE</p>
          <h2 id="day-ledger-title">
            The full day. <em>Nothing missed.</em>
          </h2>
          <p>
            Log what actually happened. Study rows join your streak and recall;
            everything else stays as context for your day.
          </p>
        </div>
        <div
          className="dayCoverage"
          aria-label={`${covered} minutes accounted for`}
        >
          <strong>{Math.round((covered / 1440) * 100)}%</strong>
          <span>OF DAY ACCOUNTED</span>
        </div>
      </div>

      <form className="dayLedgerForm" onSubmit={submit}>
        <fieldset className="ledgerFields" disabled={saving || !draftReady}>
          <label>
            <span>DATE</span>
            <input
              type="date"
              required
              max={today}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                changed();
              }}
            />
          </label>
          <fieldset className="ledgerTime">
            <legend>TIME INTERVAL</legend>
            <label>
              <span>FROM</span>
              <input
                type="time"
                required
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  changed();
                }}
              />
            </label>
            <i aria-hidden="true">→</i>
            <label>
              <span>TO</span>
              <input
                type="time"
                required
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  changed();
                }}
              />
            </label>
          </fieldset>
          <label>
            <span>ACTIVITY</span>
            <select
              value={activity}
              onChange={(event) => {
                setActivity(event.target.value as DayActivity);
                changed();
              }}
            >
              {DAY_ACTIVITIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{isStudy ? "SUBJECT" : "AREA / SUBJECT"}</span>
            <input
              required={isStudy}
              maxLength={100}
              value={subject}
              placeholder={isStudy ? "Geography" : "Optional"}
              onChange={(event) => {
                setSubject(event.target.value);
                changed();
              }}
            />
          </label>
          <label>
            <span>{isStudy ? "TOPIC" : "WHAT?"}</span>
            <input
              required={isStudy}
              maxLength={200}
              value={topic}
              placeholder={isStudy ? "Types of soils" : "What were you doing?"}
              onChange={(event) => {
                setTopic(event.target.value);
                changed();
              }}
            />
          </label>
          <label className="ledgerNote">
            <span>EXTRA NOTE</span>
            <input
              maxLength={2000}
              value={note}
              placeholder="Anything worth remembering"
              onChange={(event) => {
                setNote(event.target.value);
                changed();
              }}
            />
          </label>
          <div className="ledgerSave">
            <span>{interval ? `${interval.duration} MIN` : "CHECK TIME"}</span>
            <button
              className={confirmOverlap ? "outlineButton" : "primaryButton"}
              disabled={
                saving ||
                !interval ||
                date > today ||
                (isStudy && (!subject.trim() || !topic.trim()))
              }
            >
              {saving
                ? "SAVING…"
                : confirmOverlap
                  ? "SAVE OVERLAP"
                  : "ADD ROW +"}
            </button>
          </div>
        </fieldset>
      </form>
      <p className="microcopy ledgerHelp">
        The day closes at midnight IST. Use 00:00 to close the final interval;
        split overnight activities across two dates. Overlaps require
        confirmation.
      </p>

      <div className="dayTimeline">
        <div className="dayTimelineHead">
          <span>{date}</span>
          <span>{covered} / 1,440 MIN ACCOUNTED</span>
        </div>
        <div className="dayCoverageTrack" aria-hidden="true">
          <span style={{ width: `${(covered / 1440) * 100}%` }} />
        </div>
        {!selectedEntries.length ? (
          <p className="empty">
            No lines for this day yet. Begin wherever the day began.
          </p>
        ) : (
          selectedEntries.map((entry, index) => (
            <article className="dayTimelineRow" key={entry.id}>
              <span className="dayRowNumber">
                {String(index + 1).padStart(2, "0")}
              </span>
              <time>
                {minuteLabel(entry.startMinute)}
                <b>→</b>
                {minuteLabel(entry.endMinute)}
              </time>
              <span className={`activityTag activity${entry.activity}`}>
                {entry.activity}
              </span>
              <div>
                <strong>
                  {[entry.subject, entry.topic].filter(Boolean).join(" / ") ||
                    entry.activity}
                </strong>
                {entry.note && <p>{entry.note}</p>}
              </div>
              <small>{entry.duration}m</small>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
