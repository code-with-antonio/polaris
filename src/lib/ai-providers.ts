/**
 * Server-only AI provider configuration.
 *
 * Uses secret API keys (GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY).
 * NEVER import this module from client components.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { gemini, openai } from "@inngest/agent-kit";

/** Primary provider model (Google AI Studio / Gemini API). */
export const GEMINI_MODEL_ID = "gemini-3.6-flash";

/** Fallback provider model (Groq, OpenAI-compatible). Strong reasoning + tool calling. */
export const GROQ_MODEL_ID = "openai/gpt-oss-120b";

/** Small fallback model for cheap tasks like title generation. */
export const GROQ_TITLE_MODEL_ID = "openai/gpt-oss-20b";

/** Base URL for Groq's OpenAI-compatible API. */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export type AiProvider = "gemini" | "groq";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Errors that must never trigger a provider fallback. */
const NON_RETRYABLE_PATTERN =
  /\b(401|403)\b|unauthorized|forbidden|invalid api key|invalid_api_key|\babort(ed)?\b|user abort|validation|invalid argument|invalid_argument/i;

/** Errors that mean "this provider can't serve the request right now, try the other one". */
const RETRYABLE_PATTERN =
  /\b(408|425|429|500|502|503|504|529)\b|rate.?limit|quota|resource.?exhausted|overloaded|over capacity|temporar(y|ily)|try again|timeout|timed out|fetch failed|network|socket|econn|etimedout|server error|bad gateway|service unavailable|gateway timeout|model.+not found|not found.+model|no longer available|model_not_found|unsupported model/i;

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["statusCode", "status"]) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "";
  }
}

/**
 * Returns true when a failed Gemini call is worth retrying once on Groq:
 * rate limits / quota (429), overloaded / 5xx, timeouts / network issues,
 * or model-availability errors (retired model ID, 404).
 * Auth errors (401/403), bad-request errors (400 validation) and aborts
 * return false - Groq would fail the same way, or must not be called.
 */
export function isRetryableAiError(error: unknown): boolean {
  const status = getStatusCode(error);
  if (status === 401 || status === 403) return false;
  const message = getMessage(error);
  if (NON_RETRYABLE_PATTERN.test(message)) return false;
  if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) return true;
  return RETRYABLE_PATTERN.test(message);
}

/** True when the error is specifically a quota / rate-limit exhaustion. */
export function isQuotaError(error: unknown): boolean {
  return /429|quota|rate.?limit|resource.?exhausted/i.test(getMessage(error));
}

/** Resolves a Vercel AI SDK model for the given provider. */
export function resolveTextModel(provider: AiProvider, modelId?: string) {
  return provider === "gemini"
    ? google(modelId ?? GEMINI_MODEL_ID)
    : groq(modelId ?? GROQ_MODEL_ID);
}

/**
 * Runs `run` on Gemini first. Only if Gemini fails with a retryable error
 * (429/rate-limit/quota, 5xx, timeout, retired model) it runs the SAME
 * callback once for Groq. Groq is never called when Gemini succeeds,
 * and neither provider is retried in a loop.
 *
 * Throws a clean Error (original attached as `cause`) when both fail.
 */
export async function withGroqFallback<T>(
  run: (provider: AiProvider) => Promise<T>,
): Promise<T> {
  try {
    return await run("gemini");
  } catch (error) {
    if (!isRetryableAiError(error)) {
      console.error(
        "withGroqFallback: Gemini failed with non-retryable error, skipping Groq fallback.",
        error,
      );
      throw new Error("AI request failed. Please try again.", {
        cause: error,
      });
    }

    console.warn(
      "withGroqFallback: Gemini failed with retryable error, falling back to Groq once.",
      error,
    );
    try {
      return await run("groq");
    } catch (fallbackError) {
      console.error(
        "withGroqFallback: Groq fallback also failed.",
        fallbackError,
      );
      throw new Error(
        "AI service temporarily unavailable. Please try again.",
        { cause: fallbackError },
      );
    }
  }
}

function geminiApiKey(): string | undefined {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY
  );
}

/** Agent-kit model for the primary (Gemini) provider. */
export function buildGeminiAgentModel(params: {
  temperature: number;
  maxOutputTokens: number;
}) {
  return gemini({
    model: GEMINI_MODEL_ID,
    apiKey: geminiApiKey(),
    defaultParameters: {
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxOutputTokens,
      },
    },
  });
}

/** Agent-kit model for the Groq fallback via its OpenAI-compatible endpoint. */
export function buildGroqAgentModel(
  modelId: string,
  params: { temperature: number; maxTokens: number },
) {
  return openai({
    model: modelId,
    baseUrl: GROQ_BASE_URL,
    apiKey: process.env.GROQ_API_KEY,
    defaultParameters: {
      temperature: params.temperature,
      max_completion_tokens: params.maxTokens,
    },
  });
}
