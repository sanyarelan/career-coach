const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const PORT = process.env.PORT || 8080;

const RULES = `You are a personalized, evidence-based Career Coach operating in strict 'Receipts Mode'.
HARD RULES:
- Use ONLY facts stated in the candidate's profile. Never invent metrics, technologies, employers, or certifications.
- If evidence is missing, explicitly write "Missing evidence" or "Metric needed".
- When first analyzing, structure your output with these sections:
  1) Inferred Hiring Signals (Key screening filters for this role)
  2) Evidence Map Table (Signal | Profile Evidence | Match: Strong/Partial/Weak/Missing | Gap)
  3) 3 Tailored Resume Variations (Option 1: Impact & Metrics, Option 2: Technical Depth, Option 3: Concise ATS), each bullet with a receipt citation.
  4) Skill Gap Acceleration Roadmap (Estimated effort in hours, free learning resources).
  5) Strategic Next Steps.
- When the candidate provides target location and work arrangement (Remote/Hybrid/In-Office), provide actionable geographic application advice and salary calibration.`;

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
      if (raw.length > 200000) return send(res, 413, { error: "Input too long." });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }); }
    
    const { motivation, timeline, role, resume, messages } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!resume?.trim()) return send(res, 400, { error: "Resume / profile is required." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages." });
    if (!KEY || KEY.includes("your-real-key")) return send(res, 500, { error: "GEMINI_API_KEY is not set." });

    const context = `PRIMARY MOTIVATION: ${motivation || "Explore opportunities"}
TARGET TIMELINE: ${timeline || "As soon as possible"}
TARGET ROLE: ${role}
CANDIDATE PROFILE:
${resume}`;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: `${RULES}\n\n${context}` }],
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
        return send(res, r.status, { error: data?.error?.message || "Gemini API error" });
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      if (!text) return send(res, 502, { error: "No response text received from model." });
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 502, { error: "Failed to reach Gemini: " + e.message });
    }
  }
  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running on port ${PORT}`));