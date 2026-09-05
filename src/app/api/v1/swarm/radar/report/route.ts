import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest, rateLimitResponse } from "@/lib/rateLimit";
import { reportThreat } from "@/lib/swarm/swarm-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = clientIpFromRequest(request.headers);
  const rate = await checkRateLimit(`swarm:radar:report:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, rateLimitResponse(rate, 30));
  }

  try {
    const body = await request.json();

    const reporterCommitment = body.reporter_commitment || body.reporterCommitment;
    const targetDomain = body.target_domain || body.targetDomain;
    const threatType = body.threat_type || body.threatType;
    const details = body.details;
    const evidenceDigest = body.evidence_digest || body.evidenceDigest;
    const signature = body.signature;
    const publicKey = body.public_key || body.publicKey;

    if (!reporterCommitment || !targetDomain || !threatType || !evidenceDigest || !signature) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: reporter_commitment, target_domain, threat_type, evidence_digest, signature",
        },
        { status: 400 }
      );
    }

    const report = await reportThreat({
      reporterCommitment,
      targetDomain,
      threatType,
      details,
      evidenceDigest,
      signature,
      publicKey,
    });

    return NextResponse.json(
      {
        success: true,
        report_id: report.id,
        threat_type: report.threatType,
        bounty_awarded_angel: report.bountyAwarded,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("public key") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
