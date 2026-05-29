'use client'

import { useState } from 'react'
import styles from './Modal.module.css'

interface Props {
  onSet: (minutes: number) => void
  onSkip: () => void
}

export default function TimerModal({ onSet, onSkip }: Props) {
  const [minutes, setMinutes] = useState('')

  const handleSet = () => {
    const m = parseInt(minutes)
    if (!m || m <= 0) { alert('Please enter a valid number of minutes'); return }
    onSet(m)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.box}>
        <div className={styles.title}>⏱ Set Time Limit</div>
        <p className={styles.sub}>Host only · Optional</p>
        <input
          type="number"
          className={styles.input}
          placeholder="Minutes (e.g. 30)"
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          min="1"
          max="999"
          onKeyDown={e => e.key === 'Enter' && handleSet()}
          autoFocus
        />
        <div className={styles.btnRow}>
          <button className={styles.btnPrimary} onClick={handleSet}>⏱ Set Timer</button>
          <button className={styles.btnSecondary} onClick={onSkip}>No Limit</button>
        </div>
      </div>
    </div>
  )
}
