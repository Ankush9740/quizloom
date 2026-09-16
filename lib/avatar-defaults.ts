import type { AvatarConfig } from "@/lib/types";

export const defaultAvatar: AvatarConfig = { base: "bean", skin: "#FFB38A", eyes: "happy", head: "sprout", accessory: "none", accent: "#3155E7", character: "custom" };
export const accents = ["#3155E7", "#FF6846", "#20B486", "#7C4DFF", "#D83A78", "#14213D"];

export const avatarPresets: { name: string; config: AvatarConfig }[] = [
  { name: "Miso Cat", config: { base: "round", skin: "#F6C453", eyes: "happy", head: "none", accessory: "none", accent: "#3155E7", character: "cat" } },
  { name: "Biscuit Dog", config: { base: "bean", skin: "#C98B5B", eyes: "dot", head: "none", accessory: "none", accent: "#20B486", character: "dog" } },
  { name: "Pip Panda", config: { base: "round", skin: "#FFFDF7", eyes: "dot", head: "none", accessory: "none", accent: "#F78DA7", character: "panda" } },
  { name: "Flick Fox", config: { base: "round", skin: "#FF8A4C", eyes: "wink", head: "none", accessory: "none", accent: "#7C4DFF", character: "fox" } },
  { name: "Bloop Frog", config: { base: "round", skin: "#62C979", eyes: "happy", head: "none", accessory: "none", accent: "#3155E7", character: "frog" } },
  { name: "Mallow Bear", config: { base: "round", skin: "#A96F4F", eyes: "dot", head: "none", accessory: "none", accent: "#F6C453", character: "bear" } },
  { name: "Hop Rabbit", config: { base: "bean", skin: "#F4DCE8", eyes: "happy", head: "none", accessory: "none", accent: "#20B486", character: "rabbit" } },
  { name: "Zing Tiger", config: { base: "round", skin: "#F6A83B", eyes: "wink", head: "none", accessory: "none", accent: "#14213D", character: "tiger" } },
  { name: "Riff Lion", config: { base: "round", skin: "#F6C453", eyes: "happy", head: "none", accessory: "none", accent: "#7C4DFF", character: "lion" } },
  { name: "Trunket Elephant", config: { base: "round", skin: "#9EB4C7", eyes: "dot", head: "none", accessory: "none", accent: "#F6C453", character: "elephant" } },
  { name: "Pebble Penguin", config: { base: "bean", skin: "#FFFDF7", eyes: "dot", head: "none", accessory: "none", accent: "#8ED1C5", character: "penguin" } },
  { name: "Hoot Owl", config: { base: "round", skin: "#B97850", eyes: "dot", head: "none", accessory: "none", accent: "#3155E7", character: "owl" } },
  { name: "Luma Wolf", config: { base: "round", skin: "#9AA7B8", eyes: "wink", head: "none", accessory: "none", accent: "#D83A78", character: "wolf" } },
  { name: "Koko Koala", config: { base: "round", skin: "#AEB8C4", eyes: "happy", head: "none", accessory: "none", accent: "#20B486", character: "koala" } },
  { name: "Maple Red Panda", config: { base: "round", skin: "#C9603B", eyes: "happy", head: "none", accessory: "none", accent: "#F6C453", character: "red-panda" } },
  { name: "Finn Shark", config: { base: "bean", skin: "#70A9C4", eyes: "dot", head: "none", accessory: "none", accent: "#FF6846", character: "shark" } },
  { name: "Doodle Dino", config: { base: "bean", skin: "#74C96B", eyes: "happy", head: "none", accessory: "none", accent: "#3155E7", character: "dinosaur" } },
  { name: "Sunny Kid", config: { base: "round", skin: "#D99566", eyes: "happy", head: "cap", accessory: "none", accent: "#FF6846", character: "cartoon-kid" } },
  { name: "Dash Hero", config: { base: "bean", skin: "#B97850", eyes: "dot", head: "none", accessory: "none", accent: "#3155E7", character: "hero" } },
  { name: "Pixel Geek", config: { base: "round", skin: "#FFB38A", eyes: "dot", head: "none", accessory: "glasses", accent: "#20B486", character: "geek" } },
  { name: "Nori Ninja", config: { base: "round", skin: "#D89A72", eyes: "wink", head: "none", accessory: "none", accent: "#14213D", character: "ninja" } },
  { name: "Pebble Pirate", config: { base: "bean", skin: "#9A5C3E", eyes: "wink", head: "none", accessory: "none", accent: "#D83A78", character: "pirate" } },
  { name: "Nova Explorer", config: { base: "round", skin: "#8ED1C5", eyes: "happy", head: "none", accessory: "stars", accent: "#3155E7", character: "explorer" } },
  { name: "Orbit Astronaut", config: { base: "round", skin: "#D99566", eyes: "happy", head: "none", accessory: "stars", accent: "#14213D", character: "astronaut" } },
  { name: "Wizzle Wizard", config: { base: "bean", skin: "#D1A6FF", eyes: "happy", head: "none", accessory: "stars", accent: "#7C4DFF", character: "wizard" } },
  { name: "Kip Knight", config: { base: "bot", skin: "#B8C4D6", eyes: "dot", head: "none", accessory: "none", accent: "#FF6846", character: "knight" } },
  { name: "Beep Robot", config: { base: "bot", skin: "#9EB4FF", eyes: "dot", head: "none", accessory: "none", accent: "#14213D", character: "robot" } },
  { name: "Oona Alien", config: { base: "round", skin: "#8ED1C5", eyes: "dot", head: "none", accessory: "none", accent: "#7C4DFF", character: "alien" } },
  { name: "Gumbo Monster", config: { base: "bean", skin: "#D1A6FF", eyes: "happy", head: "none", accessory: "none", accent: "#20B486", character: "monster" } },
  { name: "Ember Dragon", config: { base: "bean", skin: "#62B86B", eyes: "wink", head: "none", accessory: "none", accent: "#FF6846", character: "dragon" } },
  { name: "Bolt Superhero", config: { base: "round", skin: "#C9825B", eyes: "dot", head: "none", accessory: "none", accent: "#D83A78", character: "superhero" } }
];
