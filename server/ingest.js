// Ingest pipeline: parse everything in ./content/{knowledge,training,qa} →
// documents + doc_chunks (chunk + embed) + scenarios (from structured Q&A).
// Run via `npm run ingest` or the Admin → Content page (re-ingest button / upload).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { uuid } from './db.js';
import { embedBatch, preferredModel, LOCAL_MODEL } from './embeddings.js';
import { invalidateChunkCache } from './rag.js';
import { invalidateSourceOfTruth } from './services/sourceOfTruth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = path.join(__dirname, '..', 'content');
const KINDS = ['knowledge', 'training', 'qa'];

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  }
  if (ext === '.pdf') {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text;
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.readFile(filePath);
    return wb.SheetNames.map(name =>
      `# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])
    ).join('\n\n');
  }
  if (ext === '.txt' || ext === '.md' || ext === '.json') {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

// Paragraph-aware chunking: ~1000 chars target, 150 char overlap.
export function chunkText(text, { size = 1000, overlap = 150 } = {}) {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + '\n\n' + p;   // carry overlap tail
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
    while (cur.length > size * 1.8) {           // hard-split very long paragraphs
      chunks.push(cur.slice(0, size));
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(c => c.length > 40);
}

// Structured Q&A json → scenario rows + readable chunks
function qaJsonToChunksAndScenarios(json) {
  const chunks = [], scenarios = [];
  for (const intentGroup of json.intents || []) {
    for (const q of intentGroup.questions || []) {
      if (!q.q || !q.best) continue;
      const lang = q.en ? 'es' : 'en';
      scenarios.push({
        question: q.q, model_reply: q.best, intent: intentGroup.intent,
        language: lang, frequency: q.n || 1,
      });
      chunks.push(
        `Q&A [intent: ${intentGroup.intent}]${q.en ? ` (Spanish; EN: ${q.en})` : ''}\n` +
        `Customer: ${q.q}\nBest agent reply: ${q.best}` +
        (q.best_en ? `\n(EN translation of reply: ${q.best_en})` : '')
      );
    }
  }
  return { chunks, scenarios };
}

export async function ingestAll({ log = console.log } = {}) {
  const summary = [];
  // Pre-flight the embedding model once. If the API key is present but unusable
  // (no quota, revoked, etc.), fall back to the local model for the WHOLE run so a
  // dead key can never fail every file and wipe the existing chunks.
  let model = preferredModel();
  if (model !== LOCAL_MODEL) {
    try {
      await embedBatch(['preflight'], model);
    } catch (e) {
      log(`⚠ Embedding model "${model}" unavailable (${String(e.message || e).slice(0, 80)}). Falling back to "${LOCAL_MODEL}".`);
      model = LOCAL_MODEL;
    }
  }
  log(`Embedding model: ${model}`);

  for (const kind of KINDS) {
    const dir = path.join(CONTENT_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      const filePath = path.join(dir, filename);
      if (!fs.statSync(filePath).isFile()) continue;

      // replace any previous version of this file
      const old = db.prepare('SELECT id FROM documents WHERE kind = ? AND filename = ?').all(kind, filename);
      for (const o of old) {
        db.prepare('DELETE FROM scenarios WHERE source_document_id = ? AND id NOT IN (SELECT scenario_id FROM scenario_attempts)').run(o.id);
        db.prepare('UPDATE scenarios SET source_document_id = NULL WHERE source_document_id = ?').run(o.id);
        db.prepare('DELETE FROM documents WHERE id = ?').run(o.id);
      }

      const docId = uuid();
      db.prepare(`INSERT INTO documents (id, kind, filename, storage_path, parsed_status) VALUES (?, ?, ?, ?, 'parsing')`)
        .run(docId, kind, filename, path.relative(path.join(__dirname, '..'), filePath));

      try {
        let chunks = [], scenarios = [];
        if (kind === 'qa' && filename.toLowerCase().endsWith('.json')) {
          const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          ({ chunks, scenarios } = qaJsonToChunksAndScenarios(json));
        } else {
          const text = await extractText(filePath);
          if (text == null) throw new Error(`Unsupported file type: ${filename}`);
          chunks = chunkText(text);
        }
        if (!chunks.length) throw new Error('No text extracted');

        // embed in batches
        const embeddings = [];
        for (let i = 0; i < chunks.length; i += 64) {
          embeddings.push(...await embedBatch(chunks.slice(i, i + 64), model));
        }
        const insChunk = db.prepare('INSERT INTO doc_chunks (id, document_id, kind, content, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?)');
        const insScen = db.prepare('INSERT INTO scenarios (id, question, model_reply, intent, language, frequency, source_document_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        db.transaction(() => {
          chunks.forEach((c, i) => insChunk.run(uuid(), docId, kind, c, JSON.stringify(embeddings[i]), model));
          scenarios.forEach(s => insScen.run(uuid(), s.question, s.model_reply, s.intent, s.language, s.frequency, docId));
          db.prepare(`UPDATE documents SET parsed_status = 'ready', chunk_count = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(chunks.length, docId);
        })();
        log(`  ✓ ${kind}/${filename}: ${chunks.length} chunks${scenarios.length ? `, ${scenarios.length} scenarios` : ''}`);
        summary.push({ kind, filename, status: 'ready', chunks: chunks.length, scenarios: scenarios.length });
      } catch (err) {
        db.prepare(`UPDATE documents SET parsed_status = 'error', parse_error = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(String(err.message || err), docId);
        log(`  ✗ ${kind}/${filename}: ${err.message}`);
        summary.push({ kind, filename, status: 'error', error: String(err.message || err) });
      }
    }
  }
  invalidateChunkCache();
  invalidateSourceOfTruth();
  return summary;
}

// CLI entry
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  ingestAll().then(s => {
    console.log(`\nIngest complete: ${s.filter(x => x.status === 'ready').length}/${s.length} files ready.`);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
