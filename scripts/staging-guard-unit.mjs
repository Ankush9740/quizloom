import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStagingEnvironment, STAGING_WRITE_CONFIRMATION } from "./lib/staging-environment.mjs";

const directory = mkdtempSync(join(tmpdir(), "quizloom-staging-guard-"));
const validPath = join(directory, ".env.staging.local");
const mismatchedPath = join(directory, ".env.mismatched.local");
const common = [
  "QUIZLOOM_ENVIRONMENT=staging",
  "QUIZLOOM_STAGING_PROJECT_REF=stageproject123",
  "QUIZLOOM_PRODUCTION_PROJECT_REF=productionproject456",
  `QUIZLOOM_ALLOW_STAGING_WRITES=${STAGING_WRITE_CONFIRMATION}`,
  "QUIZLOOM_TEST_URL=http://127.0.0.1:3000",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key",
  "SUPABASE_SERVICE_ROLE_KEY=test-service-role-key",
  "SESSION_TOKEN_PEPPER=test-only-long-random-pepper"
];

try {
  writeFileSync(validPath, [...common, "NEXT_PUBLIC_SUPABASE_URL=https://stageproject123.supabase.co"].join("\n"));
  writeFileSync(mismatchedPath, [...common, "NEXT_PUBLIC_SUPABASE_URL=https://productionproject456.supabase.co"].join("\n"));

  assert.throws(
    () => loadStagingEnvironment({ argv: [`--env-file=${validPath}`], requireWriteConfirmation: true }),
    /--confirm-staging/
  );
  const verified = loadStagingEnvironment({ argv: [`--env-file=${validPath}`, "--confirm-staging"], requireWriteConfirmation: true });
  assert.equal(verified.stagingProjectRef, "stageproject123");
  assert.equal(verified.baseUrl, "http://127.0.0.1:3000");
  assert.throws(
    () => loadStagingEnvironment({ argv: [`--env-file=${mismatchedPath}`, "--confirm-staging"], requireWriteConfirmation: true }),
    /does not match/
  );
  console.log("Staging guard unit test passed: explicit acknowledgement and distinct project identity are required before writes.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

