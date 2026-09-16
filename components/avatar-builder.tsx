"use client";
import { Avatar } from "@/components/avatar";
import { accents, avatarPresets } from "@/lib/avatar-defaults";
import type { AvatarConfig } from "@/lib/types";

export function AvatarBuilder({ value, onChange }: { value: AvatarConfig; onChange: (value: AvatarConfig) => void }) {
  const set = <K extends keyof AvatarConfig>(key: K, val: AvatarConfig[K]) => onChange({ ...value, character: "custom", [key]: val });
  return <div className="grid gap-5 sm:grid-cols-[150px_1fr]">
    <div className="grid place-items-center rounded-3xl bg-ink/[.04] p-5"><Avatar config={value} size={120} className="animate-float" /></div>
    <div className="space-y-4">
      <fieldset><legend className="mb-2 text-sm font-bold text-ink/65">Characters</legend><div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{avatarPresets.map(preset => { const selected = preset.config.character === value.character; return <button type="button" key={preset.name} onClick={() => onChange({ ...preset.config })} aria-label={`Choose ${preset.name} character`} aria-pressed={selected} title={preset.name} className={`rounded-2xl border-2 p-1.5 transition hover:-translate-y-0.5 ${selected ? "border-blue bg-blue/10" : "border-ink/10 bg-white hover:border-blue/40"}`}><Avatar config={preset.config} size={46} className="mx-auto"/></button>; })}</div></fieldset>
      <div><p className="mb-1 text-sm font-bold text-ink/65">Classic customization</p><p className="mb-3 text-xs text-ink/45">Changing these details switches to the classic custom character.</p><div className="space-y-4">
        <Choice label="Shape" values={["round", "bean", "bot"]} selected={value.base} onSelect={(v) => set("base", v as AvatarConfig["base"])} />
        <Choice label="Eyes" values={["dot", "happy", "wink"]} selected={value.eyes} onSelect={(v) => set("eyes", v as AvatarConfig["eyes"])} />
        <Choice label="Headwear" values={["none", "cap", "sprout", "crown"]} selected={value.head} onSelect={(v) => set("head", v as AvatarConfig["head"])} />
        <Choice label="Extra" values={["none", "glasses", "stars", "bow"]} selected={value.accessory} onSelect={(v) => set("accessory", v as AvatarConfig["accessory"])} />
      </div></div>
      <Swatches label="Backdrop" colors={accents} selected={value.accent} onSelect={(accent) => onChange({ ...value, accent })} />
    </div>
  </div>;
}

function Choice({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (v: string) => void }) {
  return <fieldset><legend className="mb-2 text-sm font-bold text-ink/65">{label}</legend><div className="flex flex-wrap gap-2">{values.map(v => <button type="button" key={v} onClick={() => onSelect(v)} aria-pressed={selected === v} className={`rounded-xl border-2 px-3 py-1.5 text-sm font-semibold capitalize transition ${selected === v ? "border-blue bg-blue text-white" : "border-ink/10 bg-white hover:border-blue/50"}`}>{v}</button>)}</div></fieldset>;
}
function Swatches({ label, colors, selected, onSelect }: { label: string; colors: string[]; selected: string; onSelect: (v: string) => void }) {
  return <fieldset><legend className="mb-2 text-sm font-bold text-ink/65">{label}</legend><div className="flex gap-2">{colors.map(c => <button type="button" key={c} onClick={() => onSelect(c)} aria-label={`${label} ${c}`} aria-pressed={selected === c} className={`h-8 w-8 rounded-full border-2 transition ${selected === c ? "scale-110 border-ink" : "border-transparent"}`} style={{ backgroundColor: c }} />)}</div></fieldset>;
}
