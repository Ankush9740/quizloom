import Link from "next/link";

export function Logo() {
  return <Link href="/" className="inline-flex items-center gap-2 rounded-xl font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue text-white shadow-[0_4px_0_#1735ad]">Q</span> Quizloom
  </Link>;
}
