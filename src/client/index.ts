/** Message Edit browser half: Timeline view and compact conversation-header controls. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MESSAGE_EDIT_VIEW_ORDER } from '../shared.ts'
import { AssistantMessageActions } from './AssistantMessageActions.tsx'
import { MessageEditController } from './controller.ts'
import { MessageEditHeader } from './MessageEditHeader.tsx'
import { MessageEditTimelineView } from './MessageEditTimelineView.tsx'

/** Explicit value sources and slot declaration-order edges. */
export const inject = ['slots', 'conversation', 'connection', 'sessions']

/** Register both UI contributions over one per-session controller identity. */
export function apply(ctx: ClientContext): void {
  const controllers = new Map<SessionId, MessageEditController>()
  const controllerFor = (sessionId: SessionId): MessageEditController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new MessageEditController(ctx, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.refreshIfLoaded()
  })

  ctx.slots.register({
    name: 'conversation.view',
    id: 'message-edit-timeline',
    order: MESSAGE_EDIT_VIEW_ORDER,
    label: 'Timeline',
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, MessageEditTimelineView)

  ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'message-edit-controls',
    order: MESSAGE_EDIT_VIEW_ORDER,
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, MessageEditHeader)

  // Assistant-message edit/retry rides the official per-message action slot;
  // user messages have no slot and stay on the DOM-injection path.
  ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'message-edit-assistant-actions',
    order: MESSAGE_EDIT_VIEW_ORDER,
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, AssistantMessageActions)
}
