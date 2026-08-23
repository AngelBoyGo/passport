import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateApiKeyMock = vi.fn();
const createApiKeyMock = vi.fn();
const apiKeyFindManyMock = vi.fn();
const apiKeyFindUniqueMock = vi.fn();
const apiKeyCreateMock = vi.fn();
const apiKeyDeleteMock = vi.fn();

vi.mock("@/lib/operator", () => ({
  authenticateApiKey: (...args: unknown[]) => authenticateApiKeyMock(...args),
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findMany: (...args: unknown[]) => apiKeyFindManyMock(...args),
      findUnique: (...args: unknown[]) => apiKeyFindUniqueMock(...args),
      create: (...args: unknown[]) => apiKeyCreateMock(...args),
      delete: (...args: unknown[]) => apiKeyDeleteMock(...args),
    },
  },
}));

const operator = { id: "op_test_cuid", stripeCustomerId: "cus_test" };

beforeEach(() => {
  vi.resetModules();
  authenticateApiKeyMock.mockReset();
  createApiKeyMock.mockReset();
  apiKeyFindManyMock.mockReset();
  apiKeyFindUniqueMock.mockReset();
  apiKeyCreateMock.mockReset();
  apiKeyDeleteMock.mockReset();
  authenticateApiKeyMock.mockResolvedValue(operator);
});

describe("GET /api/v1/operator/api-keys", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/v1/operator/api-keys/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys");
    const response = await GET(request as never);
    expect(response.status).toBe(401);
  });

  it("returns list of API keys", async () => {
    const keys = [
      { id: "k1", keyHash: "hash1", name: "prod", createdAt: new Date() },
      { id: "k2", keyHash: "hash2", name: "dev", createdAt: new Date() },
    ];
    apiKeyFindManyMock.mockResolvedValue(keys);
    const { GET } = await import("@/app/api/v1/operator/api-keys/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys", {
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await GET(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("prod");
    expect(body[0].keyHash).toBe("hash1");
    expect(body[0]).not.toHaveProperty("rawKey");
  });
});

describe("POST /api/v1/operator/api-keys", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/operator/api-keys/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-key" }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(401);
  });

  it("creates a new API key and returns raw key once", async () => {
    createApiKeyMock.mockResolvedValue("pp_new_raw_key_abc123");
    const { POST } = await import("@/app/api/v1/operator/api-keys/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys", {
      method: "POST",
      headers: {
        Authorization: "Bearer pp_test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "test-key" }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.rawKey).toBe("pp_new_raw_key_abc123");
    expect(body.name).toBe("test-key");
    expect(createApiKeyMock).toHaveBeenCalledWith("op_test_cuid", "test-key", "ISSUER");
  });

  it("creates key without name", async () => {
    createApiKeyMock.mockResolvedValue("pp_new_raw_key_def456");
    const { POST } = await import("@/app/api/v1/operator/api-keys/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys", {
      method: "POST",
      headers: {
        Authorization: "Bearer pp_test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(201);
  });
});

describe("DELETE /api/v1/operator/api-keys/:keyHash", () => {
  it("returns 401 when not authenticated", async () => {
    authenticateApiKeyMock.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/v1/operator/api-keys/[keyHash]/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys/hash1", {
      method: "DELETE",
    });
    const response = await DELETE(request as never, {
      params: Promise.resolve({ keyHash: "hash1" }),
    });
    expect(response.status).toBe(401);
  });

  it("deletes an API key by keyHash", async () => {
    apiKeyFindUniqueMock.mockResolvedValue({ operatorId: "op_test_cuid" });
    apiKeyDeleteMock.mockResolvedValue({ id: "k1", keyHash: "hash1" });
    const { DELETE } = await import("@/app/api/v1/operator/api-keys/[keyHash]/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys/hash1", {
      method: "DELETE",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await DELETE(request as never, {
      params: Promise.resolve({ keyHash: "hash1" }),
    });
    expect(response.status).toBe(204);
    expect(apiKeyDeleteMock).toHaveBeenCalledWith({
      where: { keyHash: "hash1" },
    });
  });

  it("returns 404 for nonexistent key", async () => {
    apiKeyFindUniqueMock.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/v1/operator/api-keys/[keyHash]/route");
    const request = new Request("http://localhost/api/v1/operator/api-keys/missing", {
      method: "DELETE",
      headers: { Authorization: "Bearer pp_test" },
    });
    const response = await DELETE(request as never, {
      params: Promise.resolve({ keyHash: "missing" }),
    });
    expect(response.status).toBe(404);
  });
});