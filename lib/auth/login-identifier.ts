export type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "login-id"; value: string };

const LOGIN_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;

export function normalizeLoginIdentifier(input: unknown): LoginIdentifier | null {
  if (typeof input !== "string") return null;
  if ([...input].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) return null;
  const value = input.trim();
  if (!value || value.length > 254) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(email) ? { kind: "email", value: email } : null;
  }
  const loginId = value.toUpperCase();
  return LOGIN_ID_PATTERN.test(loginId) ? { kind: "login-id", value: loginId } : null;
}
