// Chat attachments: pick a file, show what is staged, and render what was sent.
// Images preview inline; PDFs and documents show as a chip that opens in a tab.
import { useRef, useState } from 'react';
import { getToken } from '../api';

const isImage = (mime, url = '') => /^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(url);

function icon(mime, url = '') {
  if (isImage(mime, url)) return '🖼️';
  if (/pdf/i.test(mime || '') || /\.pdf$/i.test(url)) return '📕';
  if (/sheet|excel|csv/i.test(mime || '')) return '📊';
  return '📄';
}

// Renders an attachment that is already on a message.
export function Attachment({ url, name, mime, className = '' }) {
  if (!url) return null;
  if (isImage(mime, url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer"
        className={`mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
        <img src={url} alt={name || 'attachment'} className="max-h-52 w-full object-contain bg-slate-50" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" download={name || undefined}
      className={`mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 ${className}`}>
      <span className="text-base leading-none">{icon(mime, url)}</span>
      <span className="min-w-0 truncate">{name || 'Attachment'}</span>
      <span className="ml-auto shrink-0 text-[10px] uppercase text-violet-600">open</span>
    </a>
  );
}

// Paperclip button: uploads immediately, then hands {url,name,mime} to onPick.
export function AttachButton({ onPick, disabled, title = 'Attach an image, PDF or document' }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // let the same file be picked again later
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('That file is over 10MB.'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      onPick(data);
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <input ref={inputRef} type="file" onChange={choose} className="hidden"
        accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.csv,.txt" />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || disabled}
        title={title} aria-label={title}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
        {busy ? '…' : '📎'}
      </button>
    </>
  );
}

// The staged file shown above the composer before you hit Send.
export function StagedAttachment({ file, onClear }) {
  if (!file) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs">
      <span className="text-base leading-none">{icon(file.mime, file.url)}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-violet-900">{file.name}</span>
      <span className="shrink-0 text-[10px] uppercase text-violet-500">ready to send</span>
      <button type="button" onClick={onClear} aria-label="Remove attachment"
        className="shrink-0 px-1 text-violet-400 hover:text-rose-600">✕</button>
    </div>
  );
}
