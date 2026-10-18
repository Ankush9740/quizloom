"use client";
import { Avatar } from "@/components/avatar";
import { avatarPresets } from "@/lib/avatar-defaults";
import type { AvatarConfig } from "@/lib/types";

export function AvatarBuilder({ value, onChange }: { value: AvatarConfig; onChange: (value: AvatarConfig) => void }) {
  const selectedName = avatarPresets.find(preset => preset.config.character === value.character)?.name ?? "Selected character";
  return <div className="grid items-start gap-4 sm:grid-cols-[120px_1fr]">
    <div className="grid self-start place-items-center rounded-3xl bg-ink/[.04] p-3 text-center"><Avatar config={value} size={88} className="animate-float"/><p className="mt-2 text-xs font-bold text-ink/55">{selectedName}</p></div>
    <fieldset><legend className="mb-2 text-sm font-bold text-ink/65">Choose a character</legend><div className="grid max-h-72 grid-cols-5 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 md:grid-cols-7">{avatarPresets.map(preset => { const selected = preset.config.character === value.character; return <button type="button" key={preset.name} onClick={() => onChange({ ...preset.config })} aria-label={`Choose ${preset.name} character`} aria-pressed={selected} title={preset.name} className={`rounded-2xl border-2 p-1.5 transition hover:-translate-y-0.5 ${selected ? "border-blue bg-blue/10" : "border-ink/10 bg-white hover:border-blue/40"}`}><Avatar config={preset.config} size={44} className="mx-auto"/></button>; })}</div><p className="mt-2 text-xs text-ink/45">Players can choose the same character. Quizloom assigns distinct backdrops in the room.</p></fieldset>
  </div>;
}
