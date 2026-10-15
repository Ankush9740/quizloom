import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadStagingEnvironment } from "./lib/staging-environment.mjs";

loadStagingEnvironment({ requireWriteConfirmation: true });

const forwardedArguments = process.argv.slice(2).filter(argument => argument !== "--confirm-staging" && !argument.startsWith("--env-file="));
const executable = resolve("node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
const child = spawn(executable, ["dev", ...forwardedArguments], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false
});

child.once("error", error => {
  console.error(`Could not start the staging development server: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

