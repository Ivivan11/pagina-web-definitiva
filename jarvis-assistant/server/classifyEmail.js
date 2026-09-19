import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

// Usa el modelo más barato: esto se llama una vez por cada correo que entra,
// así que el coste debe ser mínimo aunque lleguen muchos correos al día.
export async function classifyEmail({ from, subject, snippet }) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 150,
    system:
      "Decides si un correo es lo bastante importante como para interrumpir a alguien con una llamada de " +
      'teléfono ahora mismo. Responde SOLO con JSON, sin texto alrededor: {"important": boolean, "reason": string}.',
    messages: [
      {
        role: "user",
        content: `De: ${from}\nAsunto: ${subject}\nVista previa: ${snippet}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return { important: false, reason: "No se pudo interpretar la respuesta del clasificador." };
  }
}
