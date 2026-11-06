import Anthropic from "@anthropic-ai/sdk";
import { CLIENT_TOOLS, SERVER_TOOLS, describeToolCall, executeClientTool, isClientTool } from "./tools";
import { listFiles } from "./workspace";
import type { AgentEventBody } from "./types";

const MODEL = process.env.KESTREL_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.KESTREL_EFFORT || "high") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TURNS = Number(process.env.KESTREL_MAX_TURNS || 60);
const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  // Route safety-classifier refusals to a fallback model automatically.
  "server-side-fallback-2026-07-01",
  // Short progress notes between tool calls, shown live in the activity feed.
  "thinking-display-updates-2026-08-18",
];

const client = new Anthropic();

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Kestrel, an autonomous agent that completes tasks end to end for the user. Today is ${today}.

You work on your own until the task is done; the user is watching your progress but will not answer questions mid-task, so make reasonable assumptions and state them in your final answer.

You have:
- web_search and web_fetch for current information. Prefer primary sources and cite URLs.
- run_code (Python or bash) in a sandbox whose working directory is the task workspace. Use it for calculations, data processing, charts (save PNGs with matplotlib), and checking your work.
- write_file / read_file / list_files for the workspace. Save every real deliverable (report, dataset, code, page) as a file so the user can download it.
- update_plan to show your plan.

How to work:
1. Start by calling update_plan with 3-8 concrete steps.
2. Work through the steps, updating the plan as each starts and finishes. Revise the plan if you learn something that changes it.
3. Verify important results (run the code, re-check numbers and sources) before you finish.
4. Finish with a concise answer: what you found or built, the files you created, and any assumptions or caveats. Use Markdown.`;
}

export interface RunOptions {
  prompt: string;
  workspace: string;
  signal: AbortSignal;
  emit: (e: AgentEventBody) => void;
}

/**
 * The agent loop: stream a turn, surface each content block as an event, run
 * the client tools Claude asked for, append results, repeat until end_turn.
 */
export async function runAgent({ prompt, workspace, signal, emit }: RunOptions): Promise<void> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const tools = [...CLIENT_TOOLS, ...SERVER_TOOLS] as unknown as Anthropic.Beta.BetaToolUnion[];
  let jsonRetries = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) return;

    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
        system: systemPrompt(),
        tools,
        messages,
      },
      { signal },
    );

    stream.on("contentBlock", (block) => {
      switch (block.type) {
        case "thinking":
          if (block.thinking.trim()) emit({ type: "progress", text: block.thinking.trim() });
          break;
        case "text":
          if (block.text.trim()) emit({ type: "text", text: block.text });
          break;
        case "tool_use":
        case "server_tool_use": {
          if (block.name === "update_plan") break;
          const { label, detail } = describeToolCall(block.name, block.input);
          emit({ type: "tool_start", id: block.id, name: block.name, label, detail });
          break;
        }
        case "web_search_tool_result": {
          const c = block.content;
          if (Array.isArray(c)) {
            const lines = c.map((r) => `${r.title}\n${r.url}`).join("\n\n");
            emit({ type: "tool_end", id: block.tool_use_id, ok: true, output: lines || "(no results)" });
          } else {
            emit({ type: "tool_end", id: block.tool_use_id, ok: false, output: `Search error: ${c.error_code}` });
          }
          break;
        }
        case "web_fetch_tool_result": {
          const c = block.content as { type: string; url?: string; error_code?: string };
          if (c.type === "web_fetch_result") {
            emit({ type: "tool_end", id: block.tool_use_id, ok: true, output: `Read ${c.url}` });
          } else {
            emit({ type: "tool_end", id: block.tool_use_id, ok: false, output: `Fetch error: ${c.error_code}` });
          }
          break;
        }
      }
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (signal.aborted) return;
      // Only a tool input that could not be parsed is retried; API errors bubble up.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined to continue this task." });
      return;
    }

    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue; // server tools hit their loop limit; resume

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (message.stop_reason === "end_turn" || toolUses.length === 0) {
      const final = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      emit({ type: "files", files: await listFiles(workspace) });
      emit({ type: "final", text: final || "Done." });
      return;
    }

    if (message.stop_reason === "max_tokens") {
      throw new Error("A response hit the max_tokens limit mid tool call.");
    }

    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const outcome = isClientTool(tu.name)
          ? await executeClientTool(tu.name, tu.input, {
              workspace,
              signal,
              onPlan: (steps) => emit({ type: "plan", steps }),
            })
          : { ok: false, content: `Unknown tool ${tu.name}` };
        if (tu.name !== "update_plan") emit({ type: "tool_end", id: tu.id, ok: outcome.ok, output: outcome.content });
        return { type: "tool_result", tool_use_id: tu.id, content: outcome.content, is_error: !outcome.ok || undefined };
      }),
    );
    if (toolUses.some((t) => t.name === "write_file" || t.name === "run_code")) {
      emit({ type: "files", files: await listFiles(workspace) });
    }
    messages.push({ role: "user", content: results });
  }

  emit({ type: "error", message: `Stopped after ${MAX_TURNS} turns without finishing.` });
}
