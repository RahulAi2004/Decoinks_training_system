// Chat attachments: images, PDFs and common documents that either side of a
// live chat can send. Available to admins/trainers and trainees alike, so it is
// mounted with plain authRequired rather than under /admin.
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { DATA_DIR, uuid } from '../db.js';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// SVG and HTML are deliberately excluded: they can carry script and would run
// on our own origin when opened from a chat.
const ALLOWED = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.csv', 'text/csv'], ['.txt', 'text/plain'],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Never build the path from the user's filename — it is kept only as a label.
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const r = Router();

r.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pick an image, PDF, or document under 10MB' });
  const ext = path.extname(req.file.filename).toLowerCase();
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    mime: ALLOWED.get(ext) || 'application/octet-stream',
    size: req.file.size,
  });
});

export default r;

// Pull the attachment fields off a request body, keeping only a URL we issued.
export function attachmentFrom(body) {
  const a = body?.attachment;
  if (!a || typeof a.url !== 'string' || !a.url.startsWith('/uploads/')) return null;
  if (a.url.includes('..')) return null;
  return {
    url: a.url,
    name: String(a.name || '').slice(0, 200) || 'attachment',
    mime: String(a.mime || 'application/octet-stream').slice(0, 100),
  };
}

// Attachments the chat screens read back off a message row.
export const ATTACHMENT_COLUMNS = 'attachment_url, attachment_name, attachment_mime';

// Delete files that no message references any more (called after a chat is deleted).
export function pruneOrphanUploads() {
  const used = new Set(db.prepare('SELECT attachment_url FROM session_messages WHERE attachment_url IS NOT NULL')
    .all().map(r0 => path.basename(r0.attachment_url)));
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (!used.has(f)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch { /* already gone */ } }
  }
}
