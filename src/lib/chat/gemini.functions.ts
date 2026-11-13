import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().min(1).max(8000) })).min(1).max(40),
});

export const askGemini = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = (process.env['GEMINI_API_KEY'] ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (!key) return { ok: false as const, error: "Chưa cấu hình GEMINI_API_KEY." };
    const call = (model: string) => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "Bạn là trợ lý AI thân thiện của ứng dụng AI Vision Drive. Trả lời bằng tiếng Việt, NGẮN GỌN: chỉ nói ý chính đúng câu hỏi, thường 1-4 câu hoặc tối đa 5 gạch đầu dòng ngắn. Không mở bài, không lặp lại câu hỏi, không giải thích thừa. Không dùng markdown (#, **, ---). Dùng xuống dòng và gạch đầu dòng \"- \" khi liệt kê. Chỉ trả lời dài khi người dùng yêu cầu chi tiết." }] },
          contents: data.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { temperature: 0.5, maxOutputTokens: 600 },
        }),
      },
    );
    let res: Response;
    try { res = await call("gemini-3.5-flash-lite"); } catch { return { ok: false as const, error: "Không kết nối được Gemini, thử lại." }; }
    if (res.status === 503 || res.status === 429 || res.status === 404 || res.status === 500) { res = await call("gemini-3.1-flash-lite"); }
    if (!res.ok) {
      const t = await res.text();
      console.error("Gemini error", res.status, t.slice(0, 300));
      const keyBad = /API[_ ]?key|API_KEY_INVALID|PERMISSION_DENIED|unregistered callers/i.test(t);
      return { ok: false as const, error: res.status === 429 || res.status === 503 ? "Gemini đang quá tải hoặc hết hạn mức, thử lại sau." : keyBad ? "Khóa Gemini không hợp lệ hoặc đã bị thu hồi — hãy cập nhật GEMINI_API_KEY." : `Lỗi Gemini (${res.status}), thử lại.` };
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return text ? { ok: true as const, text } : { ok: false as const, error: "AI không trả lời được câu này." };
  });
