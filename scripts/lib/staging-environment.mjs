import { existsSync, readFileSync } from "node:fs";

export const STAGING_WRITE_CONFIRMATION = "I_ACKNOWLEDGE_THIS_DELETES_STAGING_DATA";

function parseEnvironmentFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /^(replace|your-|example|placeholder)/i.test(value)) throw new Error(`${name} must be set to a non-placeholder staging value`);
  return value;
}

export function projectRefFromSupabaseUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const suffix = ".supabase.co";
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
  } catch {
    return null;
  }
}

export function loadStagingEnvironment({ argv = process.argv.slice(2), requireWriteConfirmation = false } = {}) {
  const envArgument = argv.find(argument => argument.startsWith("--env-file="));
  const envFile = envArgument?.slice("--env-file=".length) || process.env.QUIZLOOM_STAGING_ENV_FILE || ".env.staging.local";
  if (!existsSync(envFile)) throw new Error(`Staging configuration was not found at ${envFile}. Copy .env.staging.example to .env.staging.local first.`);

  // An explicitly selected staging file must win over inherited shell values and
  // over a potentially production-oriented .env.local file loaded by Next.js.
  Object.assign(process.env, parseEnvironmentFile(envFile));

  if (required("QUIZLOOM_ENVIRONMENT") !== "staging") throw new Error("QUIZLOOM_ENVIRONMENT must be exactly staging");
  const stagingProjectRef = required("QUIZLOOM_STAGING_PROJECT_REF").toLowerCase();
  const productionProjectRef = required("QUIZLOOM_PRODUCTION_PROJECT_REF").toLowerCase();
  if (stagingProjectRef === productionProjectRef) throw new Error("The staging and production Supabase project refs must be different");

  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const configuredProjectRef = projectRefFromSupabaseUrl(supabaseUrl);
  if (!configuredProjectRef || configuredProjectRef !== stagingProjectRef) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL does not match QUIZLOOM_STAGING_PROJECT_REF");
  }
  required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  required("SUPABASE_SERVICE_ROLE_KEY");
  required("SESSION_TOKEN_PEPPER");

  const baseUrl = required("QUIZLOOM_TEST_URL").replace(/\/$/, "");
  const parsedBaseUrl = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error("QUIZLOOM_TEST_URL must be an HTTP(S) origin without embedded credentials");
  }

  if (requireWriteConfirmation) {
    if (!argv.includes("--confirm-staging")) throw new Error("Refusing write-capable staging work without --confirm-staging");
    if (required("QUIZLOOM_ALLOW_STAGING_WRITES") !== STAGING_WRITE_CONFIRMATION) {
      throw new Error(`QUIZLOOM_ALLOW_STAGING_WRITES must be exactly ${STAGING_WRITE_CONFIRMATION}`);
    }
  }

  return {
    envFile,
    baseUrl,
    stagingProjectRef,
    supabaseUrl,
    supabaseRegion: process.env.QUIZLOOM_SUPABASE_REGION?.trim() || null
  };
}

