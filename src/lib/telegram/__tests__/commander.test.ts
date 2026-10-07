import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseCommand,
  isCommanderChat,
  commanderChatIds,
  telegramConfigured,
  verifyTelegramSecret,
  claimTelegramUpdate,
  allowTelegramCommand,
} from "../commander";

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_COMMANDER_CHAT_IDS;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("parseCommand", () => {
  it("parses a bare command", () => {
    expect(parseCommand("/status")).toEqual({ command: "status", args: [] });
  });

  it("parses a command with args", () => {
    expect(parseCommand("/brain RUN_LOCUM_SEARCH")).toEqual({
      command: "brain",
      args: ["RUN_LOCUM_SEARCH"],
    });
  });

  it("strips the @BotName suffix Telegram adds in groups", () => {
    expect(parseCommand("/status@PassportBot")).toEqual({ command: "status", args: [] });
  });

  it("lowercases the command but preserves arg casing", () => {
    const p = parseCommand("/BRAIN SCALE_FLEET_UP");
    expect(p?.command).toBe("brain");
    expect(p?.args[0]).toBe("SCALE_FLEET_UP");
  });

  it("returns null for non-command text", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe("commanderChatIds / isCommanderChat", () => {
  it("is empty and fails closed when unset", () => {
    expect(commanderChatIds()).toEqual([]);
    expect(isCommanderChat(123)).toBe(false);
  });

  it("matches only allowlisted chat ids", () => {
    process.env.TELEGRAM_COMMANDER_CHAT_IDS = "111, 222 ,333";
    expect(commanderChatIds()).toEqual(["111", "222", "333"]);
    expect(isCommanderChat(222)).toBe(true);
    expect(isCommanderChat("111")).toBe(true);
    expect(isCommanderChat(999)).toBe(false);
    expect(isCommanderChat(undefined)).toBe(false);
  });
});

describe("telegramConfigured", () => {
  it("requires both bot token and webhook secret", () => {
    expect(telegramConfigured()).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    expect(telegramConfigured()).toBe(false);
    process.env.TELEGRAM_WEBHOOK_SECRET = "sec";
    expect(telegramConfigured()).toBe(true);
  });
});

describe("verifyTelegramSecret", () => {
  it("accepts the exact secret and fails closed on mismatch/empty", () => {
    expect(verifyTelegramSecret("abc", "abc")).toBe(true);
    expect(verifyTelegramSecret("abc", "abd")).toBe(false);
    expect(verifyTelegramSecret("", "abc")).toBe(false);
    expect(verifyTelegramSecret("abc", undefined)).toBe(false);
    expect(verifyTelegramSecret(null, "abc")).toBe(false);
  });

  it("does NOT throw on a multibyte input of equal code-unit length", () => {
    // "é" has .length 1 but 2 UTF-8 bytes; the old code threw RangeError here.
    expect(() => verifyTelegramSecret("é", "a")).not.toThrow();
    expect(verifyTelegramSecret("é", "a")).toBe(false);
  });
});

describe("claimTelegramUpdate (webhook idempotency)", () => {
  it("accepts the first sighting and rejects a replay", () => {
    expect(claimTelegramUpdate(9001)).toBe(true);
    expect(claimTelegramUpdate(9001)).toBe(false);
  });

  it("accepts distinct ids and treats a missing id as processable", () => {
    expect(claimTelegramUpdate(9002)).toBe(true);
    expect(claimTelegramUpdate(9003)).toBe(true);
    expect(claimTelegramUpdate(undefined)).toBe(true);
  });
});

describe("allowTelegramCommand (per-chat throttle)", () => {
  it("allows up to the limit then throttles, independently per chat", () => {
    for (let i = 0; i < 20; i++) expect(allowTelegramCommand(770)).toBe(true);
    expect(allowTelegramCommand(770)).toBe(false);
    expect(allowTelegramCommand(771)).toBe(true);
  });
});
