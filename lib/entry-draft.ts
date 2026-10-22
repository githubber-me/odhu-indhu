export type EntryDraft = {
  content: string;
  duration: number;
  id: string | null;
};

export function entryDraftKey(userId: string) {
  return `odhu-indhu-entry-draft:${userId}`;
}

export function readEntryDraft(
  storage: Pick<Storage, "getItem">,
  userId: string,
): EntryDraft | null {
  try {
    const raw = storage.getItem(entryDraftKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      typeof value.content !== "string" ||
      value.content.length > 12000 ||
      !Number.isInteger(value.duration) ||
      value.duration < 1 ||
      value.duration > 720
    )
      return null;
    return {
      content: value.content,
      duration: value.duration,
      id:
        typeof value.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.id,
        )
          ? value.id
          : null,
    };
  } catch {
    return null;
  }
}

export function writeEntryDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  userId: string,
  draft: EntryDraft,
) {
  try {
    if (draft.content)
      storage.setItem(entryDraftKey(userId), JSON.stringify(draft));
    else storage.removeItem(entryDraftKey(userId));
  } catch {}
}
