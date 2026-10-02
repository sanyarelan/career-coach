const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const PORT = process.env.PORT || 8080;

const RULES = `You are a career coach that helps a candidate reason about the hiring process for their target role.
HARD RULES:
- Use ONLY facts stated in the candidate's resume/profile. Never invent experience, metrics, employers, certifications, or technologies.
- If the resume lacks evidence for something, say "Missing evidence" rather than filling the gap.
- No job description is provided; hiring signals are INFERRED from the target role. Label them as inference.
- Never claim an interview question came from a specific company.
- If a resume bullet needs a number the candidate did not give, write "Metric needed" instead of a number.
When first analyzing, produce these sections in Markdown:
1) Inferred hiring signals
2) Evidence map (table: signal | evidence from resume | match: Strong/Partial/Weak/Missing | gap)
3) Why You (why this role, why this candidate, proof, biggest concern, how to address it honestly)
4) 3 resume bullets (Action + Context + Skill + Result), each with a receipt status (Verified / Needs metric) and the resume line it comes from
5) Skill gaps with realistic next steps and effort estimates (explicitly state they are estimates)
6) A 2-week interview prep plan.
For follow-up questions, answer conversationally under the same rules.`;

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, "index.html")), "text/html");
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 200000) return send(res, 413, { error: "Input too long (limit ~200k characters)." });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }); }
    const { role, resume, messages } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!resume?.trim()) return send(res, 400, { error: "Resume / profile is required." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages." });
    if (!KEY || KEY.includes("your-real-key")) return send(res, 500, { error: "GEMINI_API_KEY is not set." });

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: `${RULES}\n\nTARGET ROLE: ${role}\n\nCANDIDATE RESUME / PROFILE:\n${resume}` }],
            },
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: String(m.content) }],
            })),
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) {
        const msg = r.status === 429 ? "Rate limited. Wait a moment and retry." : data?.error?.message || "Gemini API error";
        return send(res, r.status, { error: msg });
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      if (!text) return send(res, 502, { error: "The model returned no text (it may have been blocked). Try rephrasing." });
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 502, { error: "Could not reach the Gemini API: " + e.message });
    }
  }
  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running at http://localhost:${PORT} (model: ${MODEL})`));