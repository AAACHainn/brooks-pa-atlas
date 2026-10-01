import type { SubtitleCue } from "@/lib/knowledge-types";

const timestampPattern = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{2,3})$/;
const shortTimestampPattern = /^(\d{1,2}):(\d{2})[,.](\d{2,3})$/;

function fractionMs(value: string) {
  return Number(value.padEnd(3, "0"));
}

function timestampMs(value: string) {
  const trimmed = value.trim();
  const full = trimmed.match(timestampPattern);
  if (full) {
    return (((Number(full[1]) * 60 + Number(full[2])) * 60 + Number(full[3])) * 1000)
      + fractionMs(full[4]);
  }
  const short = trimmed.match(shortTimestampPattern);
  if (short) {
    return ((Number(short[1]) * 60 + Number(short[2])) * 1000) + fractionMs(short[3]);
  }
  throw new Error(`Invalid subtitle timestamp: ${value}`);
}

function cleanSubtitleText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeConsecutiveDuplicates(cues: SubtitleCue[]) {
  const result: SubtitleCue[] = [];
  for (const cue of cues) {
    const previous = result.at(-1);
    if (previous && previous.text === cue.text) {
      previous.endMs = cue.endMs ?? previous.endMs;
      continue;
    }
    result.push({ ...cue, id: result.length + 1 });
  }
  return result;
}

function parseTimedBlocks(text: string) {
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0].trim())) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEndWithSettings] = lines[timingIndex].split("-->");
    const rawEnd = rawEndWithSettings?.trim().split(/\s+/)[0];
    if (!rawStart || !rawEnd) continue;
    const cueText = cleanSubtitleText(lines.slice(timingIndex + 1).join("\n"));
    if (!cueText) continue;
    cues.push({
      id: cues.length + 1,
      startMs: timestampMs(rawStart),
      endMs: timestampMs(rawEnd),
      text: cueText,
    });
  }
  return removeConsecutiveDuplicates(cues);
}

function parseAss(text: string) {
  const lines = text.split("\n");
  let inEvents = false;
  let format: string[] = [];
  const cues: SubtitleCue[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Events\]$/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (inEvents && /^\[.+\]$/.test(trimmed)) break;
    if (!inEvents) continue;
    if (/^Format:/i.test(trimmed)) {
      format = trimmed.slice(trimmed.indexOf(":") + 1).split(",").map((part) => part.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(trimmed) || format.length === 0) continue;
    const body = trimmed.slice(trimmed.indexOf(":") + 1).trim();
    const values = body.split(",");
    if (values.length > format.length) {
      values.splice(format.length - 1, values.length - format.length + 1, values.slice(format.length - 1).join(","));
    }
    const row = new Map(format.map((field, index) => [field, values[index] ?? ""]));
    const cueText = cleanSubtitleText(row.get("text") ?? "");
    if (!cueText) continue;
    cues.push({
      id: cues.length + 1,
      startMs: timestampMs(row.get("start") ?? ""),
      endMs: timestampMs(row.get("end") ?? ""),
      text: cueText,
    });
  }
  return removeConsecutiveDuplicates(cues);
}

function parseText(text: string) {
  const chunks = text
    .split(/\n\s*\n|\n/)
    .map(cleanSubtitleText)
    .filter(Boolean);
  return removeConsecutiveDuplicates(chunks.map((value, index) => ({
    id: index + 1,
    startMs: null,
    endMs: null,
    text: value,
  })));
}

export function parseSubtitle(input: Buffer | string, fileName: string): SubtitleCue[] {
  const text = (Buffer.isBuffer(input) ? input.toString("utf8") : input)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) throw new Error("Subtitle file is empty.");

  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ".txt";
  const cues = extension === ".ass"
    ? parseAss(text)
    : extension === ".srt" || extension === ".vtt"
      ? parseTimedBlocks(text)
      : parseText(text);
  if (cues.length === 0) throw new Error("No subtitle cues were found.");
  return cues;
}

export function formatSubtitleTimestamp(value: number | null) {
  if (value === null) return null;
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
