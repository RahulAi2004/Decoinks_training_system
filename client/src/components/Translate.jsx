// Spanish ⇄ English helpers used on every chat screen.
//
// <TranslateMessage> puts a small "🌐 Translate" link under a customer message.
// The server caches the translation on the message row, so each message only
// ever costs one AI call no matter how often it is opened.
//
// <TranslateReply> turns the reply you typed in English into Spanish before you
// send it.
import { useState } from 'react';
import { api } from '../api';

export function TranslateMessage({ path, className = '' }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (text) { setOpen(o => !o); return; }   // already fetched — just toggle
    setBusy(true);
    try {
      const r = await api(path, { method: 'POST' });
      setText(r.translation); setOpen(true);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <span className={className}>
      <button type="button" onClick={go} disabled={busy}
        className="normal-case font-semibold text-sky-600 hover:text-sky-800 disabled:opacity-50">
        {busy ? 'translating…' : open ? 'hide translation' : '🌐 Translate'}
      </button>
      {open && text && (
        <span className="mt-1 block rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] normal-case tracking-normal text-sky-900 whitespace-pre-wrap">
          {text}
        </span>
      )}
    </span>
  );
}

export function TranslateReply({ path = '/practice/translate', text, onResult, disabled }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const clean = String(text || '').trim();
    if (!clean) return;
    setBusy(true);
    try {
      const r = await api(path, { method: 'POST', body: { text: clean, to: 'es' } });
      onResult(r.translation);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={go} disabled={busy || disabled || !String(text || '').trim()}
      title="Turn what you typed into Spanish"
      className="shrink-0 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-2.5 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-40">
      {busy ? '…' : '🌐 → ES'}
    </button>
  );
}
