import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import CHAT_EXIT_DESCRIPTION from "./chat-exit.txt"
import CHAT_ENTER_DESCRIPTION from "./chat-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const ChatExitTool = Tool.define("chat_exit", {
  description: CHAT_EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "You are currently in chat mode. Which mode would you like to switch to?",
          header: "Exit Chat Mode",
          custom: false,
          options: [
            { label: "Build", description: "Switch to build agent for coding tasks" },
            { label: "Plan", description: "Switch to plan agent for planning and research" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (!answer) throw new Question.RejectedError()

    const targetAgent = answer.toLowerCase()
    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: targetAgent,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `User has requested to exit chat mode and switch to ${targetAgent} mode.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${targetAgent} agent`,
      output: `User confirmed to switch to ${targetAgent} mode. A new message has been created to switch you to ${targetAgent} mode.`,
      metadata: {},
    }
  },
})

export const ChatEnterTool = Tool.define("chat_enter", {
  description: CHAT_ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const messages = await Session.messages({ sessionID: session.id })

    const hasAssistantMessages = messages.some((msg) => msg.info.role === "assistant")

    if (hasAssistantMessages) {
      return {
        title: "Cannot enter chat mode",
        output:
          "Chat mode can only be entered when starting a new conversation, not in an existing thread. You can use chat_exit to leave chat mode if you're already in it.",
        metadata: {},
      }
    }

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Would you like to switch to chat mode for general conversation without file system access?",
          header: "Chat Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to chat agent for general conversation" },
            { label: "No", description: "Stay with current agent" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "chat",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter chat mode. Switch to chat mode and begin general conversation. You do not have access to the file system or any file-related tools. You are a general-purpose chatbot.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to chat agent",
      output: "User confirmed to switch to chat mode. A new message has been created to switch you to chat mode.",
      metadata: {},
    }
  },
})

export const ModeCycleTool = Tool.define("mode_cycle", {
  description:
    "Cycle through available modes: Build -> Plan -> Chat. This tool is only available when starting a new conversation (not in an existing thread).",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const messages = await Session.messages({ sessionID: session.id })

    const lastAssistant = messages.findLast((msg) => msg.info.role === "assistant")
    const currentMode = lastAssistant?.info.agent ?? "build"

    if (messages.some((msg) => msg.info.role === "assistant")) {
      return {
        title: "Mode cycling unavailable",
        output:
          "Mode cycling is only available when starting a new conversation. Once a conversation has started, use chat_enter to enter chat mode or chat_exit to leave it.",
        metadata: {},
      }
    }

    const cycle = {
      build: "plan",
      plan: "chat",
      chat: "build",
    } as const

    const nextMode = cycle[currentMode as keyof typeof cycle] ?? "build"

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Cycle from ${currentMode} mode to ${nextMode} mode?`,
          header: "Mode Cycle",
          custom: false,
          options: [
            { label: "Yes", description: `Switch to ${nextMode} mode` },
            { label: "No", description: "Stay in current mode" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: nextMode,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `User has cycled to ${nextMode} mode.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switched to ${nextMode} mode`,
      output: `Successfully switched to ${nextMode} mode.`,
      metadata: {},
    }
  },
})
