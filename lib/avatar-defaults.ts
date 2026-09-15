import type { AvatarConfig } from "@/lib/types";

export const defaultAvatar: AvatarConfig = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7" };
export const palette = ["#FFB38A", "#8ED1C5", "#9EB4FF", "#F6C453", "#D1A6FF", "#F78DA7"];
export const accents = ["#3155E7", "#FF6846", "#20B486", "#7C4DFF", "#D83A78", "#14213D"];

export const avatarPresets: { name: string; config: AvatarConfig }[] = [
  { name: "Sprout", config: defaultAvatar },
  { name: "Captain", config: { base: "round", skin: "#8ED1C5", eyes: "dot", head: "cap", accessory: "none", accent: "#FF6846" } },
  { name: "Royal", config: { base: "bean", skin: "#D1A6FF", eyes: "wink", head: "crown", accessory: "none", accent: "#14213D" } },
  { name: "Stargazer", config: { base: "round", skin: "#9EB4FF", eyes: "happy", head: "none", accessory: "stars", accent: "#7C4DFF" } },
  { name: "Professor", config: { base: "bot", skin: "#F6C453", eyes: "dot", head: "none", accessory: "glasses", accent: "#3155E7" } },
  { name: "Party", config: { base: "bean", skin: "#F78DA7", eyes: "happy", head: "cap", accessory: "bow", accent: "#20B486" } },
  { name: "Robo", config: { base: "bot", skin: "#9EB4FF", eyes: "wink", head: "none", accessory: "none", accent: "#14213D" } },
  { name: "Garden", config: { base: "round", skin: "#F6C453", eyes: "happy", head: "sprout", accessory: "none", accent: "#20B486" } },
  { name: "Spark", config: { base: "bot", skin: "#FFB38A", eyes: "dot", head: "crown", accessory: "stars", accent: "#D83A78" } },
  { name: "Dapper", config: { base: "round", skin: "#D1A6FF", eyes: "wink", head: "cap", accessory: "glasses", accent: "#F6C453" } },
  { name: "Berry", config: { base: "bean", skin: "#8ED1C5", eyes: "dot", head: "none", accessory: "bow", accent: "#D83A78" } },
  { name: "Comet", config: { base: "bot", skin: "#F78DA7", eyes: "happy", head: "sprout", accessory: "stars", accent: "#7C4DFF" } }
];
