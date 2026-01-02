import ky from "ky";
import { z } from "zod";
import { toast } from "sonner";

const suggestionRequestSchema = z.object({
  fileName: z.string(),
  code: z.string(),
  currentLine: z.string(),
  previousLines: z.string(),
  textBeforeCursor: z.string(),
  textAfterCursor: z.string(),
  nextLines: z.string(),
  lineNumber: z.number(),
});

const suggestionResponseSchema = z.object({
  suggestion: z.string(),
});

type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;
type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

export const fetcher = async (
  payload: SuggestionRequest,
  signal: AbortSignal,
): Promise<string | null> => {
  try {
    const validatedPayload = suggestionRequestSchema.parse(payload);

    const response = await ky
      .post("/api/suggestion", {
        json: validatedPayload,
        signal,
        timeout: 10_000,
        retry: 0,
      })
      .json<SuggestionResponse>();

    const validatedResponse = suggestionResponseSchema.parse(response);

    return validatedResponse.suggestion || null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return null;
    }
    toast.error("Failed to fetch AI completion");
    return null;
  }
};
