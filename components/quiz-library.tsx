"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, FileJson, Pencil, Play, Plus, Trash2, Upload, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { ApiResponseError, readJsonResponse } from "@/lib/client/http";
import { forgetQuiz, getQuizAccess, getQuizToken, rememberQuiz } from "@/lib/quiz-library-client";
import type { SavedQuizSummary } from "@/lib/types";
import { startClientTrace } from "@/lib/client/performance";

type QuizLibraryResponse = { quizzes: SavedQuizSummary[] };
type QuizMutationResponse = { quizId: string; quizToken: string };
type RoomResponse = { code: string; hostToken: string };
type ActiveRoomConflict = { error: string; activeRooms: { code: string; status: "lobby" | "question" | "results" }[] };
type EndActiveRoomsResponse = { ok: true; endedRoomCount: number; endedRoomCodes: string[] };

export function QuizLibrary() {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<SavedQuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SavedQuizSummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteConflict, setDeleteConflict] = useState<ActiveRoomConflict | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialRefreshStarted = useRef(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/quizzes/library", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ access: getQuizAccess() })
      });
      const json = await readJsonResponse<QuizLibraryResponse>(response);
      setQuizzes(json.quizzes);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load the library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialRefreshStarted.current) return;
    initialRefreshStarted.current = true;
    void refresh();
  }, []);

  async function importQuiz(file: File) {
    setNotice("");
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a .json quiz file");
      if (file.size > 250_000) throw new Error("Quiz files must be smaller than 250 KB");
      const document = JSON.parse(await file.text());
      const response = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(document)
      });
      const json = await readJsonResponse<QuizMutationResponse>(response);
      rememberQuiz(json.quizId, json.quizToken);
      setNotice("Quiz imported. You can review it before hosting.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof SyntaxError ? "That file is not valid JSON" : error instanceof Error ? error.message : "Could not import the quiz");
    }
  }

  async function host(quiz: SavedQuizSummary) {
    const token = getQuizToken(quiz.id);
    if (!token) return;
    setBusyId(quiz.id); setNotice("");
    try {
      const trace = startClientTrace("room.create");
      const response = await fetch(`/api/quizzes/${quiz.id}`, { method: "POST", headers: { "x-quiz-token": token, "Accept": "application/json", ...trace.header } });
      trace.finish(response);
      const json = await readJsonResponse<RoomResponse>(response);
      sessionStorage.setItem(`quizloom:host:${json.code}`, json.hostToken);
      router.push(`/host/${json.code}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not host this quiz");
      setBusyId("");
    }
  }

  async function exportQuiz(quiz: SavedQuizSummary) {
    const token = getQuizToken(quiz.id);
    if (!token) return;
    setBusyId(quiz.id); setNotice("");
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, { headers: { "x-quiz-token": token, "Accept": "application/json" } });
      const json = await readJsonResponse<Record<string, unknown>>(response);
      const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quiz"}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export this quiz");
    } finally { setBusyId(""); }
  }

  async function deleteQuiz() {
    if (!deleteTarget || busyId) return;
    const target = deleteTarget;
    const token = getQuizToken(target.id);
    if (!token) { setDeleteError("Quiz access is not available on this device"); return; }
    setBusyId(target.id); setDeleteError(""); setDeleteConflict(null);
    try {
      const response = await fetch(`/api/quizzes/${target.id}`, { method: "DELETE", headers: { "x-quiz-token": token, "Accept": "application/json" } });
      await readJsonResponse<{ ok: true; deletedQuizId: string }>(response);
      forgetQuiz(target.id);
      setQuizzes(current => current.filter(quiz => quiz.id !== target.id));
      setDeleteTarget(null);
      setNotice(`“${target.title}” was deleted.`);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409 && Array.isArray((error.body as Partial<ActiveRoomConflict>).activeRooms)) {
        setDeleteConflict(error.body as ActiveRoomConflict);
      }
      setDeleteError(error instanceof Error ? error.message : "Could not delete this quiz");
    } finally { setBusyId(""); }
  }

  async function endActiveRoomsAndDelete() {
    if (!deleteTarget || busyId || !deleteConflict?.activeRooms.length) return;
    const target = deleteTarget;
    const token = getQuizToken(target.id);
    if (!token) { setDeleteError("Quiz access is not available on this device"); return; }
    setBusyId(target.id); setDeleteError("");
    try {
      const endResponse = await fetch(`/api/quizzes/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-quiz-token": token, "Accept": "application/json" },
        body: JSON.stringify({ action: "end-active-rooms" })
      });
      const ended = await readJsonResponse<EndActiveRoomsResponse>(endResponse);
      for (const code of ended.endedRoomCodes) sessionStorage.removeItem(`quizloom:host:${code}`);
      const deleteResponse = await fetch(`/api/quizzes/${target.id}`, { method: "DELETE", headers: { "x-quiz-token": token, "Accept": "application/json" } });
      await readJsonResponse<{ ok: true; deletedQuizId: string }>(deleteResponse);
      forgetQuiz(target.id);
      setQuizzes(current => current.filter(quiz => quiz.id !== target.id));
      setDeleteTarget(null); setDeleteConflict(null);
      setNotice(`${ended.endedRoomCount === 1 ? "The active room was" : `${ended.endedRoomCount} active rooms were`} ended and “${target.title}” was deleted.`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not end the active room and delete this quiz");
    } finally { setBusyId(""); }
  }

  return <main className="grid-paper min-h-screen">
    <nav className="border-b border-ink/10 bg-paper/90 px-5 py-4 backdrop-blur sm:px-6 lg:px-8"><div className="mx-auto flex max-w-[100rem] items-center justify-between"><Logo/><Link href="/host/new" className="btn-primary"><Plus size={18}/> <span className="hidden sm:inline">Create quiz</span><span className="sm:hidden">New</span></Link></div></nav>
    <section className="mx-auto max-w-[100rem] px-5 py-10 sm:px-6 lg:px-8 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm font-extrabold uppercase tracking-[.17em] text-blue">Host workspace</p><h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight sm:text-5xl">Quiz library</h1><p className="mt-3 max-w-xl text-ink/55">Prepare once, host whenever the room is ready.</p></div><><input ref={inputRef} type="file" accept="application/json,.json" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void importQuiz(file); event.target.value = ""; }}/><button onClick={() => inputRef.current?.click()} className="btn-secondary"><Upload size={18}/> Import quiz</button></></div>
      {notice && <p role="status" className="mt-6 rounded-2xl border-2 border-blue/15 bg-blue/5 p-4 font-semibold">{notice}</p>}
      {loading ? <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3 min-[1800px]:grid-cols-4">{[1,2,3].map(number => <div key={number} className="card h-56 animate-pulse bg-white/60"/>)}</div> : quizzes.length ? <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3 min-[1800px]:grid-cols-4">{quizzes.map((quiz,index) => <article key={quiz.id} className="card flex min-h-64 flex-col overflow-hidden p-6"><div className={`mb-5 h-2 w-20 rounded-full ${["bg-blue","bg-coral","bg-mint"][index%3]}`}/><h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">{quiz.title}</h2><p className="mt-2 line-clamp-2 text-ink/55">{quiz.description || "No description"}</p><p className="mt-4 text-sm font-bold text-ink/45">{quiz.questionCount} question{quiz.questionCount !== 1 && "s"}</p><div className="mt-auto grid grid-cols-2 gap-2 pt-6"><button disabled={busyId === quiz.id} onClick={() => host(quiz)} className="btn-primary"><Play size={17}/> Host</button><Link href={`/host/quizzes/${quiz.id}`} className="btn-secondary"><Pencil size={17}/> Edit</Link><button disabled={busyId === quiz.id} onClick={() => exportQuiz(quiz)} className="inline-flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold text-ink/50 hover:bg-ink/5 hover:text-blue"><Download size={16}/> Export</button><button disabled={Boolean(busyId)} onClick={() => { setDeleteTarget(quiz); setDeleteError(""); setDeleteConflict(null); }} className="inline-flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold text-red-600 hover:bg-red-50"><Trash2 size={16}/> Delete</button></div></article>)}</div> : <div className="card mt-10 grid min-h-80 place-items-center p-8 text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue/10 text-blue"><FileJson size={30}/></span><h2 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-bold">Your library is ready</h2><p className="mx-auto mt-2 max-w-md text-ink/55">Create a quiz from scratch or import a Quizloom JSON file. Nothing launches until you choose Host.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/host/new" className="btn-primary"><Plus size={18}/> Create quiz</Link><button onClick={() => inputRef.current?.click()} className="btn-secondary"><Upload size={18}/> Import JSON</button></div></div></div>}
    </section>
    {deleteTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-5" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="delete-quiz-title" className="card w-full max-w-md animate-pop p-6 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-extrabold uppercase tracking-[.15em] text-red-600">Permanent action</p><h2 id="delete-quiz-title" className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">Delete this quiz?</h2></div><button onClick={() => { setDeleteTarget(null); setDeleteConflict(null); }} disabled={busyId === deleteTarget.id} aria-label="Close delete confirmation" className="rounded-xl p-2 text-ink/45 hover:bg-ink/5"><X size={20}/></button></div><p className="mt-4 text-ink/60">This will permanently delete <strong className="text-ink">{deleteTarget.title}</strong>. This action cannot be undone.</p>{deleteError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{deleteError}</p>}{deleteConflict && <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm text-red-800"><p className="font-bold">Active room{deleteConflict.activeRooms.length === 1 ? "" : "s"}: {deleteConflict.activeRooms.map(room => `${room.code} (${room.status})`).join(", ")}</p><p className="mt-1">Ending {deleteConflict.activeRooms.length === 1 ? "this room" : "these rooms"} will disconnect current players. Completed and previously ended rooms are not affected.</p></div>}<div className="mt-6 flex flex-wrap justify-end gap-3"><button onClick={() => { setDeleteTarget(null); setDeleteConflict(null); }} disabled={busyId === deleteTarget.id} className="btn-secondary">Cancel</button>{deleteConflict ? <button onClick={() => void endActiveRoomsAndDelete()} disabled={busyId === deleteTarget.id} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white shadow-[0_4px_0_#991b1b] transition hover:bg-red-700 active:translate-y-1 active:shadow-none disabled:opacity-50"><Trash2 size={18}/>{busyId === deleteTarget.id ? "Ending room…" : `End room${deleteConflict.activeRooms.length === 1 ? "" : "s"} & delete`}</button> : <button onClick={() => void deleteQuiz()} disabled={busyId === deleteTarget.id} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 font-bold text-white shadow-[0_4px_0_#991b1b] transition hover:bg-red-700 active:translate-y-1 active:shadow-none disabled:opacity-50"><Trash2 size={18}/>{busyId === deleteTarget.id ? "Deleting…" : "Delete"}</button>}</div></section></div>}
  </main>;
}
