import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Mic, MicOff, Send, Trash2, User, Volume2, VolumeX } from "lucide-react";
import { askGemini } from "@/lib/chat/gemini.functions";

type Msg = { role: "user" | "model"; text: string };
const WAKE = /xin\s*chào\s*bạn[\s,.!?]*/i;
const clean = (t: string) => t.replace(/\*\*|^#+\s*/gm, "").replace(/^\s*[*-]\s+/gm, "• ");
function speak(t: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean(t).replace(/[•⚠*#`_]/g, " "));
  u.lang = "vi-VN"; u.rate = 1.05;
  const v = window.speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith("vi"));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function AIChatImpl() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [supported, setSupported] = useState(true);
  const [live, setLive] = useState("");
  const [voice, setVoice] = useState(true);
  const voiceRef = useRef(true);
  voiceRef.current = voice;
  const listRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const awaitRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy, live]);

  const send = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) return;
    const next = [...msgsRef.current, { role: "user" as const, text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await askGemini({ data: { messages: next.slice(-20) } });
      setMsgs((m) => [...m, { role: "model", text: r.ok ? r.text : `⚠ ${r.error}` }]);
      if (r.ok && voiceRef.current) speak(r.text);
    } catch {
      setMsgs((m) => [...m, { role: "model", text: "⚠ Không kết nối được AI, thử lại." }]);
    } finally { setBusy(false); }
  }, []);

  const startListen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = "vi-VN"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) {
          const it: string = e.results[i][0].transcript;
          const mm = it.match(WAKE);
          if (mm) { interim = it.slice((mm.index ?? 0) + mm[0].length).trim() || "Mình đang nghe, bạn hỏi đi…"; awaitRef.current = true; if (!awaitRef.current) { window.speechSynthesis?.cancel(); } }
          else if (awaitRef.current) interim = it.trim();
          continue;
        }
        setLive("");
        if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
        const t: string = e.results[i][0].transcript.trim();
        const m = t.match(WAKE);
        if (m) {
          const rest = t.slice((m.index ?? 0) + m[0].length).trim();
          if (rest) { awaitRef.current = false; setAwaiting(false); send(rest); }
          else { awaitRef.current = true; setAwaiting(true); window.speechSynthesis?.cancel(); setLive("Mình đang nghe, bạn hỏi đi…"); }
        } else if (awaitRef.current && t) {
          awaitRef.current = false; setAwaiting(false); send(t);
        }
      }
      if (interim) {
        setLive(interim); setAwaiting(true);
        // Ngắt tiếng ~3 giây → gửi luôn, không chờ trình duyệt chốt câu.
        if (silenceRef.current) clearTimeout(silenceRef.current);
        const q = interim === "Mình đang nghe, bạn hỏi đi…" ? "" : interim;
        if (q) silenceRef.current = setTimeout(() => {
          silenceRef.current = null;
          if (!awaitRef.current) return;
          awaitRef.current = false; setAwaiting(false); setLive("");
          try { rec.abort(); } catch { /* onend tự bật lại mic */ }
          send(q);
        }, 3000);
      }
    };
    rec.onend = () => { if (wantRef.current) { try { rec.start(); } catch { /* ignore */ } } else setListening(false); };
    rec.onerror = (e: any) => { if (e.error === "not-allowed") { wantRef.current = false; setListening(false); } };
    recRef.current = rec; wantRef.current = true;
    try { rec.start(); setListening(true); } catch { /* ignore */ }
  }, [send]);

  const stopListen = useCallback(() => { wantRef.current = false; awaitRef.current = false; setAwaiting(false); recRef.current?.stop(); setListening(false); }, []);
  useEffect(() => () => { wantRef.current = false; recRef.current?.abort?.(); }, []);
  // Tự bật mic khi vào trang; nếu trình duyệt chặn, bật ở lần chạm/bấm đầu tiên.
  useEffect(() => {
    startListen();
    const kick = () => { if (!wantRef.current) startListen(); };
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
    return () => { window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); };
  }, [startListen]);

  return (
    <section className="panel flex h-[420px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="grid size-7 place-items-center rounded-full bg-primary/15"><Bot className="size-4 text-primary" /></div>
        <div className="min-w-0">
          <div className="font-display text-sm font-bold tracking-widest">TRỢ LÝ AI</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {!supported ? "Trình duyệt không hỗ trợ giọng nói" : awaiting ? "● Đang nghe câu hỏi…" : listening ? "Nói “Xin chào bạn” để hỏi" : "Gemini · nhập hoặc bật mic"}
          </div>
        </div>
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost px-2 py-1" title={voice ? "Tắt đọc trả lời" : "Bật đọc trả lời"} onClick={() => { if (voice) window.speechSynthesis?.cancel(); setVoice(!voice); }}>{voice ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}</button>
          {msgs.length > 0 && <button className="btn-ghost px-2 py-1" title="Xóa hội thoại" onClick={() => setMsgs([])}><Trash2 className="size-3.5" /></button>}
          <button className={`${listening ? "btn-primary" : "btn-ghost"} px-2 py-1`} title={listening ? "Tắt mic" : "Bật nghe “Xin chào bạn”"} onClick={listening ? stopListen : startListen}>
            {listening ? <Mic className={`size-3.5 ${awaiting ? "animate-pulse" : ""}`} /> : <MicOff className="size-3.5" />}
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div><Bot className="mx-auto mb-2 size-8 text-primary/60" />Bật mic và nói <b className="text-foreground">“Xin chào bạn…”</b> kèm câu hỏi,<br />hoặc gõ câu hỏi bên dưới.</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`grid size-6 shrink-0 place-items-center rounded-full ${m.role === "user" ? "bg-muted" : "bg-primary/15"}`}>
              {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5 text-primary" />}
            </div>
            <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 ${m.role === "user" ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm border border-border bg-background/60"}`}>{m.role === "model" ? clean(m.text) : m.text}{m.role === "model" && <button className="ml-1 inline-flex align-middle text-muted-foreground hover:text-primary" title="Nghe" onClick={() => speak(m.text)}><Volume2 className="size-3.5" /></button>}</div>
          </div>
        ))}
        {live && (
          <div className="flex flex-row-reverse gap-2"><div className="grid size-6 shrink-0 place-items-center rounded-full bg-muted"><Mic className="size-3.5 animate-pulse" /></div>
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/60 px-3.5 py-2.5 text-[13.5px] italic text-primary-foreground">{live}</div></div>
        )}
        {busy && (
          <div className="flex gap-2"><div className="grid size-6 place-items-center rounded-full bg-primary/15"><Bot className="size-3.5 text-primary" /></div>
            <div className="flex items-center gap-1 rounded-2xl border border-border bg-background/60 px-3 py-2">
              {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 120}ms` }} />)}
            </div></div>
        )}
      </div>
      <form className="flex gap-2 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); if (!busy) send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Hỏi bất cứ điều gì…" className="field flex-1" maxLength={4000} />
        <button type="submit" className="btn-primary px-3" disabled={busy || !input.trim()} aria-label="Gửi"><Send className="size-4" /></button>
      </form>
    </section>
  );
}
export default memo(AIChatImpl);
