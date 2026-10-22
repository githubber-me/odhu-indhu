"use client";

import { upload } from "@vercel/blob/client";
import fixWebmDuration from "fix-webm-duration";
import { useEffect, useRef, useState } from "react";
import { weekLabel } from "@/lib/weekly-domain";
import { notifySessionChange } from "@/lib/auth-client";
import {
  MAX_VOICE_BYTES,
  validateVoiceFile,
  voiceContentType,
  voiceExtension,
} from "@/lib/voice";
import {
  reportClientEvent,
  reportClientIssue,
} from "@/lib/client-observability";

export type WeeklyState = {
  storageReady: boolean;
  processingReady?: boolean;
  uploadPrefix?: string;
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
    status?: "queued" | "transcribing" | "ready" | "failed";
    uploadedAt: string;
  }[];
};

type VoiceKind = "plan" | "reflection";

function VoiceTask({
  kind,
  weekStart,
  onChanged,
  onNotice,
  disabled,
  uploadPrefix,
  userId,
}: {
  kind: VoiceKind;
  weekStart: string;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  disabled: boolean;
  uploadPrefix?: string;
  userId: string;
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
  const mounted = useRef(true);
  const generation = useRef(0);
  const sending = useRef(false);
  const pendingUpload = useRef<{
    file: File;
    noteId: string;
    url: string;
    pathname: string;
  } | null>(null);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
    if (starting || finishing || sending.current) return;
    const currentGeneration = generation.current;
    let media: MediaStream | null = null;
    try {
      setStarting(true);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new DOMException(
          "Recording requires a secure browser connection.",
          "SecurityError",
        );
      if (!("MediaRecorder" in window))
        throw new DOMException(
          "This browser does not support audio recording.",
          "NotSupportedError",
        );
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      media = acquired;
      if (!mounted.current || generation.current !== currentGeneration) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm",
      ].find((type) => window.MediaRecorder.isTypeSupported(type));
      const next = new window.MediaRecorder(
        acquired,
        preferred ? { mimeType: preferred } : undefined,
      );
      stream.current = acquired;
      chunks.current = [];
      setElapsed(0);
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
        if (
          chunks.current.reduce((sum, chunk) => sum + chunk.size, 0) >=
            MAX_VOICE_BYTES - 1024 * 1024 &&
          next.state === "recording"
        )
          next.stop();
      };
      next.onstop = async () => {
        acquired.getTracks().forEach((track) => track.stop());
        if (!mounted.current || generation.current !== currentGeneration)
          return;
        setRecording(false);
        setFinishing(true);
        const type = next.mimeType || "audio/webm";
        const durationMs = Math.max(
          1_000,
          performance.now() - startedAt.current,
        );
        let blob = new Blob(chunks.current, { type });
        try {
          if (type.includes("webm"))
            blob = await fixWebmDuration(blob, durationMs, { logger: false });
          if (!mounted.current || generation.current !== currentGeneration)
            return;
          if (blob.size) {
            setRecordedSeconds(Math.max(1, Math.round(durationMs / 1_000)));
            setFile(
              new File([blob], `${kind}-${weekStart}.${voiceExtension(type)}`, {
                type,
              }),
            );
            pendingUpload.current = null;
            reportClientEvent({
              level: "info",
              eventType: "voice.recording.prepared",
              outcome: "success",
              message: "Voice recording prepared for playback",
              metadata: {
                kind,
                weekStart,
                type,
                durationMs: Math.round(durationMs),
                sizeBytes: blob.size,
              },
            });
            onNotice("Recording ready. Listen back or seal it for the week.");
          } else {
            reportClientIssue({
              eventType: "voice.recording.empty",
              message: "The browser produced an empty voice recording",
              errorCode: "EMPTY_RECORDING",
              metadata: { kind, weekStart, type },
            });
            onNotice("The recording was empty. Please try once more.");
          }
        } catch (error) {
          if (!mounted.current || generation.current !== currentGeneration)
            return;
          reportClientIssue({
            eventType: "voice.preview.preparation_failed",
            message: "Recorded audio metadata could not be prepared",
            errorCode:
              error instanceof Error ? error.name : "DURATION_REPAIR_ERROR",
            metadata: {
              kind,
              weekStart,
              type,
              durationMs: Math.round(durationMs),
            },
          });
          if (blob.size) {
            setRecordedSeconds(Math.max(1, Math.round(durationMs / 1_000)));
            setFile(
              new File([blob], `${kind}-${weekStart}.${voiceExtension(type)}`, {
                type,
              }),
            );
            pendingUpload.current = null;
            onNotice("Recording ready. Listen back or seal it for the week.");
          } else {
            reportClientIssue({
              eventType: "voice.recording.empty",
              message: "The browser produced an empty voice recording",
              errorCode: "EMPTY_RECORDING",
              metadata: { kind, weekStart, type },
            });
            onNotice("The recording was empty. Please try once more.");
          }
        } finally {
          if (mounted.current && generation.current === currentGeneration)
            setFinishing(false);
          if (recorder.current === next) {
            recorder.current = null;
            stream.current = null;
          }
          acquired.getTracks().forEach((track) => track.stop());
        }
      };
      next.onerror = (event) => {
        acquired.getTracks().forEach((track) => track.stop());
        if (!mounted.current || generation.current !== currentGeneration)
          return;
        setRecording(false);
        const mediaError =
          "error" in event && event.error instanceof DOMException
            ? event.error
            : null;
        reportClientIssue({
          eventType: "voice.recording.failed",
          message: "Voice recording stopped unexpectedly",
          errorCode: mediaError?.name || "MEDIA_RECORDER_ERROR",
          metadata: { kind, weekStart, type: next.mimeType || "unknown" },
        });
        onNotice(
          "Recording stopped unexpectedly. Please try again or choose an audio file.",
        );
        acquired.getTracks().forEach((track) => track.stop());
      };
      recorder.current = next;
      next.start(1000);
      startedAt.current = performance.now();
      setRecording(true);
    } catch (error) {
      media?.getTracks().forEach((track) => track.stop());
      if (!mounted.current || generation.current !== currentGeneration) return;
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
      if (mounted.current && generation.current === currentGeneration)
        setStarting(false);
    }
  }

  async function send() {
    if (!file || sending.current) return;
    const fileError = validateVoiceFile(file);
    if (fileError) {
      reportClientIssue({
        eventType: "voice.upload.rejected",
        message: "Selected voice note was rejected",
        errorCode: "INVALID_AUDIO_FILE",
        metadata: { kind, weekStart, sizeBytes: file.size },
      });
      onNotice(fileError);
      return;
    }
    if (!uploadPrefix) {
      onNotice(
        "Refresh the page to reconnect voice uploads. Your recording is still here.",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    setProgress(0);
    let stage = "blob_upload";
    try {
      let prepared =
        pendingUpload.current?.file === file ? pendingUpload.current : null;
      if (!prepared) {
        const noteId = crypto.randomUUID();
        const contentType = voiceContentType(file.type, file.name)!;
        const blob = await upload(
          `${uploadPrefix}/${noteId}/${kind}-${weekStart}.${voiceExtension(contentType)}`,
          file,
          {
            access: "private",
            contentType,
            multipart: file.size > 5 * 1024 * 1024,
            handleUploadUrl: "/api/weekly/upload",
            clientPayload: JSON.stringify({ noteId, weekStart, kind }),
            headers: { "x-account-id": userId },
            onUploadProgress: ({ percentage }) => {
              if (mounted.current) setProgress(Math.round(percentage));
            },
          },
        );
        prepared = { file, noteId, url: blob.url, pathname: blob.pathname };
        pendingUpload.current = prepared;
      }
      if (!mounted.current) return;
      stage = "upload_verification";
      setProgress(100);
      const response = await fetch("/api/weekly/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-account-id": userId },
        body: JSON.stringify({
          noteId: prepared.noteId,
          weekStart,
          kind,
          url: prepared.url,
          pathname: prepared.pathname,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401 || result.code === "ACCOUNT_CHANGED") {
        notifySessionChange();
        return;
      }
      if (!response.ok)
        throw new Error(result.error || "Upload could not be sealed.");
      if (!mounted.current) return;
      pendingUpload.current = null;
      setFile(null);
      onNotice("Voice note sealed for the week.");
      await onChanged().catch(() =>
        onNotice(
          "Voice note saved. The dashboard will refresh when the connection returns.",
        ),
      );
    } catch (error) {
      if (!mounted.current) return;
      reportClientIssue({
        eventType: "voice.upload.failed",
        message: "Voice note upload failed",
        errorCode: error instanceof Error ? error.name : "UPLOAD_ERROR",
        metadata: { kind, weekStart, stage },
      });
      onNotice(
        error instanceof Error
          ? error.message
          : "Voice note upload failed. Please try again.",
      );
      // The signed storage callback may have saved it even if the browser lost
      // its response. Refreshing reveals that successful save without reupload.
      void onChanged().catch(() => undefined);
    } finally {
      sending.current = false;
      if (mounted.current) {
        setBusy(false);
        setProgress(0);
      }
    }
  }

  const planning = kind === "plan";
  return (
    <article className="weeklyAction weeklyVoiceAction">
      <div className="weeklyActionCopy">
        <p className="eyebrow">
          {planning ? "THIS WEEK’S INTENTION" : "CLOSE THE WEEK"}
        </p>
        <h2>
          {planning
            ? "What would you like to make possible?"
            : "How did the week really feel?"}
        </h2>
        <p>
          {planning
            ? "Talk freely about what you want to achieve, explore, revise, or understand. There is no format to follow."
            : "Talk freely about what went well, what did not, what surprised you, and what you want to carry forward."}
        </p>
        <span>{weekLabel(weekStart)}</span>
      </div>
      <div className="voiceControls">
        {!disabled && (
          <button
            className={recording ? "recordButton recording" : "recordButton"}
            disabled={starting || finishing || busy}
            onClick={toggleRecording}
            type="button"
          >
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
        {!recording && !starting && !finishing && !disabled && (
          <label className="voiceFileButton">
            <input
              type="file"
              accept="audio/*,.aac,.flac,.m4a,.mp3,.wav,.ogg,.webm"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = "";
                if (!selected) return;
                const error = validateVoiceFile(selected);
                if (error) {
                  onNotice(error);
                  return;
                }
                setRecordedSeconds(0);
                pendingUpload.current = null;
                setFile(selected);
              }}
            />
            CHOOSE AUDIO
          </label>
        )}
        {file && !recording && !starting && !finishing && (
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
                onPlay={() =>
                  reportClientEvent({
                    level: "info",
                    eventType: "voice.preview.played",
                    outcome: "success",
                    message: "Local voice-note preview played",
                    metadata: { kind, weekStart, type: file.type },
                  })
                }
                onError={() =>
                  reportClientIssue({
                    eventType: "voice.preview.playback_failed",
                    message: "Local voice-note preview could not be played",
                    errorCode: "MEDIA_PLAYBACK_ERROR",
                    metadata: { kind, weekStart, type: file.type },
                  })
                }
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration) && duration > 0)
                    setRecordedSeconds(Math.max(1, Math.round(duration)));
                }}
              />
            )}
            <button
              className="primaryButton"
              disabled={busy || disabled}
              onClick={send}
              type="button"
            >
              {busy
                ? progress >= 100
                  ? "SAVING VOICE NOTE…"
                  : `UPLOADING ${progress}%`
                : pendingUpload.current
                  ? "RETRY SAVE ↗"
                  : "SEAL VOICE NOTE ↗"}
            </button>
            <button
              className="voiceFileButton"
              disabled={busy}
              onClick={() => {
                pendingUpload.current = null;
                setFile(null);
                setRecordedSeconds(0);
              }}
              type="button"
            >
              DISCARD RECORDING
            </button>
          </div>
        )}
        {disabled && (
          <p className="storageNote">
            Connect a private Vercel Blob store to enable weekly voice notes.
          </p>
        )}
        {!disabled && <small>PRIVATE VOICE NOTE · 25 MB MAXIMUM</small>}
      </div>
    </article>
  );
}

export function WeeklyRitual({
  userId,
  weekly,
  onChanged,
  onNotice,
}: {
  userId: string;
  weekly: WeeklyState;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [downloading, setDownloading] = useState("");
  const [retrying, setRetrying] = useState("");

  async function retryVoice(id: string) {
    if (retrying) return;
    setRetrying(id);
    try {
      const response = await fetch("/api/weekly/retry", {
        method: "POST",
        headers: { "content-type": "application/json", "x-account-id": userId },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (response.status === 401 || result.code === "ACCOUNT_CHANGED") {
        notifySessionChange();
        return;
      }
      if (!response.ok)
        throw new Error(result.error || "Voice processing could not restart.");
      onNotice("Your recording is saved. Voice processing has restarted.");
      await onChanged();
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Voice processing could not restart.",
      );
    } finally {
      setRetrying("");
    }
  }

  async function downloadReport(id: string, weekStart: string) {
    setDownloading(id);
    let stage = "report_request";
    try {
      const response = await fetch(
        `/api/weekly/report?id=${encodeURIComponent(id)}`,
      );
      if (!response.ok)
        throw new Error("The weekly report could not be downloaded.");
      stage = "browser_download";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `odhu-indhu-weekly-${weekStart}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      await onChanged();
    } catch (error) {
      reportClientIssue({
        eventType: "weekly.report.download_failed",
        message: "Weekly report could not be downloaded",
        errorCode: error instanceof Error ? error.name : "DOWNLOAD_ERROR",
        metadata: { reportId: id, weekStart, stage },
      });
      onNotice(
        error instanceof Error
          ? error.message
          : "The weekly report could not be downloaded.",
      );
    } finally {
      setDownloading("");
    }
  }

  const readyReports = weekly.reports.filter((report) => !report.downloadedAt);
  const processingNotes = weekly.voiceNotes.filter(
    (note) => note.status && note.status !== "ready",
  );
  if (
    !readyReports.length &&
    !weekly.pendingSummaries.length &&
    !weekly.planPending &&
    !processingNotes.length
  )
    return null;
  return (
    <section className="weeklyPriority" aria-label="Weekly priorities">
      {readyReports.map((report) => (
        <article className="weeklyAction weeklyReportAction" key={report.id}>
          <div className="weeklyActionCopy">
            <p className="eyebrow">YOUR WEEKLY LEDGER IS READY</p>
            <h2>A week, accounted for.</h2>
            <p>
              Your intentions, recorded work, rhythm, and next steps are ready
              in one permanent report.
            </p>
            <span>{weekLabel(report.weekStart)}</span>
          </div>
          <button
            className="primaryButton"
            disabled={downloading === report.id}
            onClick={() => downloadReport(report.id, report.weekStart)}
          >
            {downloading === report.id ? "PREPARING PDF…" : "DOWNLOAD PDF ↓"}
          </button>
        </article>
      ))}
      {processingNotes.map((note) => (
        <article className="weeklyAction" key={note.id}>
          <div className="weeklyActionCopy">
            <p className="eyebrow">
              {note.kind === "plan" ? "WEEKLY INTENTION" : "WEEKLY REFLECTION"}{" "}
              · SAVED
            </p>
            <h2>
              {note.status === "failed"
                ? "Your recording is safe. Processing needs another try."
                : "Your voice note is being prepared."}
            </h2>
            <p>
              {weekly.processingReady === false
                ? "Your private recording is saved. Transcription will begin when voice processing is connected."
                : note.status === "failed"
                  ? "Retry using the recording already saved. You do not need to record or upload it again."
                  : "You can keep using your ledger while we transcribe this recording and prepare your weekly notes."}
            </p>
            <span>{weekLabel(note.weekStart)}</span>
          </div>
          {note.status === "failed" && weekly.processingReady !== false && (
            <button
              className="primaryButton"
              disabled={Boolean(retrying)}
              onClick={() => retryVoice(note.id)}
              type="button"
            >
              {retrying === note.id ? "RESTARTING…" : "RETRY PROCESSING ↗"}
            </button>
          )}
        </article>
      ))}
      {weekly.pendingSummaries.map((weekStart) => (
        <VoiceTask
          userId={userId}
          kind="reflection"
          weekStart={weekStart}
          onChanged={onChanged}
          onNotice={onNotice}
          disabled={!weekly.storageReady}
          uploadPrefix={weekly.uploadPrefix}
          key={`reflection-${weekStart}`}
        />
      ))}
      {weekly.planPending && (
        <VoiceTask
          userId={userId}
          kind="plan"
          weekStart={weekly.currentWeekStart}
          onChanged={onChanged}
          onNotice={onNotice}
          disabled={!weekly.storageReady}
          uploadPrefix={weekly.uploadPrefix}
          key={`plan-${weekly.currentWeekStart}`}
        />
      )}
    </section>
  );
}
