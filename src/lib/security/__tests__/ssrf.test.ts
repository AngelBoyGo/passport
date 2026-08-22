import { describe, it, expect } from "vitest";
import { validateWebhookUrl, isUnsafeWebhookHost } from "@/lib/security/ssrf";

describe("SSRF guard for outbound webhook delivery", () => {
  it("accepts legitimate public HTTPS endpoints", () => {
    expect(validateWebhookUrl("https://hooks.example.com/evt")).toBeNull();
    expect(validateWebhookUrl("https://gateway.datacet.dev/ingest")).toBeNull();
    expect(validateWebhookUrl("http://10.tunnel.example.com")).toBeNull();
  });

  it("rejects loopback / localhost targets", () => {
    expect(validateWebhookUrl("http://localhost:9000/webhook")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://127.0.0.1:7000/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://[::1]/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://myhost.local/x")).toMatch(/unsafe|private/i);
  });

  it("rejects private and link-local IPv4 ranges", () => {
    expect(validateWebhookUrl("http://10.0.0.5/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://172.16.4.1/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://192.168.1.1/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("http://100.64.0.1/x")).toMatch(/unsafe|private/i);
  });

  it("rejects cloud instance metadata hostnames", () => {
    expect(validateWebhookUrl("http://metadata.google.internal/computeMetadata/v1/")).toMatch(/unsafe|private/i);
  });

  it("rejects non-http(s) protocols and bare hostnames", () => {
    expect(validateWebhookUrl("file:///etc/passwd")).toMatch(/http/i);
    expect(validateWebhookUrl("ftp://example.com/x")).toMatch(/http/i);
    expect(validateWebhookUrl("http://internal-service/x")).toMatch(/unsafe|private/i);
    expect(validateWebhookUrl("not-a-url")).toMatch(/parseable/i);
  });

  it("host classifier flags metadata and reserved IPv6", () => {
    expect(isUnsafeWebhookHost("metadata.google.internal")).toBe(true);
    expect(isUnsafeWebhookHost("fd00:ec2::254")).toBe(true);
    expect(isUnsafeWebhookHost("fc00::1")).toBe(true);
    expect(isUnsafeWebhookHost("example.com")).toBe(false);
  });
});