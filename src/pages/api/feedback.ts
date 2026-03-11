import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const FEEDBACK_FILE = join(process.cwd(), "data", "feedback.json");
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FeedbackEntry {
  timestamp: string;
  type: string;
  name: string;
  klasse: string;
  email: string;
  message: string;
  url: string | null;
  ip: string;
}

async function readFeedback(): Promise<FeedbackEntry[]> {
  try {
    const raw = await fs.readFile(FEEDBACK_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getClientIP(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    const { type, name, klasse, email, message, url, website } = body as {
      type?: string;
      name?: string;
      klasse?: string;
      email?: string;
      message?: string;
      url?: string;
      website?: string; // honeypot
    };

    // Honeypot — bots fill this hidden field
    if (website) {
      // Fake success so bots don't retry
      return json({ success: true });
    }

    // Required fields
    if (!type || !name?.trim() || !klasse?.trim() || !email?.trim() || !message?.trim()) {
      return json({ error: "Alle Felder sind Pflichtfelder." }, 400);
    }

    // Email format
    if (!EMAIL_RE.test(email.trim())) {
      return json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." }, 400);
    }

    // Message length
    if (message.trim().length < 10) {
      return json({ error: "Die Nachricht muss mindestens 10 Zeichen lang sein." }, 400);
    }

    // Valid types
    if (!["lob", "fehler", "vorschlag"].includes(type)) {
      return json({ error: "Ungültiger Feedback-Typ." }, 400);
    }

    const existing = await readFeedback();
    const ip = getClientIP(request);
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;

    // Rate limiting by IP
    const recentFromIP = existing.filter(
      (e) => e.ip === ip && new Date(e.timestamp).getTime() > cutoff
    );
    if (recentFromIP.length >= RATE_LIMIT) {
      return json({ error: "Zu viele Anfragen. Bitte versuche es später erneut." }, 429);
    }

    // Duplicate detection — same message from same email in last hour
    const duplicate = existing.some(
      (e) =>
        e.email === email.trim().toLowerCase() &&
        e.message === message.trim() &&
        new Date(e.timestamp).getTime() > cutoff
    );
    if (duplicate) {
      return json({ error: "Dieses Feedback wurde bereits gesendet." }, 409);
    }

    const entry: FeedbackEntry = {
      timestamp: new Date().toISOString(),
      type,
      name: name.trim().slice(0, 100),
      klasse: klasse.trim().slice(0, 50),
      email: email.trim().toLowerCase().slice(0, 200),
      message: message.trim().slice(0, 2000),
      url: url || null,
      ip,
    };

    existing.push(entry);

    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(FEEDBACK_FILE, JSON.stringify(existing, null, 2), "utf-8");

    return json({ success: true });
  } catch (err) {
    console.error("Feedback error:", err);
    return json({ error: "Interner Serverfehler." }, 500);
  }
};
