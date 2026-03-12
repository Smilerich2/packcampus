import type { APIRoute } from "astro";

const SITE_PASSWORD = process.env.SITE_PASSWORD || "lernen2024";

export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData();
  const password = form.get("password")?.toString() || "";

  if (password !== SITE_PASSWORD) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/?error=1" },
    });
  }

  cookies.set("site_access", "granted", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return new Response(null, {
    status: 302,
    headers: { Location: "/" },
  });
};
