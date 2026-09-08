import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { DEFAULT_CONVERSATION_TITLE } from "@/features/conversations/constants";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  prompt: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const internalKey = process.env.PLEX_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      console.error("create-with-prompt: PLEX_CONVEX_INTERNAL_KEY missing");
      return NextResponse.json(
        { error: "Internal key not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { prompt } = requestSchema.parse(body);

    // Generate a random project name
    const projectName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      separator: "-",
      length: 3,
    });

    // Create project and conversation together
    let projectId: Id<"projects">;
    let conversationId: Id<"conversations">;
    try {
      const created = await convex.mutation(
        api.system.createProjectWithConversation,
        {
          internalKey,
          projectName,
          conversationTitle: DEFAULT_CONVERSATION_TITLE,
          ownerId: userId,
        },
      );
      projectId = created.projectId;
      conversationId = created.conversationId;
    } catch (error) {
      console.error("create-with-prompt: createProjectWithConversation failed:", error);
      return NextResponse.json(
        { error: "Failed to create project in database. Check PLEX_CONVEX_INTERNAL_KEY matches Convex backend and NEXT_PUBLIC_CONVEX_URL is correct." },
        { status: 500 }
      );
    }

    // Create user message
    try {
      await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId,
        projectId,
        role: "user",
        content: prompt,
      });
    } catch (error) {
      console.error("create-with-prompt: create user message failed:", error);
      return NextResponse.json(
        { error: "Project created but failed to save message." },
        { status: 500 }
      );
    }

    // Create assistant message placeholder with processing status
    let assistantMessageId: Id<"messages">;
    try {
      assistantMessageId = await convex.mutation(
        api.system.createMessage,
        {
          internalKey,
          conversationId,
          projectId,
          role: "assistant",
          content: "",
          status: "processing",
        },
      );
    } catch (error) {
      console.error("create-with-prompt: create assistant message failed:", error);
      return NextResponse.json(
        { error: "Project created but failed to init assistant message." },
        { status: 500 }
      );
    }

    // Trigger Inngest to process the message
    try {
      await inngest.send({
        name: "message/sent",
        data: {
          messageId: assistantMessageId,
          conversationId,
          projectId,
          message: prompt,
        },
      });
    } catch (error) {
      console.error("create-with-prompt: inngest.send failed (is Inngest dev server running?):", error);
      return NextResponse.json(
        { error: "Project created but failed to trigger AI. Is Inngest dev server running? Run: pnpm dlx inngest-cli@latest dev" },
        { status: 500 }
      );
    }

    return NextResponse.json({ projectId });
  } catch (error) {
    console.error("create-with-prompt: unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create project" },
      { status: 500 }
    );
  }
};
