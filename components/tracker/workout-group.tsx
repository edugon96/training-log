"use client"
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowUp,
  ChevronDown,
  Pencil,
  Plus,
  MessageSquare,
  Trash2,
} from "lucide-react"
import type { WorkoutBlock } from "@/contracts/models"
import { cleanBlockTitle } from "@/lib/presentation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ActionMenu } from "./responsive-panel"
import { Field, Instructions, Modal } from "./shared"

export function WorkoutGroup({
  block,
  children,
  readOnly = false,
  focusOnMount = false,
  expandVersion = 0,
  onChange,
  onAdd,
  onRemove,
  onReorder,
}: {
  block: WorkoutBlock
  children: ReactNode
  readOnly?: boolean
  focusOnMount?: boolean
  expandVersion?: number
  onChange: (patch: Partial<WorkoutBlock>) => void
  onAdd: () => void
  onRemove: () => void
  onReorder: () => void
}) {
  const [collapsedAt, setCollapsedAt] = useState<number | null>(null)
  const collapsed = collapsedAt === expandVersion
  const [edit, setEdit] = useState<"name" | "instructions" | null>(null)
  const [value, setValue] = useState("")
  const heading = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (focusOnMount) {
      heading.current?.scrollIntoView({ block: "nearest" })
      heading.current?.focus({ preventScroll: true })
    }
  }, [focusOnMount])
  const name = cleanBlockTitle(block.title)
  function editField(field: "name" | "instructions") {
    setValue(field === "name" ? block.title : block.notes)
    setEdit(field)
  }
  return (
    <section className="workout-group" aria-label={name}>
      <div className="workout-group-heading">
        <button
          ref={heading}
          type="button"
          className="workout-group-toggle"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`}
          aria-expanded={!collapsed}
          aria-controls={`group-content-${block.id}`}
          onClick={() => setCollapsedAt(collapsed ? null : expandVersion)}
        >
          <span>
            <span role="heading" aria-level={2} className="workout-group-title">
              {name}
            </span>
            <small>
              {block.items.length}{" "}
              {block.items.length === 1 ? "movement" : "movements"}
              {block.rounds ? ` · ${block.rounds} planned rounds` : ""}
            </small>
          </span>
          <ChevronDown size={18} className={collapsed ? "is-collapsed" : ""} />
        </button>
        {!readOnly && (
          <ActionMenu
            label={`${name} group actions`}
            actions={[
              {
                label: "Rename group",
                icon: Pencil,
                onSelect: () => editField("name"),
              },
              {
                label: "Edit instructions",
                icon: MessageSquare,
                onSelect: () => editField("instructions"),
              },
              { label: "Reorder groups", icon: ArrowUp, onSelect: onReorder },
              {
                label: "Remove group",
                icon: Trash2,
                destructive: true,
                separator: true,
                onSelect: onRemove,
              },
            ]}
          />
        )}
      </div>
      <div id={`group-content-${block.id}`} hidden={collapsed}>
        {block.notes && (
          <div className="group-instructions">
            <Instructions text={block.notes} />
          </div>
        )}
        {children}
        {!readOnly && (
          <Button
            className="group-add-movements"
            variant="outline"
            onClick={onAdd}
          >
            <Plus size={16} /> Add movements
          </Button>
        )}
      </div>
      {edit && (
        <Modal
          title={edit === "name" ? "Rename group" : "Group instructions"}
          onClose={() => setEdit(null)}
        >
          <Field label={edit === "name" ? "Group name" : "Instructions"}>
            {edit === "name" ? (
              <Input
                autoFocus
                value={value}
                maxLength={200}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <Textarea
                autoFocus
                value={value}
                placeholder="Optional"
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
          <div className="dialog-footer">
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              disabled={edit === "name" && !value.trim()}
              onClick={() => {
                onChange(
                  edit === "name" ? { title: value.trim() } : { notes: value }
                )
                setEdit(null)
              }}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}

export function MoveToGroup({
  blocks,
  itemId,
  onMove,
  onClose,
}: {
  blocks: WorkoutBlock[]
  itemId: string
  onMove: (destination: string | null) => void
  onClose: () => void
}) {
  return (
    <Modal title="Move to group" onClose={onClose}>
      <div className="panel-options">
        {blocks.map((block) => (
          <button
            type="button"
            key={block.id}
            disabled={block.items.some((item) => item.id === itemId)}
            onClick={() => onMove(block.id)}
          >
            {cleanBlockTitle(block.title)}
          </button>
        ))}
        <button type="button" onClick={() => onMove(null)}>
          <span>New group</span>
          <Plus size={18} />
        </button>
      </div>
    </Modal>
  )
}
