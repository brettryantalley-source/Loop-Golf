/*
 * notes.js — round notes (v22.17): a line of text Brett jots on a hole or a shot ("pin tucked
 * behind the left bunker", "wind swirls on this tee"), with where and when.
 *
 * Storage is INJECTED, as in shotlog.js: every persisting function takes a `storage` shaped like
 * localStorage (`getItem` / `setItem`). One key, in the `bogeyman-matches:*` namespace (Brett's
 * Sep 28 decision: no `loop.*` keys):
 *   `bogeyman-matches:notes:v1`   one array of Note objects, oldest first
 *
 * A Note: { id, schema 1, roundId, courseId, hole, shotNo, text, gps { lat, lng, accuracyM } | null,
 *           t (ISO time) }. hole / shotNo / courseId may be null (a round-level note).
 *
 * Pure apart from the injected storage. Unreadable storage reads as no notes; a failed write throws
 * to the caller (as saveShot does).
 */

export const NOTES_KEY = "bogeyman-matches:notes:v1";
export const NOTE_SCHEMA = 1;

function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const intOrNull = (v) => (Number.isFinite(v) ? Math.round(v) : null);

function normGps(g) {
  if (!g) return null;
  const lng = Number.isFinite(g.lng) ? g.lng : g.lon;
  if (!Number.isFinite(g.lat) || !Number.isFinite(lng)) return null;
  const acc = Number.isFinite(g.accuracyM) ? g.accuracyM : Number.isFinite(g.acc) ? g.acc : null;
  return { lat: g.lat, lng, accuracyM: acc };
}

function normTime(t) {
  if (t instanceof Date && !Number.isNaN(t.getTime())) return t.toISOString();
  if (Number.isFinite(t)) return new Date(t).toISOString();
  if (typeof t === "string" && !Number.isNaN(Date.parse(t))) return t;
  return new Date().toISOString();
}

/**
 * A new note. `text` is trimmed; `t` may be an ISO string, a Date or ms since epoch (now when
 * missing); `gps` accepts { lat, lng | lon, accuracyM | acc } or null. `id` may be passed (tests,
 * imports); otherwise generated.
 */
export function newNote({ id, roundId = null, courseId = null, hole = null, shotNo = null, text = "", gps = null, t } = {}) {
  return {
    id: id ?? genId(),
    schema: NOTE_SCHEMA,
    roundId: roundId ?? null,
    courseId: courseId == null ? null : String(courseId),
    hole: intOrNull(hole),
    shotNo: intOrNull(shotNo),
    text: String(text ?? "").trim(),
    gps: normGps(gps),
    t: normTime(t),
  };
}

function readAll(storage) {
  try {
    const raw = storage?.getItem(NOTES_KEY);
    if (raw == null) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n) => n && typeof n === "object" && n.id != null) : [];
  } catch {
    return [];
  }
}

function writeAll(storage, list) {
  storage.setItem(NOTES_KEY, JSON.stringify(list));
}

/** Upsert by id (an edit replaces the note in place, keeping its position). Returns the stored note. */
export function saveNote(storage, note) {
  const n = newNote(note);
  const list = readAll(storage);
  const i = list.findIndex((x) => x.id === n.id);
  if (i >= 0) list[i] = n;
  else list.push(n);
  writeAll(storage, list);
  return n;
}

/**
 * Notes for one round (every note when `roundId` is omitted), in time order then by hole and shot.
 */
export function loadNotes(storage, roundId) {
  const list = readAll(storage).filter((n) => roundId == null || n.roundId === roundId);
  return list.map((n, i) => ({ n, i })).sort((a, b) =>
    (Date.parse(a.n.t) || 0) - (Date.parse(b.n.t) || 0) ||
    (a.n.hole ?? 0) - (b.n.hole ?? 0) || (a.n.shotNo ?? 0) - (b.n.shotNo ?? 0) || a.i - b.i).map((x) => x.n);
}

/** Remove one note by id. Returns true when something went. */
export function deleteNote(storage, id) {
  const list = readAll(storage);
  const next = list.filter((n) => n.id !== id);
  if (next.length === list.length) return false;
  writeAll(storage, next);
  return true;
}
