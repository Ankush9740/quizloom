import Link from "next/link";
import { ArrowRight, Gamepad2, PencilRuler, Sparkles, Users } from "lucide-react";
import { Logo } from "@/components/logo";
import { QuickJoin } from "@/components/quick-join";

export default function Home() {
  return <main className="grid-paper flex min-h-screen min-h-dvh flex-col">
    <nav className="mx-auto flex w-full max-w-[100rem] shrink-0 items-center justify-between px-5 py-5 sm:px-6 xl:px-8 2xl:px-10"><Logo/><Link href="/host" className="btn-secondary hidden sm:inline-flex"><PencilRuler size={18}/> Build a quiz</Link></nav>
    <section className="mx-auto grid w-full max-w-[100rem] flex-1 items-center gap-10 px-5 py-10 sm:px-6 sm:py-12 xl:grid-cols-[1.04fr_.96fr] xl:gap-20 xl:px-8 xl:py-14 2xl:gap-24 2xl:px-10">
      <div className="xl:pr-4">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-ink/10 bg-white px-4 py-2 text-sm font-bold xl:mb-7"><Sparkles size={16} className="text-coral"/> Made for bright rooms</div>
        <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl font-bold leading-[.98] tracking-[-.055em] sm:text-6xl md:text-7xl xl:text-[5.25rem] 2xl:text-8xl">Big questions.<br/><span className="text-blue">Every voice.</span></h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/65 xl:mt-7 2xl:text-xl 2xl:leading-9">Create a live quiz, share one code, and watch the whole room light up—no player accounts needed.</p>
        <div className="mt-8 flex flex-wrap gap-3 xl:mt-9"><Link href="/host" className="btn-primary">Host a quiz <ArrowRight size={19}/></Link><a href="#join" className="btn-secondary">Join a quiz</a></div>
        <div className="mt-10 flex flex-wrap gap-5 text-sm font-bold text-ink/55 xl:mt-11"><span className="flex items-center gap-2"><Users size={18} className="text-mint"/> 50+ players</span><span className="flex items-center gap-2"><Gamepad2 size={18} className="text-coral"/> Live scoring</span></div>
      </div>
      <div id="join" className="relative w-full xl:max-w-[40rem] xl:justify-self-end">
        <div className="absolute -right-3 -top-4 -rotate-3 rounded-2xl bg-sun px-4 py-2 font-[family-name:var(--font-display)] font-bold shadow-md">JOIN IN ↓</div>
        <QuickJoin />
      </div>
    </section>
  </main>;
}
