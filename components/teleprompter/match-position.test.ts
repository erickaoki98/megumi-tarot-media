import { describe, it, expect } from "vitest";
import { normalize, tokenize, matchPosition } from "./match-position";

describe("normalize", () => {
  it("lowercases and strips accents + punctuation", () => {
    expect(normalize("Olá,")).toBe("ola");
    expect(normalize("AÇÃO!")).toBe("acao");
  });
});

describe("tokenize", () => {
  it("splits into normalized tokens, keeping raw", () => {
    const t = tokenize("Olá pessoal, tudo bem?");
    expect(t.map((x) => x.norm)).toEqual(["ola", "pessoal", "tudo", "bem"]);
    expect(t[0].raw).toBe("Olá");
  });
});

describe("matchPosition", () => {
  const script = tokenize("olá pessoal tudo bem hoje vou falar de tarot");

  it("advances to the next word on exact speech", () => {
    expect(matchPosition(script, ["olá", "pessoal", "tudo", "bem"], 0)).toBe(4);
  });
  it("tolerates a skipped word", () => {
    expect(matchPosition(script, ["olá", "tudo", "bem"], 0)).toBe(4);
  });
  it("tolerates a misrecognized last word", () => {
    expect(matchPosition(script, ["olá", "pessoal", "tudo", "xpto"], 0)).toBe(4);
  });
  it("stays put when nothing matches", () => {
    expect(matchPosition(script, ["banana", "abacaxi"], 0)).toBe(0);
  });
  it("does not jump far on a single common word", () => {
    expect(matchPosition(script, ["bem"], 0)).toBe(0);
  });
  it("keeps progressing from a mid-script position", () => {
    expect(matchPosition(script, ["hoje", "vou", "falar"], 4)).toBe(7);
  });
});
