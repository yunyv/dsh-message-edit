// src/index.ts
import { SessionId } from "@deepseek-ai/dsh-session";

// src/shared.ts
var MESSAGE_EDIT_PATH = "/message-edit";
var MESSAGE_EDIT_VIEW_ORDER = 15;
var MESSAGE_EDIT_VERSION_SCHEMA = 2;

// src/index.ts
var name = "message-edit";
var inject = [
  "sessions",
  "agents",
  "sessionPersistence",
  "sessionQuery",
  "workspaceRegistry",
  "webServer"
];
function pairVersionEffect(sourceSessionId, effect) {
  return {
    schemaVersion: MESSAGE_EDIT_VERSION_SCHEMA,
    effect: {
      ...effect,
      id: crypto.randomUUID()
    },
    inverse: {
      kind: "restore-version",
      sessionId: sourceSessionId
    }
  };
}
function isTextualBlock(block) {
  const candidate = block;
  return candidate?.type === "text" || candidate?.type === "reasoning";
}
function userText(message) {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
function cloneUser(message, content = structuredClone(message.content)) {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "user",
    content: Object.freeze(content),
    source: Object.freeze({ kind: "user" })
  });
}
function replaceTextBlock(content, blockIndex, text) {
  const block = content[blockIndex];
  if (!isTextualBlock(block)) throw new Error("\u6240\u9009\u5185\u5BB9\u5757\u4E0D\u662F\u53EF\u7F16\u8F91\u6587\u672C\u3002");
  return content.map(
    (candidate, index) => index === blockIndex ? { ...candidate, text } : structuredClone(candidate)
  );
}
function closedTurns(events) {
  const result = [];
  let current;
  for (const event of events) {
    if (event.type === "turn/start") {
      current = { turn: event.data.turn, startSeq: event.seq, assistants: [] };
      continue;
    }
    if (current === void 0) continue;
    if (event.type === "user/message" && current.user === void 0 && event.data.source.kind === "user") {
      current.user = event;
      continue;
    }
    if (event.type === "assistant/message" && event.data.turn === current.turn) {
      current.assistants.push(event);
      continue;
    }
    if (event.type === "turn/end" && event.data.turn === current.turn) {
      result.push({ ...current, endSeq: event.seq });
      current = void 0;
    }
  }
  return result;
}
function editableMessages(turns) {
  const result = [];
  for (const turn of turns) {
    if (turn.user !== void 0) {
      for (const [blockIndex, block] of turn.user.data.content.entries()) {
        if (block.type !== "text") continue;
        result.push({
          key: `${String(turn.user.seq)}:${String(blockIndex)}`,
          turn: turn.turn,
          eventSeq: turn.user.seq,
          blockIndex,
          kind: "user",
          text: block.text,
          time: turn.user.time
        });
      }
    }
    for (const event of turn.assistants) {
      const message = event.data.message;
      for (const [blockIndex, block] of message.content.entries()) {
        if (!isTextualBlock(block)) continue;
        result.push({
          key: `${String(event.seq)}:${String(blockIndex)}`,
          turn: turn.turn,
          eventSeq: event.seq,
          blockIndex,
          kind: block.type === "reasoning" ? "assistant.reasoning" : "assistant.response",
          text: block.text,
          time: event.time,
          messageId: message.id
        });
      }
    }
  }
  return result;
}
function retryableTurns(turns) {
  return turns.flatMap(
    (turn) => turn.user === void 0 ? [] : [{
      turn: turn.turn,
      userEventSeq: turn.user.seq,
      preview: userText(turn.user.data),
      time: turn.user.time
    }]
  );
}
function downstreamUsers(turns, start) {
  return turns.slice(start).flatMap((turn) => turn.user === void 0 ? [] : [cloneUser(turn.user.data)]);
}
function assistantReplacement(event, blockIndex, text) {
  const message = event.data.message;
  const replaced = replaceTextBlock(message.content, blockIndex, text).filter((block) => block.type === "text" || block.type === "reasoning");
  return Object.freeze({
    id: crypto.randomUUID(),
    role: "assistant",
    content: Object.freeze(replaced),
    source: Object.freeze({
      kind: "model",
      provider: message.source.provider,
      model: message.source.model
    })
  });
}
function editPlan(operation, turns) {
  const turnIndex = turns.findIndex((turn2) => operation.eventSeq > turn2.startSeq && operation.eventSeq < turn2.endSeq);
  const turn = turns[turnIndex];
  if (turn === void 0) throw new Error("\u6240\u9009\u6D88\u606F\u4E0D\u5C5E\u4E8E\u5DF2\u843D\u5B9A\u56DE\u5408\u3002");
  const event = turn.user?.seq === operation.eventSeq ? turn.user : turn.assistants.find((candidate) => candidate.seq === operation.eventSeq);
  if (event === void 0) throw new Error("\u6240\u9009\u6D88\u606F\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7F16\u8F91\u3002");
  if (event.type === "user/message") {
    const before2 = event.data.content[operation.blockIndex];
    if (before2?.type !== "text") throw new Error("\u6240\u9009\u7528\u6237\u6D88\u606F\u5757\u4E0D\u662F\u6587\u672C\u3002");
    const edited = cloneUser(event.data, replaceTextBlock(event.data.content, operation.blockIndex, operation.text));
    const later = operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : [];
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(operation.sessionId, {
        operation: "edit",
        cascade: operation.cascade,
        targetTurn: turn.turn,
        targetEventSeq: event.seq,
        targetBlockIndex: operation.blockIndex,
        blockKind: "user",
        before: before2.text,
        after: operation.text
      }),
      queuedUsers: [edited, ...later]
    };
  }
  const before = event.data.message.content[operation.blockIndex];
  if (!isTextualBlock(before)) throw new Error("\u6240\u9009\u52A9\u624B\u6D88\u606F\u5757\u4E0D\u662F\u6587\u672C\u6216\u601D\u8003\u3002");
  const blockKind = before.type === "reasoning" ? "assistant.reasoning" : "assistant.response";
  if (turn.user === void 0) throw new Error("\u6240\u9009\u52A9\u624B\u6D88\u606F\u6CA1\u6709\u53EF\u91CD\u5EFA\u7684\u7528\u6237\u8F93\u5165\u3002");
  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(operation.sessionId, {
      operation: "edit",
      cascade: operation.cascade,
      targetTurn: turn.turn,
      targetEventSeq: event.seq,
      targetBlockIndex: operation.blockIndex,
      blockKind,
      before: before.text,
      after: operation.text
    }),
    manualTurn: {
      turn: turn.turn,
      user: cloneUser(turn.user.data),
      assistant: assistantReplacement(event, operation.blockIndex, operation.text)
    },
    queuedUsers: operation.cascade === "preserve" ? downstreamUsers(turns, turnIndex + 1) : []
  };
}
function retryPlan(sessionId, turnNumber, cascade, turns) {
  const turnIndex = turns.findIndex((turn2) => turn2.turn === turnNumber);
  const turn = turns[turnIndex];
  if (turn?.user === void 0) throw new Error("\u6240\u9009\u56DE\u5408\u6CA1\u6709\u53EF\u91CD\u653E\u7684\u7528\u6237\u8F93\u5165\u3002");
  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(sessionId, {
      operation: "retry",
      cascade,
      targetTurn: turn.turn,
      targetEventSeq: turn.user.seq
    }),
    queuedUsers: cascade === "preserve" ? downstreamUsers(turns, turnIndex) : [cloneUser(turn.user.data)]
  };
}
function rerollPlan(sessionId, turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.user === void 0) continue;
    const target = turn.assistants.findLast(
      (event) => event.data.message.content.some(isTextualBlock)
    );
    if (target === void 0) continue;
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(sessionId, {
        operation: "reroll",
        cascade: "truncate",
        targetTurn: turn.turn,
        targetEventSeq: target.seq
      }),
      queuedUsers: [cloneUser(turn.user.data)]
    };
  }
  throw new Error("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u53EF\u91CD\u751F\u6210\u7684\u5DF2\u843D\u5B9A\u52A9\u624B\u56DE\u590D\u3002");
}
function planOperation(operation, events) {
  const turns = closedTurns(events);
  switch (operation.action) {
    case "edit":
      return editPlan(operation, turns);
    case "reroll":
      return rerollPlan(operation.sessionId, turns);
    case "retry":
      return retryPlan(operation.sessionId, operation.turn, operation.cascade, turns);
  }
}
function agentOptions(events, fallback) {
  const config = events.findLast((event) => event.type === "request/header")?.data.header.config;
  const provider = config?.provider ?? fallback?.provider;
  const model = config?.model ?? fallback?.model;
  if (provider === void 0 || provider.length === 0 || model === void 0 || model.length === 0) {
    throw new Error("\u65E0\u6CD5\u4ECE\u4F1A\u8BDD\u5386\u53F2\u89E3\u6790\u6A21\u578B\u8DEF\u7531\u3002");
  }
  const maxTokens = config?.maxTokens ?? fallback?.maxTokens;
  return {
    provider,
    model,
    ...maxTokens === void 0 ? {} : { maxTokens }
  };
}
async function withSourceAgent(ctx, sessionId, operation) {
  let handle;
  let agent = ctx.agents.get(sessionId);
  if (agent === void 0) {
    const snapshot = await ctx.sessionQuery.readSession(sessionId);
    handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: agentOptions(snapshot.events)
    });
    agent = handle.agent;
  }
  try {
    return await agent.runMaintenance(async () => operation(agent));
  } finally {
    await handle?.dispose();
  }
}
function inheritedSeed(source, boundary) {
  if (boundary === -1) return [];
  const boundaryEvent = source.events[boundary];
  if (boundary < 0 || boundaryEvent === void 0 || boundaryEvent.seq !== boundary) {
    throw new Error("\u5206\u652F\u8FB9\u754C\u4E0D\u662F\u8FDE\u7EED\u4F1A\u8BDD\u4E8B\u4EF6\u3002");
  }
  return source.events.slice(0, boundary + 1).map(
    (event) => event.type === "message-edit/version" ? { ...event, ignorable: true } : event
  );
}
function appendLogSeedEvent(events, type, data, ignorable) {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    ...ignorable === true ? { ignorable: true } : {}
  });
}
function appendSurfaceSeedEvent(events, type, data, intent) {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    surfaceOp: intent.surfaceOp,
    ...intent.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: intent.sourceEventSeqs }
  });
}
function appendManualTurn(events, manual) {
  const { turn, user, assistant } = manual;
  appendLogSeedEvent(events, "turn/start", { turn });
  appendSurfaceSeedEvent(events, "user/message", user, { surfaceOp: "append" });
  appendLogSeedEvent(events, "step/start", { turn, step: 1 });
  appendSurfaceSeedEvent(events, "assistant/message", { turn, step: 1, message: assistant }, {
    surfaceOp: "append",
    sourceEventSeqs: []
  });
  appendLogSeedEvent(events, "step/end", { turn, step: 1 });
  appendLogSeedEvent(events, "turn/end", { turn, reason: { kind: "completed" } });
}
function versionSeed(source, plan) {
  const events = inheritedSeed(source, plan.boundary);
  const inheritedLength = events.length;
  appendLogSeedEvent(events, "message-edit/version", plan.version, true);
  if (plan.manualTurn !== void 0) appendManualTurn(events, plan.manualTurn);
  return { events, inheritedLength };
}
function sessionPreset(session) {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (event?.type === "agent-preset/selected") return event.data.agentPreset;
  }
  return session.header.agentPreset;
}
async function createVersionAgent(ctx, sourceAgent, childId, plan, options) {
  const source = sourceAgent.session;
  const seed = versionSeed(source, plan);
  const presets = ctx.get("agentPresets");
  const presetId = sessionPreset(source);
  let setup;
  if (presets !== void 0) {
    const joinedPreset = presets.composedPreset(sourceAgent.ctx);
    if (joinedPreset !== void 0) {
      setup = (agentCtx) => {
        presets.composeFrom(agentCtx, sourceAgent.ctx);
      };
    } else if (presetId !== void 0) {
      const resolved = (await presets.resolve(presetId)).id;
      setup = async (agentCtx) => {
        await presets.mount(agentCtx, resolved);
      };
    }
  }
  const child = await ctx.agents.create({
    sessionId: childId,
    seed: seed.events,
    meta: {
      ...source.header.cwd === void 0 ? {} : { cwd: source.header.cwd },
      parentSession: source.id,
      seedLength: seed.inheritedLength,
      ...presetId === void 0 ? {} : { agentPreset: presetId }
    },
    agentOptions: options,
    ...setup === void 0 ? {} : { setup }
  });
  try {
    await ctx.sessions.flush(child.agent.session);
    return child;
  } catch (error) {
    await child.dispose();
    throw error;
  }
}
function sourceWorkspace(ctx, sessionId) {
  return ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(sessionId));
}
async function recoverOperation(inverses) {
  const failures = [];
  for (const inverse of inverses.reverse()) {
    try {
      await inverse();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "\u7248\u672C\u64CD\u4F5C\u6062\u590D\u5931\u8D25\u3002");
}
async function runOperation(ctx, operation) {
  const sourceId = sessionIdOf(operation.sessionId);
  return withSourceAgent(ctx, sourceId, async (source) => {
    const childId = sessionIdOf(`session-${crypto.randomUUID()}`);
    const inverses = [];
    try {
      const events = source.session.events;
      const plan = planOperation(operation, events);
      const options = agentOptions(events, source.options);
      const child = await createVersionAgent(ctx, source, childId, plan, options);
      inverses.push(() => child.dispose());
      const workspace = sourceWorkspace(ctx, sourceId);
      if (workspace !== void 0) {
        await workspace.attachSession(childId);
        inverses.push(() => workspace.detachSession(childId));
      }
      for (const message of plan.queuedUsers) child.agent.followup(message);
      inverses.length = 0;
      return {
        sessionId: childId,
        queuedTurns: plan.queuedUsers.length
      };
    } catch (error) {
      try {
        await recoverOperation(inverses);
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], "\u7248\u672C\u64CD\u4F5C\u53CA\u5176\u6062\u590D\u5747\u5931\u8D25\u3002");
      }
      throw error;
    }
  });
}
function ownVersionEvent(header, events) {
  const inherited = header.seedLength ?? 0;
  const ownEvents = events.filter((event2) => event2.type === "message-edit/version" && event2.seq >= inherited);
  if (ownEvents.length === 0) return void 0;
  if (ownEvents.length > 1) throw new Error(`\u4F1A\u8BDD ${header.id} \u5305\u542B\u591A\u4E2A\u81EA\u8EAB\u7248\u672C\u6548\u679C\u3002`);
  const event = ownEvents[0];
  if (event === void 0) return void 0;
  const parent = header.parentSession;
  if ("schemaVersion" in event.data) {
    const version = event.data;
    if (version.schemaVersion !== MESSAGE_EDIT_VERSION_SCHEMA) {
      throw new Error(`\u4F1A\u8BDD ${header.id} \u4F7F\u7528\u4E0D\u652F\u6301\u7684\u7248\u672C\u6548\u679C\u7ED3\u6784\u3002`);
    }
    if (version.inverse.kind !== "restore-version" || parent === void 0 || version.inverse.sessionId !== parent) {
      throw new Error(`\u4F1A\u8BDD ${header.id} \u7684\u7248\u672C\u6548\u679C\u4E0E\u9006\u4E0D\u5339\u914D\u3002`);
    }
    return { effect: version.effect, inverseSessionId: version.inverse.sessionId, time: event.time };
  }
  const legacy = event.data;
  if (parent === void 0 || legacy.sourceSessionId !== parent) {
    throw new Error(`\u4F1A\u8BDD ${header.id} \u7684\u65E7\u7248\u6062\u590D\u76EE\u6807\u4E0E\u7236\u7248\u672C\u4E0D\u5339\u914D\u3002`);
  }
  return {
    effect: {
      id: `legacy:${header.id}:${String(event.seq)}`,
      operation: legacy.operation,
      cascade: legacy.cascade,
      targetTurn: legacy.targetTurn,
      targetEventSeq: legacy.targetEventSeq,
      ...legacy.targetBlockIndex === void 0 ? {} : { targetBlockIndex: legacy.targetBlockIndex },
      ...legacy.blockKind === void 0 ? {} : { blockKind: legacy.blockKind },
      ...legacy.before === void 0 ? {} : { before: legacy.before },
      ...legacy.after === void 0 ? {} : { after: legacy.after }
    },
    inverseSessionId: legacy.sourceSessionId,
    time: event.time
  };
}
function flattenLineage(root, descendants) {
  const result = [{ record: root, depth: 0 }];
  const visit = (nodes, depth) => {
    const ordered = [...nodes].sort(
      (left, right) => left.session.header.createdAt - right.session.header.createdAt || String(left.session.header.id).localeCompare(String(right.session.header.id))
    );
    for (const node of ordered) {
      result.push({ record: node.session, depth });
      visit(node.descendants, depth + 1);
    }
  };
  visit(descendants, 1);
  return result;
}
var TIMELINE_READ_CONCURRENCY = 4;
async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    for (; ; ) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };
  const workers = Math.min(TIMELINE_READ_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}
async function readCurrentLog(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId);
  if (live !== void 0) return live.events;
  const persistence = ctx.get("sessionPersistence");
  if (persistence !== void 0) return (await persistence.inspect(sessionId)).events;
  return (await ctx.sessionQuery.readSession(sessionId)).events;
}
async function versionLog(ctx, record) {
  const inherited = record.seedLength ?? 0;
  const live = ctx.sessions.get(record.id);
  if (live !== void 0) return live.events.slice(inherited);
  const persistence = ctx.get("sessionPersistence");
  if (persistence !== void 0) return (await persistence.readFrom(record.id, inherited)).events;
  return (await ctx.sessionQuery.readSession(record.id)).events.slice(inherited);
}
async function timeline(ctx, sessionId) {
  const targetTrace = await ctx.sessionQuery.traceSession(sessionId);
  const rootId = targetTrace.complete ? targetTrace.root.header.id : targetTrace.ancestors.at(-1)?.header.id ?? sessionId;
  const rootTrace = rootId === sessionId ? targetTrace : await ctx.sessionQuery.traceSession(rootId);
  const lineage = flattenLineage(rootTrace.target, rootTrace.descendants);
  const logs = await mapConcurrent(lineage, async ({ record }) => {
    if (record.header.id === sessionId) return readCurrentLog(ctx, sessionId);
    if (record.header.parentSession === void 0) return [];
    return versionLog(ctx, record.header);
  });
  const recordsById = new Map(lineage.map(({ record }) => [record.header.id, record]));
  const currentPath = /* @__PURE__ */ new Set();
  let pathId = sessionId;
  while (pathId !== void 0 && !currentPath.has(pathId)) {
    currentPath.add(pathId);
    pathId = recordsById.get(pathId)?.header.parentSession;
  }
  const versions = lineage.map(({ record, depth }, index) => {
    const version = ownVersionEvent(record.header, logs[index] ?? []);
    return {
      sessionId: record.header.id,
      ...record.header.parentSession === void 0 ? {} : { parentSessionId: record.header.parentSession },
      ...version === void 0 ? {} : {
        effectId: version.effect.id,
        inverseSessionId: version.inverseSessionId
      },
      createdAt: version?.time ?? record.header.createdAt,
      depth,
      current: record.header.id === sessionId,
      onCurrentEffectPath: currentPath.has(record.header.id),
      ...version === void 0 ? {} : {
        operation: version.effect.operation,
        cascade: version.effect.cascade,
        targetTurn: version.effect.targetTurn,
        ...version.effect.blockKind === void 0 ? {} : { blockKind: version.effect.blockKind },
        ...version.effect.before === void 0 ? {} : { before: version.effect.before },
        ...version.effect.after === void 0 ? {} : { after: version.effect.after }
      }
    };
  });
  const effectIds = /* @__PURE__ */ new Set();
  for (const version of versions) {
    if (version.effectId === void 0) continue;
    if (effectIds.has(version.effectId)) throw new Error(`\u7248\u672C\u6548\u679C ${version.effectId} \u91CD\u590D\u3002`);
    effectIds.add(version.effectId);
  }
  const versionsById = new Map(versions.map((version) => [version.sessionId, version]));
  const undoStack = [];
  let undoCursor = versionsById.get(sessionId);
  while (undoCursor?.inverseSessionId !== void 0) {
    const inverseId = undoCursor.inverseSessionId;
    if (undoStack.includes(inverseId)) throw new Error("\u7248\u672C\u6548\u679C\u9006\u94FE\u5305\u542B\u5FAA\u73AF\u3002");
    if (!versionsById.has(inverseId)) throw new Error(`\u6062\u590D\u76EE\u6807 ${inverseId} \u4E0D\u5728\u53EF\u89C1\u7248\u672C\u6811\u4E2D\u3002`);
    undoStack.push(inverseId);
    undoCursor = versionsById.get(inverseId);
  }
  const redoSessionIds = versions.filter((version) => version.inverseSessionId === sessionId).map((version) => version.sessionId);
  const currentIndex = versions.findIndex((version) => version.current);
  const currentLog = logs[currentIndex];
  if (currentIndex < 0 || currentLog === void 0) throw new Error("\u5F53\u524D\u7248\u672C\u4E0D\u5728\u7248\u672C\u6811\u4E2D\u3002");
  const turns = closedTurns(currentLog);
  return {
    sessionId,
    messages: editableMessages(turns),
    retryableTurns: retryableTurns(turns),
    versions,
    undoStack,
    redoSessionIds
  };
}
function objectValue(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002");
  }
  return value;
}
function sessionIdOf(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("sessionId \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u3002");
  return SessionId(value);
}
function integerOf(value, name2) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name2} \u5FC5\u987B\u662F\u975E\u8D1F\u5B89\u5168\u6574\u6570\u3002`);
  return value;
}
function cascadeOf(value) {
  if (value !== "truncate" && value !== "preserve") throw new TypeError("cascade \u5FC5\u987B\u662F truncate \u6216 preserve\u3002");
  return value;
}
function decodeOperation(value) {
  const record = objectValue(value);
  const sessionId = sessionIdOf(record["sessionId"]);
  switch (record["action"]) {
    case "edit":
      if (typeof record["text"] !== "string") throw new TypeError("text \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u3002");
      return {
        action: "edit",
        sessionId,
        eventSeq: integerOf(record["eventSeq"], "eventSeq"),
        blockIndex: integerOf(record["blockIndex"], "blockIndex"),
        text: record["text"],
        cascade: cascadeOf(record["cascade"])
      };
    case "reroll":
      return { action: "reroll", sessionId };
    case "retry":
      return {
        action: "retry",
        sessionId,
        turn: integerOf(record["turn"], "turn"),
        cascade: cascadeOf(record["cascade"])
      };
    default:
      throw new TypeError("action \u5FC5\u987B\u662F edit\u3001reroll \u6216 retry\u3002");
  }
}
function requestJson(request) {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = "";
    request.on("data", (chunk) => {
      text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    });
    request.on("end", () => {
      try {
        text += decoder.decode();
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
function respondJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}
async function handleRoute(ctx, request, response) {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url ?? "/message-edit", "http://message-edit.local");
      respondJson(response, 200, await timeline(ctx, sessionIdOf(url.searchParams.get("sessionId"))));
      return;
    }
    if (request.method === "POST") {
      respondJson(response, 200, await runOperation(ctx, decodeOperation(await requestJson(request))));
      return;
    }
    response.writeHead(405);
    response.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respondJson(response, error instanceof TypeError ? 400 : 409, { error: message });
  }
}
function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: MESSAGE_EDIT_PATH,
    handler: (request, response) => handleRoute(ctx, request, response)
  }), "message-edit: HTTP route");
}
export {
  MESSAGE_EDIT_PATH,
  MESSAGE_EDIT_VERSION_SCHEMA,
  MESSAGE_EDIT_VIEW_ORDER,
  apply,
  inject,
  name
};
