/**
 * Assistant-message action strip: the official `conversation.chat.assistant-actions`
 * slot dispatches on the closing assistant message's stable `messageId`, so the
 * edit + retry affordance rides the platform slot instead of a MutationObserver.
 * User messages have no equivalent slot and stay on the DOM-injection path.
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageEditFace } from './controller.ts'
import { createOverlayHost, EDIT_PATH, REFRESH_PATH } from './overlay.ts'
import styles from './InlineMessageEdit.module.css'

type AssistantMessageActionsProps = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<MessageEditFace>

function Icon({ path }: { path: string }): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  )
}

/** Per-message action strip for one finalized assistant reply. */
export function AssistantMessageActions({
  messageId,
  useMessageEdit,
  acquire,
  load,
  edit,
  retry,
}: AssistantMessageActionsProps): ReactNode {
  const state = useMessageEdit(value => value)

  useEffect(() => {
    const release = acquire()
    load()
    return release
  }, [acquire, load])

  const blocks = useMemo(
    () => (state.timeline?.messages ?? []).filter(message => message.messageId === messageId),
    [state.timeline, messageId],
  )

  const overlays = useMemo(() => createOverlayHost(edit), [edit])
  useEffect(() => () => overlays.dispose(), [overlays])

  if (blocks.length === 0) return null
  const turn = blocks[0]?.turn

  const editMessage = (): void => {
    if (blocks.length === 1 && blocks[0] !== undefined) overlays.editBlock(blocks[0])
    else overlays.chooseBlock(blocks)
  }

  return (
    <>
      <button
        type="button"
        className={styles['iconButton']}
        aria-label="编辑消息"
        title="编辑消息"
        onClick={editMessage}
      >
        <Icon path={EDIT_PATH} />
      </button>
      <button
        type="button"
        className={styles['iconButton']}
        aria-label="重试此回合"
        title="重试此回合"
        onClick={() => { if (turn !== undefined) void retry(turn, 'truncate') }}
      >
        <Icon path={REFRESH_PATH} />
      </button>
    </>
  )
}
