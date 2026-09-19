import { replyToEmail } from "./gmailTools.js";
import { createCalendarEvent } from "./calendarTools.js";

// Definición de herramientas en formato Anthropic tool-use. El modelo solo puede
// hacer estas acciones concretas durante la llamada, nunca ejecutar comandos arbitrarios.
export const tools = [
  {
    name: "reply_to_email",
    description: "Responde al correo del que se está hablando en esta llamada.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string", description: "Texto de la respuesta, en el idioma en que habla el usuario." },
      },
      required: ["body"],
    },
  },
  {
    name: "create_calendar_event",
    description: "Crea un evento en el Google Calendar del usuario.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        startIso: { type: "string", description: "Fecha y hora de inicio en formato ISO 8601." },
        durationMinutes: { type: "number", description: "Duración en minutos. Por defecto 30." },
      },
      required: ["title", "startIso"],
    },
  },
  {
    name: "end_call",
    description: "Termina la llamada porque ya se ha resuelto lo que hacía falta.",
    input_schema: { type: "object", properties: {} },
  },
];

export async function executeTool(name, input, context) {
  switch (name) {
    case "reply_to_email":
      return replyToEmail(context.emailId, input.body);
    case "create_calendar_event":
      return createCalendarEvent(input);
    case "end_call":
      return { ok: true };
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}
