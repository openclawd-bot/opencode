import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { PermissionNext } from "@/permission/next"
import EXIT_DESCRIPTION from "./agent-exit.txt"
import ENTER_DESCRIPTION from "./agent-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const AgentExitTool = Tool.define("agent_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Would you like to exit agent mode and switch to a different mode?",
          header: "Exit Agent Mode",
          custom: false,
          options: [
            { label: "Chat", description: "Switch to chat agent for general conversation" },
            { label: "Research", description: "Switch to research agent for web research" },
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
      text: `User has requested to exit agent mode and switch to ${targetAgent} mode.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${targetAgent} agent`,
      output: `User confirmed to switch to ${targetAgent} mode.`,
      metadata: {},
    }
  },
})

export const AgentEnterTool = Tool.define("agent_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const messages = await Session.messages({ sessionID: session.id })

    const hasAssistantMessages = messages.some((msg) => msg.info.role === "assistant")

    if (hasAssistantMessages) {
      return {
        title: "Cannot enter agent mode",
        output: "Agent mode can only be entered when starting a new conversation, not in an existing thread.",
        metadata: {},
      }
    }

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Would you like to switch to agent mode? Agent mode combines planning and execution - you plan first, then approve execution.",
          header: "Agent Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to agent mode for unified planning and execution" },
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
      agent: "agent",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter agent mode. Begin with planning phase - understand the request, ask clarifying questions, then create a plan for user approval.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to agent mode",
      output: "User confirmed to switch to agent mode. Begin with the planning workflow.",
      metadata: {},
    }
  },
})

export const AgentApprovePlanTool = Tool.define("agent_approve_plan", {
  description: "Approve the plan and switch from planning phase to execution phase. This grants full file system access for implementation.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Approve the plan at ${plan} and switch to execution mode? You'll have full file system access after approval.`,
          header: "Approve Plan",
          custom: false,
          options: [
            { label: "Yes", description: "Approve plan and grant full execution permissions" },
            { label: "No", description: "Continue refining the plan" },
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
      agent: "agent",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Plan at ${plan} has been approved. You now have full file system access. Create a todo list and begin implementation.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Plan approved - execution mode enabled",
      output: `Plan at ${plan} approved. You now have full file system access. Begin by creating a todo list from the plan.`,
      metadata: {},
    }
  },
})

export const AgentDenyPlanTool = Tool.define("agent_deny_plan", {
  description: "Deny the current plan and return to planning phase. Use this to request changes to the plan before execution.",
  parameters: z.object({
    reason: z.string().optional().describe("Reason for denying the plan"),
  }),
  async execute(params, ctx) {
    const session = await Session.get(ctx.sessionID)

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "agent",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Plan has been denied. Reason: ${params.reason ?? "No reason provided"}. Continue planning and revise the plan based on feedback.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Plan denied - returning to planning",
      output: "Continue refining the plan based on user feedback.",
      metadata: {},
    }
  },
})
