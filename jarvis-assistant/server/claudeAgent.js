import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "./tools/index.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

// Una conversación por llamada activa (CallSid de Twilio -> estado).
const conversations = new Map();

export function startConversation(callSid, systemPrompt, context) {
  conversations.set(callSid, { system: systemPrompt, messages: [], context });
}

export function endConversation(callSid) {
  conversations.delete(callSid);
}

export async function converse(callSid, userText) {
  const convo = conversations.get(callSid);
  if (!convo) throw new Error(`No hay conversación activa para la llamada ${callSid}`);

  convo.messages.push({ role: "user", content: userText });

  let hangUp = false;
  let response = await createMessage(convo);

  while (response.stop_reason === "tool_use") {
    convo.messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "end_call") hangUp = true;

      const result = await executeTool(block.name, block.input, convo.context);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    convo.messages.push({ role: "user", content: toolResults });
    response = await createMessage(convo);
  }

  convo.messages.push({ role: "assistant", content: response.content });
  const textBlock = response.content.find((block) => block.type === "text");

  return { text: textBlock?.text ?? "Vale, hasta luego.", hangUp };
}

function createMessage(convo) {
  return anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: convo.system,
    messages: convo.messages,
    tools,
  });
}
