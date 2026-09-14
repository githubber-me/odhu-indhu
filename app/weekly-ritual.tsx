"use client";

import { upload } from "@vercel/blob/client";
import fixWebmDuration from "fix-webm-duration";
import { useEffect, useRef, useState } from "react";
import { weekLabel } from "@/lib/weekly-domain";
import { reportClientIssue } from "@/lib/client-observability";

export type WeeklyState = {
  storageReady: boolean;
  currentWeekStart: string;
  planPending: boolean;
  currentGoals: {
    title: string;
    category: string;
    target: string;
  }[];
  pendingSummaries: string[];
  reports: {
    id: string;
    weekStart: string;
    generatedAt: string;
    downloadedAt: string | null;
  }[];
  voiceNotes: {
    id: string;
    weekStart: string;
    kind: VoiceKind;
    uploadedAt: string;
  }[];
};

type VoiceKind = "plan" | "reflection";

function extension(type: string) {
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function VoiceTask({
  kind,
  weekStart,
  onChanged,
  onNotice,
  disabled,
}: {
  kind: VoiceKind;
  weekStart: string;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function toggleRecording() {
    if (recording) {
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      return;
    }
    if (starting) return;
    let media: MediaStream | null = null;
    try {
      setStarting(true);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new DOMException("Recording requires a secure browser connection.", "SecurityError");
      if (!("MediaRecorder" in window))
        throw new DOMException("This browser does not support audio recording.", "NotSupportedError");
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      media = acquired;
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm",
      ].find(
        (type) => window.MediaRecorder.isTypeSupported(type),
      );
      const next = new window.MediaRecorder(acquired, preferred ? { mimeType: preferred } : undefined);
      stream.current = acquired;
      chunks.current = [];
      setElapsed(0);
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      next.onstop = async () => {
        setRecording(false);
        setFinishing(true);
        const type = next.mimeType || "audio/webm";
        const durationMs = Math.max(1_000, performance.now() - startedAt.current);
        let blob = new Blob(chunks.current, { type });
        try {
          if (type.includes("webm"))
            blob = await fixWebmDuration(blob, durationMs, { logger: false });
          if (blob.size) {
            setRecordedSeconds(Math.max(1, Math.round(durationMs / 1_000)));
            setFile(new File([blob], `${kind}-${weekStart}.${extension(type)}`, { type }));
            onNotice("Recording ready. Listen back or seal it for the week.");
          } else {
            onNotice("The recording was empty. Please try once more.");
          }
        } catch (error) {
          reportClientIssue({
            eventType: "voice.preview.preparation_failed",
            message: "Recorded audio metadata could not be prepared",
            errorCode: error instanceof Error ? error.name : "DURATION_REPAIR_ERROR",
            metadata: { kind, weekStart, type, durationMs: Math.round(durationMs) },
          });
          if (blob.size) {
            setRecordedSeconds(Math.max(1, Math.round(durationMs / 1_000)));
            setFile(new File([blob], `${kind}-${weekStart}.${extension(type)}`, { type }));
            onNotice("Recording ready. Listen back or seal it for the week.");
          } else {
            onNotice("The recording was empty. Please try once more.");
          }
        } finally {
          setFinishing(false);
          recorder.current = null;
          stream.current = null;
          acquired.getTracks().forEach((track) => track.stop());
        }
      };
      next.onerror = () => {
        setRecording(false);
        onNotice("Recording stopped unexpectedly. Please try again or choose an audio file.");
        acquired.getTracks().forEach((track) => track.stop());
      };
      recorder.current = next;
      next.start(1000);
      startedAt.current = performance.now();
      setRecording(true);
    } catch (error) {
      media?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      recorder.current = null;
      reportClientIssue({
        eventType: "voice.microphone.unavailable",
        message: "Microphone access was not available",
        errorCode: error instanceof Error ? error.name : "MEDIA_ERROR",
        metadata: { kind, weekStart },
      });
      const name = error instanceof Error ? error.name : "";
      onNotice(
        name === "NotAllowedError"
          ? "Microphone permission is blocked. Allow it in your browser’s site settings, then try again."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one or choose an existing voice note."
            : error instanceof Error && error.message
              ? error.message
              : "Microphone access was not available. You can upload an existing voice note instead.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      reportClientIssue({
        eventType: "voice.upload.rejected",
        message: "Selected voice note exceeded the 25 MB limit",
        errorCode: "FILE_TOO_LARGE",
        metadata: { kind, weekStart, sizeBytes: file.size },
      });
      onNotice("Please choose a voice note smaller than 25 MB.");
      return;
    }
    setBusy(true);
    setProgress(0);
    const noteId = crypto.randomUUID();
    const payload = JSON.stringify({ noteId, weekStart, kind });
    let stage = "blob_upload";
    try {
      const blob = await upload(
        `weekly/${noteId}/${kind}-${weekStart}.${extension(file.type)}`,
        file,
        {
          access: "private",
          handleUploadUrl: "/api/weekly/upload",
          clientPayload: payload,
          onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
        },
      );
      stage = "upload_verification";
      const response = await fetch("/api/weekly/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noteId,
          weekStart,
          kind,
          url: blob.url,
          pathname: blob.pathname,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload could not be sealed.");
      setFile(null);
      onNotice("Voice note sealed for the week.");
      await onChanged();
    } catch (error) {
      reportClientIssue({
        eventType: "voice.upload.failed",
        message: "Voice note upload failed",
        errorCode: error instanceof Error ? error.name : "UPLOAD_ERROR",
        metadata: { kind, weekStart, stage },
      });
      onNotice(error instanceof Error ? error.message : "Voice note upload failed. Please try again.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  const planning = kind === "plan";
  return (
    <article className="weeklyAction weeklyVoiceAction">
      <div className="weeklyActionCopy">
        <p className="eyebrow">{planning ? "THIS WEEK’S INTENTION" : "CLOSE THE WEEK"}</p>
        <h2>{planning ? "What would you like to make possible?" : "How did the week really feel?"}</h2>
        <p>
          {planning
            ? "Talk freely about what you want to achieve, explore, revise, or understand. There is no format to follow."
            : "Talk freely about what went well, what did not, what surprised you, and what you want to carry forward."}
        </p>
        <span>{weekLabel(weekStart)}</span>
      </div>
      <div className="voiceControls">
        {!disabled && (
          <button className={recording ? "recordButton recording" : "recordButton"} disabled={starting || finishing} onClick={toggleRecording} type="button">
            <i aria-hidden="true" />
            {recording
              ? `STOP ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
              : finishing
                ? "PREPARING PLAYBACK…"
                : starting
                ? "OPENING MICROPHONE…"
                : "RECORD"}
          </button>
        )}
        {!recording && !finishing && !disabled && (
          <label className="voiceFileButton">
            <input
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm"
              onChange={(event) => {
                setRecordedSeconds(0);
                setFile(event.target.files?.[0] || null);
              }}
            />
            CHOOSE AUDIO
          </label>
        )}
        {file && !recording && (
          <div className="chosenVoice">
            <span>
              {file.name}
              {recordedSeconds > 0 &&
                ` · ${Math.floor(recordedSeconds / 60)}:${String(recordedSeconds % 60).padStart(2, "0")}`}
            </span>
            {previewUrl && (
              <audio
                controls
                preload="metadata"
                src={previewUrl}
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration) && duration > 0)
                    setRecordedSeconds(Math.max(1, Math.round(duration)));
                }}
              />
            )}
            <button className="primaryButton" disabled={busy || disabled} onClick={send} type="button">
              {busy ? `UPLOADING ${progress}%` : "SEAL VOICE NOTE ↗"}
            </button>
          </div>
        )}
        {disabled && <p className="storageNote">Connect a private Vercel Blob store to enable weekly voice notes.</p>}
        {!disabled && <small>PRIVATE VOICE NOTE · 25 MB MAXIMUM</small>}
      </div>
    </article>
  );
}

export function WeeklyRitual({
  weekly,
  onChanged,
  onNotice,
}: {
  weekly: WeeklyState;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [downloading, setDownloading] = useState("");

  async function downloadReport(id: string, weekStart: string) {
    setDownloading(id);
    try {
      const response = await fetch(`/api/weekly/report?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("The weekly report could not be downloaded.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `odhu-indhu-weekly-${weekStart}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      await onChanged();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The weekly report could not be downloaded.");
    } finally {
      setDownloading("");
    }
  }

  const readyReports = weekly.reports.filter((report) => !report.downloadedAt);
  if (!readyReports.length && !weekly.pendingSummaries.length && !weekly.planPending)
    return null;
  return (
    <section className="weeklyPriority" aria-label="Weekly priorities">
      {readyReports.map((report) => (
        <article className="weeklyAction weeklyReportAction" key={report.id}>
          <div className="weeklyActionCopy">
            <p className="eyebrow">YOUR WEEKLY LEDGER IS READY</p>
            <h2>A week, accounted for.</h2>
            <p>Your intentions, recorded work, rhythm, and next steps are ready in one permanent report.</p>
            <span>{weekLabel(report.weekStart)}</span>
          </div>
          <button className="primaryButton" disabled={downloading === report.id} onClick={() => downloadReport(report.id, report.weekStart)}>
            {downloading === report.id ? "PREPARING PDF…" : "DOWNLOAD PDF ↓"}
          </button>
        </article>
      ))}
      {weekly.pendingSummaries.map((weekStart) => (
        <VoiceTask
          kind="reflection"
          weekStart={weekStart}
          onChanged={onChanged}
          onNotice={onNotice}
          disabled={!weekly.storageReady}
          key={`reflection-${weekStart}`}
        />
      ))}
      {weekly.planPending && (
        <VoiceTask
          kind="plan"
          weekStart={weekly.currentWeekStart}
          onChanged={onChanged}
          onNotice={onNotice}
          disabled={!weekly.storageReady}
        />
      )}
    </section>
  );
}
