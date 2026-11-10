import { useEffect, useRef } from 'react'

export default function Dialog({ label, onClose, children, busy = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-label={label} className="asset-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose() }}>{children}</dialog>
}
