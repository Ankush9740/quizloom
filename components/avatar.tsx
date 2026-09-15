import type { AvatarConfig } from "@/lib/types";

export function Avatar({ config, size = 96, className = "" }: { config: AvatarConfig; size?: number; className?: string }) {
  const shape = config.base === "round" ? "50%" : config.base === "bot" ? "28%" : "46% 46% 38% 38%";
  return <div className={`relative shrink-0 overflow-hidden rounded-[30%] ${className}`} style={{ width: size, height: size, background: config.accent }} aria-hidden="true">
    <div className="absolute inset-x-[18%] bottom-[10%] top-[18%] border-[3px] border-ink/80" style={{ background: config.skin, borderRadius: shape }}>
      <div className="absolute left-1/2 top-[35%] flex -translate-x-1/2 gap-[10px]">
        {config.eyes === "happy" ? <><i className="block h-2 w-3 rounded-t-full border-t-[3px] border-ink"/><i className="block h-2 w-3 rounded-t-full border-t-[3px] border-ink"/></> : config.eyes === "wink" ? <><i className="block h-1 w-3 rounded-full bg-ink"/><i className="block h-2 w-2 rounded-full bg-ink"/></> : <><i className="block h-2 w-2 rounded-full bg-ink"/><i className="block h-2 w-2 rounded-full bg-ink"/></>}
      </div>
      <div className="absolute left-1/2 top-[56%] h-2 w-4 -translate-x-1/2 rounded-b-full border-b-[3px] border-ink" />
      {config.accessory === "glasses" && <div className="absolute left-1/2 top-[31%] h-4 w-12 -translate-x-1/2 rounded-lg border-[3px] border-ink before:absolute before:left-1/2 before:top-1/2 before:h-[3px] before:w-2 before:-translate-x-1/2 before:bg-ink" />}
      {config.accessory === "stars" && <span className="absolute right-1 top-1 text-sm">★</span>}
      {config.accessory === "bow" && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xl">◆</span>}
    </div>
    {config.head === "cap" && <div className="absolute left-[20%] top-[10%] h-[22%] w-[60%] rounded-t-full bg-ink after:absolute after:-right-3 after:bottom-0 after:h-2 after:w-8 after:rounded-full after:bg-ink" />}
    {config.head === "sprout" && <><div className="absolute left-1/2 top-[6%] h-4 w-1 -translate-x-1/2 bg-ink"/><div className="absolute left-[50%] top-[4%] h-3 w-6 rounded-full bg-mint -rotate-12"/></>}
    {config.head === "crown" && <div className="absolute left-1/2 top-[5%] -translate-x-1/2 text-3xl text-sun">♛</div>}
  </div>;
}
