import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import EXIT_DESCRIPTION from "./research-exit.txt"
import ENTER_DESCRIPTION from "./research-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

function researchFile(session: Session.Info): string {
  return path.join(Instance.worktree, ".opencode", "research", `${session.id}.md`)
}

export const ResearchExitTool = Tool.define("research_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const research = path.relative(Instance.worktree, researchFile(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Research at ${research} is complete. Would you like to switch to the build agent and start implementing?`,
          header: "Build Agent",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to build agent and implement findings" },
            { label: "No", description: "Stay with research agent to continue researching" },
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
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Research at ${research} is complete. Implement the research findings.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build agent",
      output: "User approved switching to build agent. Wait for further instructions.",
      metadata: {},
    }
  },
})

export const ResearchEnterTool = Tool.define("research_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const research = path.relative(Instance.worktree, researchFile(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the research agent and create a research report saved to ${research}?`,
          header: "Research Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to research agent for systematic web research" },
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
      agent: "research",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter research mode. Switch to research mode and begin systematic web research.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to research agent",
      output: `User confirmed to switch to research mode. A new message has been created to switch you to research mode. The research file will be at ${research}. Begin research.`,
      metadata: {},
    }
  },
})
