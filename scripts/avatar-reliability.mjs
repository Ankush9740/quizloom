import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = process.cwd();
const cache = new Map();

function resolveSource(specifier, parent) {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

function loadSource(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const loadedModule = { exports: {} };
  cache.set(absolute, loadedModule);
  const source = fs.readFileSync(absolute, "utf8");
  const output = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const localRequire = specifier => {
    const resolved = resolveSource(specifier, absolute);
    return resolved ? loadSource(resolved) : require(specifier);
  };
  vm.runInThisContext(`(function(exports, require, module, __filename, __dirname) {${output}\n})`, { filename: absolute })(loadedModule.exports, localRequire, loadedModule, absolute, path.dirname(absolute));
  return loadedModule.exports;
}

const { defaultAvatar, avatarPresets } = loadSource(path.join(root, "lib/avatar-defaults.ts"));
const { normalizeAvatarConfig, normalizePlayerView } = loadSource(path.join(root, "lib/runtime-normalization.ts"));
const { Avatar } = loadSource(path.join(root, "components/avatar.tsx"));
const { Leaderboard, Podium } = loadSource(path.join(root, "components/leaderboard.tsx"));

const legacyAvatar = { base: "round", skin: "#8ED1C5", eyes: "dot", head: "cap", accessory: "none", accent: "#FF6846" };
const malformedAvatars = [undefined, null, {}, "missing-preset-id", { ...legacyAvatar, base: "triangle" }, { ...legacyAvatar, skin: "red" }, { ...legacyAvatar, character: "copyright-copy" }];
for (const value of malformedAvatars) {
  const normalized = normalizeAvatarConfig(value);
  assert.deepEqual(normalized, { ...defaultAvatar, character: "custom" });
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Avatar, { config: value, size: 42 })));
}

assert.deepEqual(normalizeAvatarConfig(legacyAvatar), { ...legacyAvatar, character: "custom" }, "legacy six-field avatars must remain compatible");
assert.equal(avatarPresets.length, 31);
assert.equal(new Set(avatarPresets.map(preset => preset.config.character)).size, 31, "presets must be visually themed, not duplicate IDs");
for (const preset of avatarPresets) {
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Avatar, { config: preset.config, size: 46 })));
  const recoloredBackdrop = { ...preset.config, accent: "#FF6846" };
  assert.equal(normalizeAvatarConfig(recoloredBackdrop).character, preset.config.character, "backdrop changes must preserve the selected character");
}

let player = normalizePlayerView({ id: "player-1", nickname: "Rapid", avatar_config: legacyAvatar, score: 0, correct_answers: 0, streak: 0 });
for (let score = 1; score <= 500; score += 1) {
  player = normalizePlayerView(score % 2 ? { id: "player-1", score } : { id: "player-1", correct_answers: score / 2 }, player);
  assert.equal(player.avatar.base, "round", "partial realtime updates must retain the existing avatar");
}

const players = [
  player,
  normalizePlayerView({ id: "player-2", nickname: "Missing", avatar_config: undefined, score: undefined }),
  normalizePlayerView({ id: "player-3", nickname: "Legacy", avatar_config: legacyAvatar, score: "12", correct_answers: null, streak: Number.NaN }),
  normalizePlayerView({ id: "player-4", nickname: "Malformed", avatar_config: { base: "broken" }, score: -99 })
];
assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Leaderboard, { players })));
assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Podium, { players })));

console.log("Avatar reliability passed: undefined, null, malformed, legacy, 31 presets with background-only recoloring, 500 rapid partial updates, leaderboard, and podium renders.");
