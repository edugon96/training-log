"use client"
import { useRef } from "react"
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkoutBlock } from "@/contracts/models"
import { ResponsivePanel } from "./responsive-panel"
import { move } from "./shared"

export function MovementReorderPanel({
  blocks,
  onChange,
  onClose,
}: {
  blocks: WorkoutBlock[]
  onChange: (blocks: WorkoutBlock[]) => void
  onClose: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  return (
    <ResponsivePanel title="Organize workout" onClose={onClose}>
      <div className="movement-reorder-list" ref={list}>
        {blocks.map((block, index) => (
          <div
            className="movement-reorder-block"
            key={block.id}
            data-reorder-block={index}
          >
            <div className="movement-reorder-row">
              <span>{block.title}</span>
              <Button
                variant="ghost"
                size="icon"
                disabled={!index}
                aria-label={`Move ${block.title} up`}
                onClick={() => onChange(move(blocks, index, -1))}
              >
                <ArrowUp size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === blocks.length - 1}
                aria-label={`Move ${block.title} down`}
                onClick={() => onChange(move(blocks, index, 1))}
              >
                <ArrowDown size={17} />
              </Button>
              <button
                type="button"
                className="movement-drag-handle"
                aria-label={`Drag ${block.title} to reorder`}
                onPointerDown={(event) => {
                  drag.current = index
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerCancel={() => {
                  drag.current = null
                }}
                onPointerUp={(event) => {
                  const start = drag.current
                  drag.current = null
                  if (start === null || !list.current) return
                  const rows = Array.from(list.current.children)
                  const end = rows.findIndex((row) => {
                    const rect = row.getBoundingClientRect()
                    return (
                      event.clientY >= rect.top && event.clientY <= rect.bottom
                    )
                  })
                  if (end < 0 || end === start) return
                  const next = [...blocks]
                  next.splice(end, 0, ...next.splice(start, 1))
                  onChange(next)
                }}
              >
                <GripVertical size={20} />
              </button>
            </div>
            {block.items.length > 0 &&
              block.items.map((item, itemIndex) => (
                <div
                  className="movement-reorder-row movement-reorder-child"
                  key={item.id}
                >
                  <span>{item.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!itemIndex}
                    aria-label={`Move ${item.name} up in group`}
                    onClick={() =>
                      onChange(
                        blocks.map((value) =>
                          value.id === block.id
                            ? {
                                ...value,
                                items: move(value.items, itemIndex, -1),
                              }
                            : value
                        )
                      )
                    }
                  >
                    <ArrowUp size={17} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={itemIndex === block.items.length - 1}
                    aria-label={`Move ${item.name} down in group`}
                    onClick={() =>
                      onChange(
                        blocks.map((value) =>
                          value.id === block.id
                            ? {
                                ...value,
                                items: move(value.items, itemIndex, 1),
                              }
                            : value
                        )
                      )
                    }
                  >
                    <ArrowDown size={17} />
                  </Button>
                </div>
              ))}
          </div>
        ))}
      </div>
      <Button className="mt-4 w-full" onClick={onClose}>
        Done
      </Button>
    </ResponsivePanel>
  )
}
