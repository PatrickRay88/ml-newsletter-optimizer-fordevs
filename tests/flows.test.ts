import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  ContactStatus,
  FlowRunStatus,
  FlowStatus,
  FlowStepType,
  MessageStatus
} from "@prisma/client";
import { processDueFlowRuns, resetSendEmailImplementation, setSendEmailImplementation } from "@/lib/flows";
import { prisma } from "@/lib/prisma";

type StepConfig = Record<string, unknown> | null;

const delegateRestorers: Array<() => void> = [];

function stubMethod(target: unknown, key: string, implementation: Function) {
  if (!target || typeof target !== "object") {
    throw new TypeError("Stub target must be an object");
  }

  if (typeof implementation !== "function") {
    throw new TypeError("Stub implementation must be a function");
  }

  const record = target as Record<string, unknown>;
  const original = record[key];

  if (typeof original !== "function") {
    throw new TypeError(`Property ${key} is not a function`);
  }

  const descriptor = Object.getOwnPropertyDescriptor(record, key);

  if (descriptor && !descriptor.writable && !descriptor.set) {
    if (!descriptor.configurable) {
      throw new TypeError(`Property ${key} is not configurable`);
    }

    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      writable: true,
      value: implementation
    });

    delegateRestorers.push(() => {
      Object.defineProperty(record, key, descriptor);
    });
    return;
  }

  record[key] = implementation;
  delegateRestorers.push(() => {
    record[key] = original;
  });
}

afterEach(() => {
  while (delegateRestorers.length > 0) {
    const restore = delegateRestorers.pop();
    restore?.();
  }
  resetSendEmailImplementation();
  mock.restoreAll();
});

function buildStep(order: number, type: FlowStepType, config: StepConfig = null) {
  return {
    id: `step-${order}`,
    order,
    type,
    config,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    flowId: "flow-1"
  };
}

describe("processDueFlowRuns", () => {
  it("reschedules runs when delay steps require waiting", async () => {
    const now = new Date("2026-01-30T12:00:00Z");
    const steps = [
      buildStep(1, FlowStepType.TRIGGER, { eventName: "user.signup" }),
      buildStep(2, FlowStepType.DELAY, { minutes: 45 }),
      buildStep(3, FlowStepType.SEND_TEMPLATE, { templateId: "template-1" })
    ];

    const run = {
      id: "run-delay",
      flowId: "flow-1",
      contactId: "contact-1",
      status: FlowRunStatus.PENDING,
      nextStepOrder: 2,
      scheduledAt: now,
      startedAt: null,
      completedAt: null,
      cancelledReason: null,
      context: null,
      createdAt: now,
      updatedAt: now,
      flow: {
        id: "flow-1",
        name: "Delay Flow",
        status: FlowStatus.ACTIVE,
        triggerEventName: "user.signup",
        delayMinutes: 45,
        useOptimizer: true,
        segmentId: null,
        templateId: "template-1",
        metadata: null,
        createdAt: now,
        updatedAt: now,
        steps,
        template: { id: "template-1", subject: "Welcome", html: "<p>Hi</p>" },
        segment: null
      },
      contact: {
        id: "contact-1",
        email: "demo@resend.dev",
        status: ContactStatus.ACTIVE,
        tags: [],
        timezone: null,
        lastMessageSentAt: null
      }
    };

    const findManyMock = mock.fn(async () => [run]);
    stubMethod(prisma.flowRun, "findMany", findManyMock);

    const updateCalls: Array<Parameters<typeof prisma.flowRun.update>[0]> = [];
    const updateMock = mock.fn(async (args: Parameters<typeof prisma.flowRun.update>[0]) => {
      updateCalls.push(args);
      return run as unknown as Awaited<ReturnType<typeof prisma.flowRun.update>>;
    });
    stubMethod(prisma.flowRun, "update", updateMock);

    const segmentMembershipMock = mock.fn(async () => ({ id: "membership" }));
    stubMethod(prisma.segmentMembership, "findFirst", segmentMembershipMock);

    const summary = await processDueFlowRuns({ now, limit: 5 });

    assert.equal(findManyMock.mock.callCount(), 1);
    assert.equal(summary.evaluated, 1);
    assert.equal(summary.rescheduled, 1);
    assert.equal(summary.completed, 0);

    assert.equal(updateCalls.length, 1);
    const [updateArgs] = updateCalls;
    assert.equal(updateArgs?.data?.status, FlowRunStatus.WAITING);
    assert.equal(updateArgs?.data?.nextStepOrder, 3);
    const scheduledAt = updateArgs?.data?.scheduledAt as Date;
    assert.ok(scheduledAt instanceof Date);
    assert.ok(scheduledAt.getTime() > now.getTime());
  });

  it("sends immediately when optimizer disabled", async () => {
    const now = new Date("2026-01-30T12:30:00Z");
    const steps = [
      buildStep(1, FlowStepType.TRIGGER, { eventName: "user.signup" }),
      buildStep(2, FlowStepType.SEND_TEMPLATE, { templateId: "template-2" })
    ];

    const run = {
      id: "run-send",
      flowId: "flow-2",
      contactId: "contact-2",
      status: FlowRunStatus.PENDING,
      nextStepOrder: 2,
      scheduledAt: now,
      startedAt: null,
      completedAt: null,
      cancelledReason: null,
      context: null,
      createdAt: now,
      updatedAt: now,
      flow: {
        id: "flow-2",
        name: "Welcome Flow",
        status: FlowStatus.ACTIVE,
        triggerEventName: "user.signup",
        delayMinutes: null,
        useOptimizer: false,
        segmentId: null,
        templateId: "template-2",
        metadata: null,
        createdAt: now,
        updatedAt: now,
        steps,
        template: { id: "template-2", subject: "Welcome!", html: "<p>Hello</p>" },
        segment: null
      },
      contact: {
        id: "contact-2",
        email: "demo+welcome@resend.dev",
        status: ContactStatus.ACTIVE,
        tags: ["signup"],
        timezone: "America/New_York",
        lastMessageSentAt: null
      }
    };

    stubMethod(prisma.flowRun, "findMany", mock.fn(async () => [run]));

    const updateCalls: Array<Parameters<typeof prisma.flowRun.update>[0]> = [];
    const updateMock = mock.fn(async (args: Parameters<typeof prisma.flowRun.update>[0]) => {
      updateCalls.push(args);
      return run as unknown as Awaited<ReturnType<typeof prisma.flowRun.update>>;
    });
    stubMethod(prisma.flowRun, "update", updateMock);

    const messageCalls: Array<Parameters<typeof prisma.message.create>[0]> = [];
    const messageCreateMock = mock.fn(async (args: Parameters<typeof prisma.message.create>[0]) => {
      messageCalls.push(args);
      return { id: "message-1", status: MessageStatus.SENT } as unknown as Awaited<ReturnType<typeof prisma.message.create>>;
    });
    stubMethod(prisma.message, "create", messageCreateMock);

    const contactUpdates: Array<Parameters<typeof prisma.contact.update>[0]> = [];
    const contactUpdateMock = mock.fn(async (args: Parameters<typeof prisma.contact.update>[0]) => {
      contactUpdates.push(args);
      return { id: run.contactId } as unknown as Awaited<ReturnType<typeof prisma.contact.update>>;
    });
    stubMethod(prisma.contact, "update", contactUpdateMock);
    stubMethod(prisma.segmentMembership, "findFirst", mock.fn(async () => ({ id: "membership" })));
    const sendMock = mock.fn(async () => ({ id: "resend-123" }));
    setSendEmailImplementation(sendMock);
    const transactionMock = mock.fn(async (operations: Parameters<typeof prisma.$transaction>[0]) => {
      if (Array.isArray(operations)) {
        return Promise.all(operations as Promise<unknown>[]) as unknown as ReturnType<typeof prisma.$transaction>;
      }
      return [] as unknown as ReturnType<typeof prisma.$transaction>;
    });
    stubMethod(prisma, "$transaction", transactionMock);

    const summary = await processDueFlowRuns({ now, limit: 5 });

    assert.equal(summary.completed, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.rescheduled, 0);

    assert.equal(messageCalls.length, 1);
    const messageData = messageCalls[0]?.data as Record<string, unknown>;
    assert.equal(messageData?.status, MessageStatus.SENT);
    assert.equal(messageData?.flowRunId, run.id);

    assert.equal(contactUpdates.length, 1);
    assert.ok(contactUpdates[0]?.data?.lastMessageSentAt instanceof Date);

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.data?.status, FlowRunStatus.COMPLETED);

    assert.equal(sendMock.mock.callCount(), 1);
  });

  it("cancels runs when segment filter no longer matches", async () => {
    const now = new Date("2026-01-30T13:00:00Z");
    const steps = [
      buildStep(1, FlowStepType.TRIGGER, { eventName: "user.signup" }),
      buildStep(2, FlowStepType.SEGMENT_FILTER, { segmentId: "segment-1" }),
      buildStep(3, FlowStepType.SEND_TEMPLATE, { templateId: "template-3" })
    ];

    const run = {
      id: "run-segment",
      flowId: "flow-3",
      contactId: "contact-3",
      status: FlowRunStatus.PENDING,
      nextStepOrder: 2,
      scheduledAt: now,
      startedAt: null,
      completedAt: null,
      cancelledReason: null,
      context: null,
      createdAt: now,
      updatedAt: now,
      flow: {
        id: "flow-3",
        name: "Segmented Flow",
        status: FlowStatus.ACTIVE,
        triggerEventName: "user.signup",
        delayMinutes: null,
        useOptimizer: true,
        segmentId: "segment-1",
        templateId: "template-3",
        metadata: null,
        createdAt: now,
        updatedAt: now,
        steps,
        template: { id: "template-3", subject: "Segment", html: "<p>Segment</p>" },
        segment: { id: "segment-1", name: "Beta", isSystem: false }
      },
      contact: {
        id: "contact-3",
        email: "demo+segment@resend.dev",
        status: ContactStatus.ACTIVE,
        tags: [],
        timezone: null,
        lastMessageSentAt: null
      }
    };

      stubMethod(prisma.flowRun, "findMany", mock.fn(async () => [run]));

      const updateCalls: Array<Parameters<typeof prisma.flowRun.update>[0]> = [];
      const updateMock = mock.fn(async (args: Parameters<typeof prisma.flowRun.update>[0]) => {
      updateCalls.push(args);
      return run as unknown as Awaited<ReturnType<typeof prisma.flowRun.update>>;
    });
      stubMethod(prisma.flowRun, "update", updateMock);
      stubMethod(prisma.segmentMembership, "findFirst", mock.fn(async () => null));

    const summary = await processDueFlowRuns({ now, limit: 5 });

    assert.equal(summary.cancelled, 1);
    assert.equal(summary.completed, 0);
    assert.equal(summary.rescheduled, 0);

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.data?.status, FlowRunStatus.CANCELLED);
    assert.equal(updateCalls[0]?.data?.cancelledReason, "Contact no longer in segment");
  });
});
