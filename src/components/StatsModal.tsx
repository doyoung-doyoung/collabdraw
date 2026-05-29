'use client'

import { RoomUser } from '@/lib/supabase'
import styles from './Modal.module.css'
import sStyles from './StatsModal.module.css'

interface Props {
  users: RoomUser[]
  roomName: string
  canvas: HTMLCanvasElement | null
  onClose: () => void
  onLeave: () => void
}

export default function StatsModal({ users, roomName, canvas, onClose, onLeave }: Props) {
  const sorted = [...users].sort((a, b) => (b.pixel_area || 0) - (a.pixel_area || 0))
  const total = sorted.reduce((s, u) => s + (u.pixel_area || 0), 0) || 1

  const downloadStats = () => {
    const tmp = document.createElement('canvas')
    tmp.width = 600
    tmp.height = 80 + sorted.length * 72 + 60
    const tc = tmp.getContext('2d')!
    tc.fillStyle = '#0c0c1a'
    tc.fillRect(0, 0, tmp.width, tmp.height)
    tc.fillStyle = '#a78bfa'
    tc.font = 'bold 20px sans-serif'
    tc.textAlign = 'center'
    tc.fillText(`🏆 ${roomName} — CollabDraw Stats`, tmp.width / 2, 44)

    sorted.forEach((u, i) => {
      const pct = Math.round((u.pixel_area || 0) / total * 100)
      const y = 72 + i * 68
      tc.fillStyle = u.color
      tc.font = 'bold 13px sans-serif'
      tc.textAlign = 'left'
      tc.fillText(`${i + 1}. ${u.name}   ${pct}%   (${(u.pixel_area || 0).toLocaleString()} px²)`, 24, y)
      tc.fillStyle = 'rgba(255,255,255,0.08)'
      tc.fillRect(24, y + 8, 552, 14)
      tc.fillStyle = u.color
      tc.fillRect(24, y + 8, 552 * pct / 100, 14)
    })

    const link = document.createElement('a')
    link.download = `${roomName}_stats.png`
    link.href = tmp.toDataURL()
    link.click()
  }

  const downloadCanvas = () => {
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `${roomName}_drawing.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.box} ${sStyles.box}`}>
        <div className={styles.title}>🏆 Final Stats — Contribution Analysis</div>
        <div className={sStyles.roomLabel}>{roomName}</div>

        <div className={sStyles.bars}>
          {sorted.map((u, i) => {
            const pct = Math.round((u.pixel_area || 0) / total * 100)
            const area = (u.pixel_area || 0).toLocaleString()
            return (
              <div key={u.id} className={sStyles.barRow}>
                <div className={sStyles.barMeta}>
                  <span style={{ color: u.color, fontWeight: 700 }}>
                    {i + 1}. {u.name}
                  </span>
                  <span className={sStyles.barPct}>{pct}% · {area} px²</span>
                </div>
                <div className={sStyles.barTrack}>
                  <div
                    className={sStyles.barFill}
                    style={{ width: `${pct}%`, background: u.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className={sStyles.saveRow}>
          <button className={sStyles.saveBtn} style={{ background: 'rgba(124,58,237,0.25)', borderColor: 'rgba(124,58,237,0.5)', color: '#a78bfa' }} onClick={downloadStats}>
            📊 Save Stats PNG
          </button>
          <button className={sStyles.saveBtn} style={{ background: 'rgba(234,88,12,0.2)', borderColor: 'rgba(234,88,12,0.5)', color: '#fb923c' }} onClick={downloadCanvas}>
            🖼 Save Drawing PNG
          </button>
        </div>

        <div className={styles.btnRow} style={{ marginTop: '12px' }}>
          <button className={styles.btnSecondary} onClick={onClose}>Keep Drawing</button>
          <button className={styles.btnSecondary} onClick={onLeave}>Back to Lobby</button>
        </div>
      </div>
    </div>
  )
}
