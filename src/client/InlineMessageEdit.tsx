/**
 * User-message edit affordance. DSH exposes no user-message action slot (the
 * official `conversation.chat.assistant-actions` slot covers only finalized
 * assistant replies), so user rows are addressed through a MutationObserver
 * scoped to rows OUTSIDE the assistant turn-tail. Assistant rows are handled
 * by the slot entry in AssistantMessageActions.tsx.
 */
import { useEffect } from 'react'
import type { EditableMessageBlock } from '../shared.ts'
import type { MessageEditFace } from './controller.ts'
import { createOverlayHost, EDIT_PATH, REFRESH_PATH, svgIcon } from './overlay.ts'
import styles from './InlineMessageEdit.module.css'

/** Inject retry + edit icon buttons into each settled USER message action row. */
export function InlineMessageEdit({
  messages,
  edit,
  retry,
}: {
  messages: readonly EditableMessageBlock[]
  edit: MessageEditFace['edit']
  retry: MessageEditFace['retry']
}): null {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    const overlays = createOverlayHost(edit)
    const userMessages = messages.filter(message => message.kind === 'user')
    let observer: MutationObserver | undefined
    let alive = true
    let frame: number | undefined
    let scheduled = false

    const sync = (): void => {
      // Assistant rows live inside the turn-tail node and are owned by the
      // official slot; only rows outside it are user-message action rows.
      const actionRows = Array.from(document.querySelectorAll<HTMLElement>('[class*="actions"]'))
        .filter(row => row.closest('[data-turn-tail]') === null)
      const claimedEvents = new Set<number>()
      for (const row of actionRows) {
        const marker = row as HTMLElement & {
          __messageEditInjected?: boolean
          __messageEditEventSeq?: number
        }
        if (marker.__messageEditInjected === true) {
          if (marker.__messageEditEventSeq !== undefined) claimedEvents.add(marker.__messageEditEventSeq)
          continue
        }
        const text = (row.parentElement?.parentElement?.textContent ?? '').trim()
        if (text.length === 0) continue
        const matchingEvents = [...new Set(userMessages
          .filter(message => message.text.length > 0 && text.includes(message.text.slice(0, 24)))
          .map(message => message.eventSeq))]
        const eventSeq = matchingEvents.find(candidate => !claimedEvents.has(candidate))
        if (eventSeq === undefined) continue
        const blocks = userMessages.filter(message => message.eventSeq === eventSeq)
        if (blocks.length === 0) continue
        const previousMarker = marker.__messageEditInjected
        const previousEventSeq = marker.__messageEditEventSeq
        marker.__messageEditInjected = true
        marker.__messageEditEventSeq = eventSeq
        claimedEvents.add(eventSeq)

        const editButton = document.createElement('button')
        editButton.className = styles['iconButton']
        editButton.setAttribute('aria-label', '编辑消息')
        editButton.title = '编辑消息'
        editButton.appendChild(svgIcon(EDIT_PATH))
        const editMessage = (): void => {
          if (blocks.length === 1 && blocks[0] !== undefined) overlays.editBlock(blocks[0])
          else overlays.chooseBlock(blocks)
        }
        editButton.addEventListener('click', editMessage)

        const retryButton = document.createElement('button')
        retryButton.className = styles['iconButton']
        retryButton.setAttribute('aria-label', '重试此回合')
        retryButton.title = '重试此回合'
        retryButton.appendChild(svgIcon(REFRESH_PATH))
        const turn = blocks[0]?.turn
        const retryTurn = (): void => {
          if (turn !== undefined) void retry(turn, 'truncate')
        }
        retryButton.addEventListener('click', retryTurn)

        // Insert after the last official action button so injected icons
        // stay contiguous with copy/branch and the clock keeps its side.
        const officialButtons = Array.from(row.querySelectorAll('button'))
          .filter(button => button !== editButton && button !== retryButton)
        const lastOfficial = officialButtons.at(-1)
        if (lastOfficial !== undefined) {
          lastOfficial.insertAdjacentElement('afterend', retryButton)
          lastOfficial.insertAdjacentElement('afterend', editButton)
        } else {
          row.appendChild(editButton)
          row.appendChild(retryButton)
        }
        cleanups.push(() => {
          editButton.removeEventListener('click', editMessage)
          retryButton.removeEventListener('click', retryTurn)
          editButton.remove()
          retryButton.remove()
          if (previousMarker === undefined) delete marker.__messageEditInjected
          else marker.__messageEditInjected = previousMarker
          if (previousEventSeq === undefined) delete marker.__messageEditEventSeq
          else marker.__messageEditEventSeq = previousEventSeq
        })
      }
    }

    sync()
    observer = new MutationObserver(() => {
      if (!alive || scheduled) return
      scheduled = true
      frame = requestAnimationFrame(() => {
        frame = undefined
        scheduled = false
        if (alive) sync()
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      alive = false
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      overlays.dispose()
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }, [messages, edit, retry])

  return null
}
