# Content Inclusion Policy

Standalone editorial policy for deciding what qualifies as "AI agent" coverage in Agent Newsletter.

- Policy version: `1.0.1`
- Review cadence: quarterly
- Canonical machine-readable source: [`src/newsletter/scope-definition.document.json`](../src/newsletter/scope-definition.document.json)
- API representation: `GET /api/newsletter/scope`

This document is the human-readable companion to the versioned scope definition used by the pipeline. If this file and the machine-readable scope definition ever differ, treat the checked-in JSON document and `/api/newsletter/scope` response as the source of truth.

## Qualification Standard

For this project, an "AI agent" is software that autonomously pursues a goal by planning what to do next, using tools or external systems, and executing work across multiple steps with limited human intervention.

The qualification bar is intentionally higher than "uses an LLM." A candidate is AI-agent-relevant only when the underlying system can:

- Accept a delegated goal beyond answering a single prompt.
- Decide or revise what to do next at runtime.
- Use external tools or systems such as APIs, browsers, shells, files, databases, or code execution environments.
- Carry out multi-step work without requiring a human prompt before every action.

## Required Capabilities

An item qualifies for newsletter coverage only when the covered system or technique materially supports software that can do all of the following:

- Maintain an explicit delegated goal beyond one prompt-response cycle.
- Choose or adapt the next action at runtime based on state, observations, or prior tool results.
- Use tools or external systems as part of runtime decision-making.
- Execute work across multiple steps with limited human intervention.

## Included Coverage

Include content when it is about:

- Autonomous, goal-directed systems that plan or adapt their next action before executing work.
- Tool-using systems that interact with APIs, browsers, shells, files, databases, or code execution environments as part of runtime behavior.
- Infrastructure that materially improves autonomous behavior, including planning, memory, tool use, evaluation, orchestration, verification, or multi-agent coordination.
- Tools, APIs, libraries, and techniques that subscribing agents could directly integrate to expand or harden their capabilities.

## Excluded Coverage

Exclude content when it is primarily about:

- Plain chatbots or assistants that only return text and do not take autonomous actions.
- Single-shot LLM wrappers that call a model once without planning, tool use, or multi-step execution.
- Static automation scripts, deterministic DAGs, or fixed workflows that do not choose actions dynamically at runtime.
- Generic AI news, model launches, or prompt-writing advice without a direct autonomous-agent implication.
- Human-only productivity tools unless the agent integration surface is the primary, operationally real capability.

## Editorial Decision Rule

Include a candidate only when a deployed system could use it to autonomously decide and execute the next step toward a goal.

If the strongest inclusion argument is "people building agents might find this interesting," exclude it. If the stronger argument is "a deployed agent could directly use or integrate this," include it.

## Edge-Case Guidance

- Human-in-the-loop systems are included only when the agent can still plan and execute most of the workflow autonomously, with the human acting as an exception handler or approval gate for sensitive actions.
- Products that support both chat and agent workflows are included only when the agentic capability is first-class, documented, and operationally real rather than marketing language on top of a chatbot.
- Workflow tools are excluded when they only run predeclared steps, even if one step calls an LLM. They are included when runtime behavior can branch, recover, select tools, or revise plans based on state.
- Research papers are included when they advance agent planning, tool use, memory, evaluation, orchestration, verification, or autonomy. Generic model papers without a direct agent implication are excluded.
- Infrastructure and developer tools are included when they clearly increase what an autonomous agent can safely or effectively do, such as browser control, sandboxes, tool protocols, memory systems, evaluators, or execution runtimes.

## Boundary Examples

| Example | Include? | Why |
| --- | --- | --- |
| A coding agent that inspects a repository, plans code changes, runs tests, and iterates until checks pass | Yes | It is goal-directed, tool-using, and autonomous across multiple steps. |
| A browser agent that researches vendors, fills forms, and retries failed steps while pursuing a delegated task | Yes | It chooses actions at runtime and operates in external systems. |
| A multi-agent orchestration runtime that delegates work to specialized workers, verifies outputs, and merges the result | Yes | It is infrastructure for autonomous planning, execution, and verification. |
| An agent memory or evaluation system that materially improves autonomous planning, tool selection, or long-horizon execution | Yes | It directly improves deployed autonomous-agent capability. |
| A chatbot interface that only returns text answers and never takes external actions | No | It is a chat surface, not an autonomous acting system. |
| A single-shot LLM wrapper that sends one prompt and returns the response without planning or tool use | No | It does not plan, act, or execute across steps. |
| A fixed automation script or deterministic workflow whose steps are fully predeclared | No | It is static automation rather than adaptive agent behavior. |
| A generic AI productivity feature where any agent integration is hypothetical or secondary to a human workflow | No | The primary use case is not autonomous agent operation. |

## Review And Change Control

- The policy is reviewed quarterly.
- Any scope-boundary change requires a version bump and a new changelog entry in the canonical scope definition document.
- Use a major version bump when the inclusion boundary changes enough to add or remove a broad class of content.
- Use a minor version bump when the scope gains or narrows a specific covered pattern, source family, or edge-case rule without redefining the core agent standard.
- Use a patch version bump for clarifications, examples, or wording changes that do not alter editorial behavior.
