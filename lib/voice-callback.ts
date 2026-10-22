import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export class InvalidVoiceCallbackError extends Error {}

/** Storage callbacks authenticate with their signature, without browser cookies. */
export async function handleVoiceUploadCallback(
  request: Request,
  body: HandleUploadBody,
  onUploadCompleted: NonNullable<
    Parameters<typeof handleUpload>[0]["onUploadCompleted"]
  >,
  token?: string,
) {
  if (
    body.type !== "blob.upload-completed" ||
    !/^[a-f0-9]{64}$/i.test(request.headers.get("x-vercel-signature") || "")
  )
    throw new InvalidVoiceCallbackError("Invalid upload callback.");
  try {
    return await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async () => {
        throw new InvalidVoiceCallbackError("Invalid upload callback.");
      },
      onUploadCompleted,
    });
  } catch (error) {
    if (error instanceof Error && /callback signature/i.test(error.message))
      throw new InvalidVoiceCallbackError("Invalid upload callback.");
    throw error;
  }
}
