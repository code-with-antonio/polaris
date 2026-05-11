import { eventType, staticSchema } from "inngest";

import { Id } from "../../convex/_generated/dataModel";

export const messageSent = eventType("message/sent", {
  schema: staticSchema<{
    messageId: Id<"messages">;
    conversationId: Id<"conversations">;
    projectId: Id<"projects">;
    message: string;
  }>(),
});

export const messageCancel = eventType("message/cancel", {
  schema: staticSchema<{
    messageId: Id<"messages">;
  }>(),
});

export const githubImportRepo = eventType("github/import.repo", {
  schema: staticSchema<{
    owner: string;
    repo: string;
    projectId: Id<"projects">;
    githubToken: string;
  }>(),
});

export const githubExportRepo = eventType("github/export.repo", {
  schema: staticSchema<{
    projectId: Id<"projects">;
    repoName: string;
    visibility: "public" | "private";
    description?: string;
    githubToken: string;
  }>(),
});

export const githubExportCancel = eventType("github/export.cancel", {
  schema: staticSchema<{
    projectId: Id<"projects">;
  }>(),
});

export const demoGenerateRequested = eventType("demo/generate", {
  schema: staticSchema<{
    prompt: string;
  }>(),
});

export const demoErrorRequested = eventType("demo/error");
