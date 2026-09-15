import Link from "next/link";
import { ArrowRight, Gamepad2, PencilRuler, Sparkles, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { QuickJoin } from "@/components/quick-join";

export default function Home() {
  return <main className="grid-paper min-h-screen">
    <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5"><Logo/><Link href="/host" className="btn-secondary hidden sm:inline-flex"><PencilRuler size={18}/> Build a quiz</Link></nav>
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 lg:grid-cols-[1.05fr_.95fr] lg:pt-20">
      <div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-ink/10 bg-white px-4 py-2 text-sm font-bold"><Sparkles size={16} className="text-coral"/> Made for bright rooms</div>
        <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl font-bold leading-[.98] tracking-[-.055em] sm:text-7xl">Big questions.<br/><span className="text-blue">Every voice.</span></h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-ink/65">Create a live quiz, share one code, and watch the whole room light up—no player accounts needed.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/host" className="btn-primary">Host a quiz <ArrowRight size={19}/></Link><a href="#join" className="btn-secondary">Join a quiz</a></div>
        <div className="mt-10 flex flex-wrap gap-5 text-sm font-bold text-ink/55"><span className="flex items-center gap-2"><Users size={18} className="text-mint"/> 50+ players</span><span className="flex items-center gap-2"><Gamepad2 size={18} className="text-coral"/> Live scoring</span></div>
      </div>
      <div id="join" className="relative">
        <div className="absolute -right-3 -top-4 -rotate-3 rounded-2xl bg-sun px-4 py-2 font-[family-name:var(--font-display)] font-bold shadow-md">JOIN IN ↓</div>
        <QuickJoin />
      </div>
    </section>
  </main>;
}
