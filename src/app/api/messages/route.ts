import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { inngest } from "@/inngest/client";
import { messageCancel, messageSent } from "@/inngest/events";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    return NextResponse.json(
      { error: "Internal key not configured" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { conversationId, message } = requestSchema.parse(body);

  // Call convex mutation, query
  const conversation = await convex.query(api.system.getConversationById, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const projectId = conversation.projectId;

  // Find all processing messages in this project
  const processingMessages = await convex.query(
    api.system.getProcessingMessages,
    {
      internalKey,
      projectId,
    }
  );

  if (processingMessages.length > 0) {
    // Cancel all processing messages
    await Promise.all(
      processingMessages.map(async (msg) => {
        await inngest.send(
          messageCancel.create({
            messageId: msg._id,
          })
        );

        await convex.mutation(api.system.updateMessageStatus, {
          internalKey,
          messageId: msg._id,
          status: "cancelled",
        });
      })
    );
  }

  // Create user message
  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    projectId,
    role: "user",
    content: message,
  });

  // Create assistant message placeholder with processing status
  const assistantMessageId = await convex.mutation(
    api.system.createMessage,
    {
      internalKey,
      conversationId: conversationId as Id<"conversations">,
      projectId,
      role: "assistant",
      content: "",
      status: "processing",
    }
  );

  // Trigger Inngest to process the message
  const event = await inngest.send(
    messageSent.create({
      messageId: assistantMessageId,
      conversationId: conversationId as Id<"conversations">,
      projectId,
      message,
    })
  );

  return NextResponse.json({
    success: true,
    eventId: event.ids[0],
    messageId: assistantMessageId,
  });
};
