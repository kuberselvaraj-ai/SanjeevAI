/**
 * ElevenLabs — best-in-class voices for the US market.
 * TTS: POST /v1/text-to-speech/{voice_id} (model eleven_flash_v2_5).
 * ASR: POST /v1/speech-to-text (Scribe v2, multipart).
 * Key lives in server env (ELEVENLABS_API_KEY) — never sent to browsers.
 */

const ROOT = "https://api.elevenlabs.io";
const TTS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — premade, American English
const TTS_MODEL = "eleven_flash_v2_5";
const ASR_MODEL = "scribe_v2";

export function elevenlabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export async function elevenTranscribe(file: File): Promise<string> {
  const form = new FormData();
  form.append("model_id", ASR_MODEL);
  form.append("file", file, file.name || "audio.webm");
  const res = await fetch(`${ROOT}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    detail?: { message?: string } | string;
  };
  if (!res.ok || data.text === undefined) {
    const detail =
      typeof data.detail === "string" ? data.detail : data.detail?.message;
    throw new Error(detail || `ElevenLabs API error ${res.status}`);
  }
  return data.text;
}

export async function elevenSpeak(text: string): Promise<Buffer> {
  const res = await fetch(`${ROOT}/v1/text-to-speech/${TTS_VOICE_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
    },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      detail?: { message?: string } | string;
    };
    const detail =
      typeof data.detail === "string" ? data.detail : data.detail?.message;
    throw new Error(detail || `ElevenLabs API error ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
