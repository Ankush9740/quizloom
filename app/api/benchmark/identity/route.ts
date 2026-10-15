const WRITE_CONFIRMATION = "I_ACKNOWLEDGE_THIS_DELETES_STAGING_DATA";

function projectRefFromSupabaseUrl(value: string | undefined) {
  try {
    const hostname = new URL(value ?? "").hostname.toLowerCase();
    const suffix = ".supabase.co";
    return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.QUIZLOOM_ENVIRONMENT !== "staging") {
    return Response.json({ error: "Not found" }, { status: 404, headers });
  }

  const projectRef = projectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const expectedRef = process.env.QUIZLOOM_STAGING_PROJECT_REF?.trim().toLowerCase();
  if (!projectRef || !expectedRef || projectRef !== expectedRef) {
    return Response.json({ error: "Staging identity is not configured correctly" }, { status: 503, headers });
  }

  return Response.json({
    environment: "staging",
    projectRef,
    benchmarkWritesEnabled: process.env.QUIZLOOM_ALLOW_STAGING_WRITES === WRITE_CONFIRMATION,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    supabaseRegion: process.env.QUIZLOOM_SUPABASE_REGION ?? null
  }, { headers });
}

