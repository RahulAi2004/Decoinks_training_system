// The Source of Truth: the canonical Decoinks knowledge that is ALWAYS injected into
// the evaluator (and available to any grader) so grading is anchored to one authoritative
// reference instead of only whatever fuzzy RAG chunks happened to be retrieved.
// Backed by content/knowledge/Decoinks-Source-of-Truth.md so it doubles as study material.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_OF_TRUTH_FILE = path.join(
  __dirname, '..', '..', 'content', 'knowledge', 'Decoinks-Source-of-Truth.md'
);

let cache = null;

// Loaded once and cached. Call invalidate() after the file changes (e.g. re-ingest).
export function getSourceOfTruth() {
  if (cache != null) return cache;
  try {
    cache = fs.readFileSync(SOURCE_OF_TRUTH_FILE, 'utf8').trim();
  } catch {
    cache = ''; // grading still works off RAG excerpts if the file is missing
  }
  return cache;
}

export function invalidateSourceOfTruth() { cache = null; }
