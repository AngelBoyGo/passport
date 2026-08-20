/**
 * Cloudflare Turnstile bot protection verification.
 */
export async function verifyTurnstileToken(token: string): Promise<{ success: boolean }> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // Bot protection not configured — allow through
    return { success: true };
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }),
    });
    const data = await res.json();
    return { success: data.success === true };
  } catch {
    return { success: false };
  }
}
