import { randomUUID } from "crypto";

export type EnrollmentSmokePayload = {
  agent_identity: string;
  control_domain: string;
  report: {
    id: string;
    url: string;
    title: string;
  };
  action: string;
  observed_at: string;
};

/**
 * Creates a compliance report payload that is unique for one smoke run.
 */
export function createEnrollmentSmokePayload(): EnrollmentSmokePayload {
  const runId = randomUUID();
  return {
    agent_identity: "smoke.agent.enrollment.v1",
    control_domain: "SMOKE-ENROLL",
    report: {
      id: `smoke-report-${runId}`,
      url: `https://compliance.example.com/reports/smoke/${runId}`,
      title: "Enrollment smoke report",
    },
    action: "report_created",
    observed_at: new Date().toISOString(),
  };
}
