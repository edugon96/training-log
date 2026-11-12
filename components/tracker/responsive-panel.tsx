"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { Drawer } from "vaul"
import { MoreVertical, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

const query = "(max-width: 1023px)"
function subscribe(listener: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}
export function useMobilePanel() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
const PanelDepth = createContext(0)

export function ResponsivePanel({
  title,
  description,
  children,
  onClose,
  dirty = false,
  editor = false,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  dirty?: boolean
  editor?: boolean
}) {
  const mobile = useMobilePanel()
  const depth = useContext(PanelDepth)
  const [discard, setDiscard] = useState(false)
  const close = () => (dirty ? setDiscard(true) : onClose())
  const content = (
    <PanelDepth.Provider value={depth + 1}>{children}</PanelDepth.Provider>
  )
  const Root = depth ? Drawer.NestedRoot : Drawer.Root
  return (
    <>
      {mobile ? (
        <Root
          open
          onOpenChange={(open) => {
            if (!open) close()
          }}
          shouldScaleBackground={false}
          repositionInputs
        >
          <Drawer.Portal>
            <Drawer.Overlay className="mobile-panel-overlay" />
            <Drawer.Content
              className={["mobile-panel", editor && "workout-editor-panel"]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="mobile-panel-grip">
                <Drawer.Handle aria-label="Drag down to close" />
              </div>
              <div className="mobile-panel-heading">
                <Drawer.Title>{title}</Drawer.Title>
                <Drawer.Description className={description ? "" : "sr-only"}>
                  {description || title}
                </Drawer.Description>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  onClick={close}
                >
                  <X size={20} />
                </Button>
              </div>
              <div className="mobile-panel-body">{content}</div>
            </Drawer.Content>
          </Drawer.Portal>
        </Root>
      ) : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) close()
          }}
        >
          <DialogContent
            className={["tracker-dialog", editor && "workout-editor-panel"]
              .filter(Boolean)
              .join(" ")}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className={description ? "" : "sr-only"}>
                {description || title}
              </DialogDescription>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      )}
      {discard && (
        <PanelDepth.Provider value={depth + 1}>
          <ResponsivePanel
            title="Discard changes?"
            description="Your unsaved changes will be lost."
            onClose={() => setDiscard(false)}
          >
            <div className="dialog-footer">
              <Button variant="outline" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" onClick={onClose}>
                Discard changes
              </Button>
            </div>
          </ResponsivePanel>
        </PanelDepth.Provider>
      )}
    </>
  )
}

export type MenuAction = {
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  separator?: boolean
}
export function ActionMenu({
  label,
  actions,
}: {
  label: string
  actions: MenuAction[]
}) {
  const [open, setOpen] = useState(false)
  const mobile = useMobilePanel()
  if (mobile)
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="overflow-menu-trigger"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MoreVertical size={20} aria-hidden="true" />
        </Button>
        {open && (
          <ResponsivePanel title={label} onClose={() => setOpen(false)}>
            <div role="menu" aria-label={label} className="mobile-action-menu">
              {actions.map((action) => (
                <button
                  key={action.label}
                  role="menuitem"
                  disabled={action.disabled}
                  className={[
                    action.destructive && "is-destructive",
                    action.separator && "menu-divider",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setOpen(false)
                    action.onSelect()
                  }}
                >
                  <action.icon size={16} strokeWidth={2} />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </ResponsivePanel>
        )}
      </>
    )
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="overflow-menu-trigger"
          aria-label={label}
        >
          <MoreVertical size={20} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="action-menu">
        {actions.map((action) => (
          <div key={action.label}>
            {action.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={action.onSelect}
            >
              <action.icon size={16} strokeWidth={2} />
              {action.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Confirmation = { message: string; resolve: (answer: boolean) => void }
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent<Confirmation>("training:confirm", {
        detail: { message, resolve },
      })
    )
  )
}
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<Confirmation[]>([])
  useEffect(() => {
    const listen = (event: Event) =>
      setRequests((current) => [
        ...current,
        (event as CustomEvent<Confirmation>).detail,
      ])
    window.addEventListener("training:confirm", listen)
    return () => window.removeEventListener("training:confirm", listen)
  }, [])
  const current = requests[0]
  function answer(value: boolean) {
    current?.resolve(value)
    setRequests((requests) => requests.slice(1))
  }
  return (
    <>
      {children}
      {current && (
        <ResponsivePanel
          title="Confirm change"
          description={current.message}
          onClose={() => answer(false)}
        >
          <div className="dialog-footer">
            <Button variant="outline" onClick={() => answer(false)}>
              Cancel
            </Button>
            <Button onClick={() => answer(true)}>Continue</Button>
          </div>
        </ResponsivePanel>
      )}
    </>
  )
}
