import { normalizeAvatarConfig } from "@/lib/runtime-normalization";
import type { AvatarCharacter, AvatarConfig } from "@/lib/types";

export function Avatar({ config, size = 96, className = "" }: { config?: unknown; size?: number; className?: string }) {
  const safe = normalizeAvatarConfig(config);
  if ((safe.character ?? "custom") === "custom") return <CustomAvatar config={safe} size={size} className={className}/>;
  return <ThemedAvatar config={safe} size={size} className={className}/>;
}

function CustomAvatar({ config, size, className }: { config: AvatarConfig; size: number; className: string }) {
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
    {config.head === "sprout" && <><div className="absolute left-1/2 top-[6%] h-4 w-1 -translate-x-1/2 bg-ink"/><div className="absolute left-[50%] top-[4%] h-3 w-6 -rotate-12 rounded-full bg-mint"/></>}
    {config.head === "crown" && <div className="absolute left-1/2 top-[5%] -translate-x-1/2 text-3xl text-sun">♛</div>}
  </div>;
}

function ThemedAvatar({ config, size, className }: { config: AvatarConfig; size: number; className: string }) {
  const character = config.character as Exclude<AvatarCharacter, "custom">;
  const square = character === "robot" || character === "knight";
  return <svg className={`shrink-0 rounded-[30%] ${className}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${character.replace("-", " ")} avatar`}>
    <rect width="100" height="100" rx="28" fill={config.accent}/>
    <CharacterBack character={character}/>
    <rect x="18" y="18" width="64" height="70" rx={square ? 17 : 31} fill={config.skin} stroke="#14213D" strokeWidth="4"/>
    <CharacterFace character={character} skin={config.skin}/>
  </svg>;
}

function CharacterBack({ character }: { character: Exclude<AvatarCharacter, "custom"> }) {
  switch (character) {
    case "cat": return <><path d="M20 32 22 9 41 24M80 32 78 9 59 24" fill="#F6C453" stroke="#14213D" strokeWidth="4" strokeLinejoin="round"/><path d="m25 22 1-7 7 8m42-1-1-7-7 8" fill="#F78DA7"/></>;
    case "dog": return <path d="M22 28C4 18 8 57 25 55M78 28c18-10 14 29-3 27" fill="#8B5E3C" stroke="#14213D" strokeWidth="4"/>;
    case "panda": case "bear": return <><circle cx="25" cy="22" r="13" fill={character === "panda" ? "#14213D" : "#A96F4F"} stroke="#14213D" strokeWidth="4"/><circle cx="75" cy="22" r="13" fill={character === "panda" ? "#14213D" : "#A96F4F"} stroke="#14213D" strokeWidth="4"/></>;
    case "fox": case "tiger": return <path d="M20 31 21 7 43 24M80 31 79 7 57 24" fill={character === "fox" ? "#FF8A4C" : "#F6A83B"} stroke="#14213D" strokeWidth="4" strokeLinejoin="round"/>;
    case "frog": return <><circle cx="31" cy="21" r="13" fill="#62C979" stroke="#14213D" strokeWidth="4"/><circle cx="69" cy="21" r="13" fill="#62C979" stroke="#14213D" strokeWidth="4"/></>;
    case "rabbit": return <><rect x="23" y="2" width="18" height="43" rx="10" fill="#F4DCE8" stroke="#14213D" strokeWidth="4"/><rect x="59" y="2" width="18" height="43" rx="10" fill="#F4DCE8" stroke="#14213D" strokeWidth="4"/><path d="M31 10v24m38-24v24" stroke="#F78DA7" strokeWidth="5" strokeLinecap="round"/></>;
    case "lion": return <><circle cx="50" cy="52" r="45" fill="#A96F2E" stroke="#14213D" strokeWidth="4"/><path d="m17 35-10-8 14-3m62 11 10-8-14-3M15 66 5 73l16 2m64-9 10 7-16 2" stroke="#14213D" strokeWidth="4"/></>;
    case "elephant": return <><ellipse cx="18" cy="49" rx="17" ry="25" fill="#9EB4C7" stroke="#14213D" strokeWidth="4"/><ellipse cx="82" cy="49" rx="17" ry="25" fill="#9EB4C7" stroke="#14213D" strokeWidth="4"/></>;
    case "penguin": return <><ellipse cx="50" cy="53" rx="41" ry="46" fill="#14213D"/><path d="M20 58 5 70l18 3m57-15 15 12-18 3" fill="#14213D" stroke="#14213D" strokeWidth="4"/></>;
    case "owl": return <><path d="M17 34 20 8l22 20m41 6L80 8 58 28" fill="#8B5E3C" stroke="#14213D" strokeWidth="4"/><path d="M13 56 3 45m84 11 10-11" stroke="#14213D" strokeWidth="5"/></>;
    case "wolf": return <path d="M18 34 21 5l24 22m37 7L79 5 55 27" fill="#9AA7B8" stroke="#14213D" strokeWidth="4"/>;
    case "koala": return <><circle cx="20" cy="34" r="18" fill="#8D99A8" stroke="#14213D" strokeWidth="4"/><circle cx="80" cy="34" r="18" fill="#8D99A8" stroke="#14213D" strokeWidth="4"/></>;
    case "red-panda": return <><path d="M18 34 21 7l23 20m38 7L79 7 56 27" fill="#C9603B" stroke="#14213D" strokeWidth="4"/><path d="m24 21 2-7 8 10m42-3-2-7-8 10" fill="#FFFDF7"/></>;
    case "shark": return <><path d="M39 19 56 2l8 24" fill="#70A9C4" stroke="#14213D" strokeWidth="4"/><path d="M18 65 3 54v26Zm64 0 15-11v26Z" fill="#70A9C4" stroke="#14213D" strokeWidth="4"/></>;
    case "dinosaur": return <><path d="m23 27 4-19 13 16L50 4l10 20L73 8l4 22" fill="#F6C453" stroke="#14213D" strokeWidth="4" strokeLinejoin="round"/></>;
    case "cartoon-kid": return <><path d="M17 35c4-26 62-35 67 2-18-13-38-17-67-2Z" fill="#14213D" stroke="#14213D" strokeWidth="4"/><path d="M35 14c14-9 29-4 39 6" stroke="#F6C453" strokeWidth="5" strokeLinecap="round"/></>;
    case "hero": return <><path d="M16 80 4 96h92L84 80" fill="#FF6846" stroke="#14213D" strokeWidth="4"/><path d="m72 13 18 9-14 10" fill="#F6C453" stroke="#14213D" strokeWidth="4"/></>;
    case "geek": return <path d="M18 32c6-24 57-27 65 2L68 25 55 33 41 24Z" fill="#5C3D2E" stroke="#14213D" strokeWidth="4"/>;
    case "ninja": return <><circle cx="50" cy="51" r="43" fill="#14213D"/><path d="m14 31 24-17 12 9 15-12 22 20" fill="#263658"/></>;
    case "pirate": return <><path d="M15 31c9-25 61-25 70 0" fill="#D83A78" stroke="#14213D" strokeWidth="4"/><path d="M72 23 91 11 87 36" fill="#D83A78" stroke="#14213D" strokeWidth="4"/></>;
    case "explorer": return <><circle cx="50" cy="51" r="46" fill="#DDE8FF" stroke="#14213D" strokeWidth="4"/><path d="M22 25h56" stroke="#3155E7" strokeWidth="7"/></>;
    case "astronaut": return <><circle cx="50" cy="50" r="47" fill="#FFFDF7" stroke="#14213D" strokeWidth="4"/><path d="M17 33h66M20 80h60" stroke="#9EB4FF" strokeWidth="7"/><circle cx="76" cy="18" r="6" fill="#FF6846"/></>;
    case "wizard": return <><path d="M21 31 49 1l31 67-32-13-35 13Z" fill="#7C4DFF" stroke="#14213D" strokeWidth="4" strokeLinejoin="round"/><path d="m48 14 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#F6C453"/></>;
    case "knight": return <><path d="M15 49C15 14 30 3 50 3s35 11 35 46" fill="#B8C4D6" stroke="#14213D" strokeWidth="4"/><path d="M50 4v21M27 20l10 9m36-9-10 9" stroke="#FFFDF7" strokeWidth="5"/></>;
    case "robot": return <><path d="M50 18V7m0 0 9-5" stroke="#14213D" strokeWidth="4"/><circle cx="61" cy="3" r="5" fill="#FF6846" stroke="#14213D" strokeWidth="3"/><path d="M15 44H7v23h11m67-23h8v23H82" fill="#9EB4FF" stroke="#14213D" strokeWidth="4"/></>;
    case "alien": return <><path d="M50 20C38 1 16 9 20 29M50 20C62 1 84 9 80 29" fill="none" stroke="#14213D" strokeWidth="4"/><circle cx="20" cy="27" r="6" fill="#F6C453"/><circle cx="80" cy="27" r="6" fill="#F6C453"/></>;
    case "monster": return <><path d="m20 28 2-23 18 20m40 3L78 5 60 25" fill="#F6C453" stroke="#14213D" strokeWidth="4"/><path d="M12 61 3 52m85 9 9-9" stroke="#14213D" strokeWidth="6" strokeLinecap="round"/></>;
    case "dragon": return <><path d="m21 30-2-25 20 21m40 4 2-25-20 21" fill="#F6C453" stroke="#14213D" strokeWidth="4"/><path d="M18 53 2 36l4 31m76-14 16-17-4 31" fill="#62B86B" stroke="#14213D" strokeWidth="4"/></>;
    case "superhero": return <><path d="M16 78 3 97h94L84 78" fill="#3155E7" stroke="#14213D" strokeWidth="4"/><path d="M18 27 27 8l13 17" fill="#14213D"/></>;
  }
}

function CharacterFace({ character, skin }: { character: Exclude<AvatarCharacter, "custom">; skin: string }) {
  if (character === "ninja") return <><path d="M20 43q30-18 60 0v23q-30 12-60 0Z" fill={skin} stroke="#14213D" strokeWidth="4"/><path d="M20 64h60v24H20Z" fill="#14213D"/><EyePair/><path d="m73 70 15 15m-5-18 9 9" stroke="#FF6846" strokeWidth="4"/></>;
  if (character === "robot") return <><rect x="28" y="38" width="16" height="13" rx="4" fill="#3155E7"/><rect x="56" y="38" width="16" height="13" rx="4" fill="#3155E7"/><path d="M34 68h32v10H34Z" fill="#FFFDF7" stroke="#14213D" strokeWidth="3"/><path d="M42 68v10m16-10v10" stroke="#14213D" strokeWidth="2"/></>;
  if (character === "knight") return <><path d="M19 36h62v25H19Z" fill="#70809A" stroke="#14213D" strokeWidth="4"/><path d="M26 48h48" stroke="#14213D" strokeWidth="5" strokeDasharray="8 5"/><path d="M42 69h16v14H42Z" fill="#FF6846"/></>;
  if (character === "alien") return <><ellipse cx="36" cy="46" rx="9" ry="14" fill="#14213D" transform="rotate(-18 36 46)"/><ellipse cx="64" cy="46" rx="9" ry="14" fill="#14213D" transform="rotate(18 64 46)"/><path d="M42 70q8 7 16 0" fill="none" stroke="#14213D" strokeWidth="4" strokeLinecap="round"/></>;
  if (character === "monster") return <><circle cx="50" cy="47" r="14" fill="#FFFDF7" stroke="#14213D" strokeWidth="4"/><circle cx="50" cy="47" r="5" fill="#14213D"/><path d="M34 71q16 15 32 0Z" fill="#FFFDF7" stroke="#14213D" strokeWidth="4"/><path d="m41 73 4 7 4-8m6 1 4 7 3-8" fill="#FFFDF7"/></>;
  return <>
    {character === "panda" && <><ellipse cx="34" cy="45" rx="12" ry="15" fill="#14213D"/><ellipse cx="66" cy="45" rx="12" ry="15" fill="#14213D"/></>}
    {(character === "hero" || character === "superhero") && <path d="M24 36q26-17 52 0l-5 23q-21 8-42 0Z" fill={character === "hero" ? "#3155E7" : "#D83A78"} stroke="#14213D" strokeWidth="3"/>}
    {character === "pirate" && <><path d="M50 37h29v25H50Z" fill="#14213D"/><path d="M64 58 82 76" stroke="#14213D" strokeWidth="4"/></>}
    {(character === "explorer" || character === "astronaut") && <path d="M20 31h60v40H20Z" fill="#9EB4FF" fillOpacity=".22" stroke="#FFFDF7" strokeWidth="4"/>}
    {character === "wizard" && <path d="M39 63q11 8 22 0l10 24-21-8-21 8Z" fill="#FFFDF7" stroke="#14213D" strokeWidth="3"/>}
    {character === "frog" ? <><circle cx="32" cy="35" r="5" fill="#14213D"/><circle cx="68" cy="35" r="5" fill="#14213D"/></> : character !== "owl" && character !== "penguin" ? <EyePair/> : null}
    {character === "geek" && <><rect x="23" y="35" width="23" height="19" rx="7" fill="none" stroke="#14213D" strokeWidth="4"/><rect x="54" y="35" width="23" height="19" rx="7" fill="none" stroke="#14213D" strokeWidth="4"/><path d="M46 43h8" stroke="#14213D" strokeWidth="4"/></>}
    {(character === "cat" || character === "fox" || character === "tiger") && <><path d="m47 57 3 3 3-3" fill="#F78DA7" stroke="#14213D" strokeWidth="2"/><path d="M30 62h13m-14 7h14m27-7H57m14 7H57" stroke="#14213D" strokeWidth="2"/></>}
    {(character === "dog" || character === "bear" || character === "panda") && <><ellipse cx="50" cy="65" rx="17" ry="13" fill="#FFFDF7" fillOpacity=".55"/><ellipse cx="50" cy="59" rx="6" ry="5" fill="#14213D"/></>}
    {character === "lion" && <><ellipse cx="50" cy="64" rx="17" ry="14" fill="#FFFDF7" fillOpacity=".45"/><path d="m46 58 4 4 4-4M42 69q8 7 16 0" fill="none" stroke="#14213D" strokeWidth="3"/></>}
    {character === "elephant" && <><path d="M44 57q6-5 12 0v25q-6 10-12 0Z" fill="#8297AB" stroke="#14213D" strokeWidth="3"/><path d="M32 64h-8m44 0h8" stroke="#FFFDF7" strokeWidth="4" strokeLinecap="round"/></>}
    {character === "penguin" && <><path d="M30 28q20-17 40 0l8 56q-28 12-56 0Z" fill="#FFFDF7"/><circle cx="38" cy="45" r="5" fill="#14213D"/><circle cx="62" cy="45" r="5" fill="#14213D"/><path d="m43 57 7 5 7-5-7-6Z" fill="#F6C453" stroke="#14213D" strokeWidth="2"/></>}
    {character === "owl" && <><circle cx="35" cy="46" r="14" fill="#FFFDF7" stroke="#14213D" strokeWidth="3"/><circle cx="65" cy="46" r="14" fill="#FFFDF7" stroke="#14213D" strokeWidth="3"/><circle cx="35" cy="46" r="5" fill="#14213D"/><circle cx="65" cy="46" r="5" fill="#14213D"/><path d="m44 61 6 7 6-7Z" fill="#F6C453"/></>}
    {(character === "wolf" || character === "red-panda") && <><path d="M28 35 40 55 24 65m48-30L60 55l16 10" fill="#FFFDF7" fillOpacity=".7"/><ellipse cx="50" cy="61" rx="6" ry="5" fill="#14213D"/><path d="M42 71q8 6 16 0" fill="none" stroke="#14213D" strokeWidth="3"/></>}
    {character === "koala" && <><ellipse cx="50" cy="59" rx="10" ry="13" fill="#14213D"/><path d="M43 72q7 6 14 0" fill="none" stroke="#14213D" strokeWidth="3"/></>}
    {character === "shark" && <><path d="M34 67q16 15 32 0-16 7-32 0Z" fill="#FFFDF7" stroke="#14213D" strokeWidth="3"/><path d="m40 69 4 6 4-5m4 0 4 5 4-6" fill="#FFFDF7"/></>}
    {character === "dinosaur" && <><circle cx="34" cy="62" r="2" fill="#14213D"/><circle cx="44" cy="64" r="2" fill="#14213D"/><path d="M48 72q12 7 20-2" fill="none" stroke="#14213D" strokeWidth="4"/></>}
    {character === "dragon" && <><path d="m38 56 5 4-5 4m24-8-5 4 5 4" fill="#F6C453"/><path d="M35 72q15 12 30 0" fill="none" stroke="#14213D" strokeWidth="4"/><path d="m44 73 4 7 4-7m4 0 3 6 3-8" fill="#FFFDF7"/></>}
    {character === "rabbit" && <><path d="m46 59 4 4 4-4" fill="#F78DA7"/><path d="M43 67q7 7 14 0" fill="none" stroke="#14213D" strokeWidth="3"/></>}
    {character === "tiger" && <><path d="m39 22 4 13m8-15v14m10-12-4 13" stroke="#14213D" strokeWidth="4"/><path d="m23 53 10 4m44-4-10 4" stroke="#14213D" strokeWidth="4"/></>}
    {(character === "cartoon-kid" || character === "geek" || character === "hero" || character === "explorer" || character === "astronaut" || character === "superhero") && <path d="M41 67q9 10 18 0" fill="none" stroke="#14213D" strokeWidth="4" strokeLinecap="round"/>}
    {character === "pirate" && <path d="M36 68q8 7 16 0" fill="none" stroke="#14213D" strokeWidth="4"/>}
    {character === "frog" && <><circle cx="43" cy="58" r="2" fill="#14213D"/><circle cx="57" cy="58" r="2" fill="#14213D"/><path d="M34 68q16 10 32 0" fill="none" stroke="#14213D" strokeWidth="4"/></>}
    {character === "superhero" && <path d="m50 64 5 9 10 1-7 7 2 7-10-5-10 5 2-7-7-7 10-1Z" fill="#F6C453" stroke="#14213D" strokeWidth="2"/>}
  </>;
}

function EyePair() {
  return <><circle cx="36" cy="46" r="5" fill="#14213D"/><circle cx="64" cy="46" r="5" fill="#14213D"/></>;
}
