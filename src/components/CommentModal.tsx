'use client'

import { useState } from 'react'
import styles from './Modal.module.css'

interface Props {
  onSubmit: (content: string) => void
  onCancel: () => void
}

export default function CommentModal({ onSubmit, onCancel }: Props) {
  const [text, setText] = useState('')

  return (
    <div className={styles.overlay}>
      <div className={styles.box}>
        <div className={styles.title}>💬 Add Comment</div>
        <textarea
          className={styles.textarea}
          placeholder="Type your comment here..."
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          autoFocus
        />
        <div className={styles.btnRow}>
          <button className={styles.btnPrimary} onClick={() => text.trim() && onSubmit(text.trim())}>Add</button>
          <button className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
