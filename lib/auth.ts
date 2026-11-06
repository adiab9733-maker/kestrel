/** Single shared password gate. Disabled when KESTREL_PASSWORD is unset (local dev). */
export const COOKIE = "kestrel_session";

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`kestrel:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
