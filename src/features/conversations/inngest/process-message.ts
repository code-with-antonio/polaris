import { createAgent, createNetwork } from "@inngest/agent-kit";

import { inngest } from "@/inngest/client";
import {
  GROQ_MODEL_ID,
  GROQ_TITLE_MODEL_ID,
  buildGeminiAgentModel,
  buildGroqAgentModel,
  isQuotaError,
  isRetryableAiError,
} from "@/lib/ai-providers";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  TITLE_GENERATOR_SYSTEM_PROMPT,
} from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { createReadFilesTool } from "./tools/read-files";
import { createListFilesTool } from "./tools/list-files";
import { createUpdateFileTool } from "./tools/update-file";
import { createCreateFilesTool } from "./tools/create-files";
import { createCreateFolderTool } from "./tools/create-folder";
import { createRenameFileTool } from "./tools/rename-file";
import { createDeleteFilesTool } from "./tools/delete-files";
import { createScrapeUrlsTool } from "./tools/scrape-urls";

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;
      const internalKey = process.env.PLEX_CONVEX_INTERNAL_KEY;

      // Update the message with error content
      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
          });
        });
      }
    },
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const { messageId, conversationId, projectId, message } =
      event.data as MessageEvent;

    const internalKey = process.env.PLEX_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      throw new NonRetriableError(
        "PLEX_CONVEX_INTERNAL_KEY is not configured",
      );
    }

    // TODO: Check if this is needed
    await step.sleep("wait-for-db-sync", "1s");

    // Get conversation for title generation check
    const conversation = await step.run("get-conversation", async () => {
      return await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId,
      });
    });

    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    // Fetch recent messages for conversation context
    const recentMessages = await step.run("get-recent-messages", async () => {
      return await convex.query(api.system.getRecentMessages, {
        internalKey,
        conversationId,
        limit: 10,
      });
    });

    // Build system prompt with conversation history (exclude the current processing message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    // Filter out the current processing message and empty messages
    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== "",
    );

    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");

      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses):\n${historyText}\n\n## Current Request:\nRespond ONLY to the user's new message below. Do not repeat or reference your previous responses.`;
    }

    // Generate conversation title if it's still the default
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;

    type AgentModel =
      | ReturnType<typeof buildGeminiAgentModel>
      | ReturnType<typeof buildGroqAgentModel>;

    const groqConfigured = !!process.env.GROQ_API_KEY;

    const runTitleAgent = async (model: AgentModel) => {
      const titleAgent = createAgent({
        name: "title-generator",
        system: TITLE_GENERATOR_SYSTEM_PROMPT,
        model,
      });

      const { output } = await titleAgent.run(message, { step });

      const textMessage = output.find(
        (m) => m.type === "text" && m.role === "assistant",
      );

      if (textMessage?.type === "text") {
        const title =
          typeof textMessage.content === "string"
            ? textMessage.content.trim()
            : textMessage.content
                .map((c) => c.text)
                .join("")
                .trim();

        if (title) {
          await step.run("update-conversation-title", async () => {
            await convex.mutation(api.system.updateConversationTitle, {
              internalKey,
              conversationId,
              title,
            });
          });
        }
      }
    };

    if (shouldGenerateTitle) {
      // Title is cosmetic - never let it kill the whole reply (e.g. on 429).
      try {
        await runTitleAgent(
          buildGeminiAgentModel({ temperature: 0, maxOutputTokens: 50 }),
        );
      } catch (error) {
        if (!isRetryableAiError(error) || !groqConfigured) {
          console.warn("Title generation skipped:", error);
        } else {
          console.warn(
            "Gemini title failed with retryable error, falling back to Groq once.",
            error,
          );
          try {
            await runTitleAgent(
              buildGroqAgentModel(GROQ_TITLE_MODEL_ID, {
                temperature: 0,
                maxTokens: 50,
              }),
            );
          } catch (fallbackError) {
            console.warn(
              "Groq title fallback also failed, skipping title.",
              fallbackError,
            );
          }
        }
      }
    }

    // Runs the coding agent on the given provider model and returns its text.
    const runCodingNetwork = async (model: AgentModel): Promise<string> => {
      const codingAgent = createAgent({
        name: "plex",
        description: "An expert AI coding assistant",
        system: systemPrompt,
        model,
        tools: [
          createListFilesTool({ internalKey, projectId }),
          createReadFilesTool({ internalKey }),
          createUpdateFileTool({ internalKey }),
          createCreateFilesTool({ projectId, internalKey }),
          createCreateFolderTool({ projectId, internalKey }),
          createRenameFileTool({ internalKey }),
          createDeleteFilesTool({ internalKey }),
          createScrapeUrlsTool(),
        ],
      });

      // NOTE: free-tier Gemini allows ~20 requests/day, and each iteration
      // costs at least one. Keep maxIter low so one reply can't eat the day.
      const network = createNetwork({
        name: "plex-network",
        agents: [codingAgent],
        maxIter: 10,
        router: ({ network }) => {
          const lastResult = network.state.results.at(-1);
          const hasTextResponse = lastResult?.output.some(
            (m) => m.type === "text" && m.role === "assistant",
          );
          const hasToolCalls = lastResult?.output.some(
            (m) => m.type === "tool_call",
          );

          // Models may output text AND tool calls together.
          // Only stop if there's text WITHOUT tool calls (final response)
          if (hasTextResponse && !hasToolCalls) {
            return undefined;
          }
          return codingAgent;
        },
      });

      const result = await network.run(message);

      // Extract the assistant's text response from the last agent result
      const lastResult = result.state.results.at(-1);
      const textMessage = lastResult?.output.find(
        (m) => m.type === "text" && m.role === "assistant",
      );

      if (textMessage?.type === "text") {
        return typeof textMessage.content === "string"
          ? textMessage.content
          : textMessage.content.map((c) => c.text).join("");
      }

      return "I processed your request. Let me know if you need anything else!";
    };

    // Gemini first; on retryable errors (429/quota, 5xx, retired model)
    // fall back to Groq exactly once. Never retried in a loop.
    let assistantResponse: string;
    try {
      assistantResponse = await runCodingNetwork(
        buildGeminiAgentModel({ temperature: 0.3, maxOutputTokens: 8192 }),
      );
    } catch (error) {
      if (!isRetryableAiError(error)) throw error;

      if (!groqConfigured) {
        console.warn(
          "Gemini failed with retryable error and GROQ_API_KEY is not configured, skipping Groq fallback.",
          error,
        );
        if (isQuotaError(error)) {
          assistantResponse =
            "I'm out of Gemini API quota for today (free tier allows ~20 requests/day, and each agentic step uses one). " +
            "Usage resets daily - check https://ai.dev/rate-limit - or add billing to your Google AI project for higher limits. " +
            "You can also add a GROQ_API_KEY to .env.local so I fall back to Groq automatically next time. " +
            "Your project and files are safe; just send your message again once quota resets.";
        } else {
          throw error;
        }
      } else {
        console.warn(
          "Gemini coding agent failed with retryable error, falling back to Groq once.",
          error,
        );
        try {
          assistantResponse = await runCodingNetwork(
            buildGroqAgentModel(GROQ_MODEL_ID, {
              temperature: 0.3,
              maxTokens: 8192,
            }),
          );
        } catch (fallbackError) {
          console.error("Groq fallback also failed:", fallbackError);
          if (isQuotaError(error) || isQuotaError(fallbackError)) {
            assistantResponse =
              "Both AI providers are unavailable right now (Gemini is out of its daily free quota and the Groq fallback also failed). " +
              "Usage resets daily - check https://ai.dev/rate-limit - or add billing for higher limits. " +
              "Your project and files are safe; just send your message again later.";
          } else {
            throw fallbackError;
          }
        }
      }
    }

    // Update the assistant message with the response (this also sets status to completed)
    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: assistantResponse,
      });
    });

    return { success: true, messageId, conversationId };
  },
);
