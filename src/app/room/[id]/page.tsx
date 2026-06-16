'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Room, RoomUser, Stroke, Comment, ChatMessage } from '@/lib/supabase'
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS_100, PEN_EMOJIS, CHAT_EMOJIS } from '@/lib/constants'
import styles from './room.module.css'
import TimerModal from '@/components/TimerModal'
import StatsModal from '@/components/StatsModal'
import CommentModal from '@/components/CommentModal'

type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'eraser' | 'fill' | 'text'

type RemoteCursor = { userId: string; name: string; color: string; x: number; y: number }

export default function RoomPage() {
  const { id: roomId } = useParams<{ id: string }>()
  const router = useRouter()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [room, setRoom] = useState<Room | null>(null)
  const [users, setUsers] = useState<RoomUser[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({})

  const [myId] = useState(() => sessionStorage.getItem('collabdraw_uid') || '')
  const [myName] = useState(() => sessionStorage.getItem('collabdraw_name') || 'Guest')
  const [myColor] = useState(() => sessionStorage.getItem('collabdraw_color') || '#7c3aed')
  const [isHost, setIsHost] = useState(false)

  const [tool, setTool] = useState<Tool>('pen')
  const [size, setSize] = useState(4)
  const [color, setColor] = useState(myColor)
  const [penEmoji, setPenEmoji] = useState<string | null>(null)

  const [zoom, setZoom] = useState(0.4)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const lastTouchDistance = useRef<number | null>(null)

  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const currentStroke = useRef<{ x: number; y: number }[]>([])
  const pixelArea = useRef(0)

  /* ── Undo / Redo ── */
  const strokeHistory = useRef<number[]>([])
  const undoStack = useRef<Stroke[]>([])

  /* ── Cursor broadcast ── */
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lastCursorBroadcast = useRef(0)

  /* ── Timelapse ── */
  const [showTimelapse, setShowTimelapse] = useState(false)
  const [timelapseProgress, setTimelapseProgress] = useState(0)
  const timelapseRunning = useRef(false)

  const [commentMode, setCommentMode] = useState(false)
  const [pendingCommentPos, setPendingCommentPos] = useState<{ x: number; y: number } | null>(null)

  const [showTimerModal, setShowTimerModal] = useState(false)
  const [showStatsModal, setShowStatsModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState(false)

  const [timerLeft, setTimerLeft] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [showMobileTools, setShowMobileTools] = useState(false)
  const [showMobileChat, setShowMobileChat] = useState(false)

  const emojiFollowerRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const getCtx = () => canvasRef.current?.getContext('2d') || null
  const getOctx = () => overlayRef.current?.getContext('2d') || null

  /* ── Canvas draw ── */
  const drawStroke = useCallback((s: Stroke) => {
    const ctx = getCtx()
    if (!ctx || !s.points || s.points.length < 1) return
    ctx.save()

    if (s.tool === 'image' && s.points.length >= 2 && s.emoji) {
      const img = new Image()
      img.onload = () => {
        const [a, b] = [s.points[0], s.points[1]]
        ctx.drawImage(img, a.x, a.y, b.x - a.x, b.y - a.y)
      }
      img.src = s.emoji
      ctx.restore()
      return
    }

    if (s.points.length < 2) { ctx.restore(); return }

    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = s.user_color
    }
    ctx.lineWidth = s.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (s.tool === 'pen' || s.tool === 'eraser') {
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
      if (s.emoji && s.tool === 'pen') {
        ctx.font = `${s.size + 10}px serif`
        s.points.forEach((p, i) => { if (i % 8 === 0) ctx.fillText(s.emoji!, p.x, p.y) })
      }
    } else if (s.tool === 'line') {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    } else if (s.tool === 'rect') {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    } else if (s.tool === 'circle') {
      const [a, b] = [s.points[0], s.points[s.points.length - 1]]
      const rx = (b.x - a.x) / 2, ry = (b.y - a.y) / 2
      ctx.beginPath(); ctx.ellipse(a.x + rx, a.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); ctx.stroke()
    } else if (s.tool === 'text' && s.emoji) {
      ctx.font = `${s.size * 4 + 12}px sans-serif`
      ctx.fillStyle = s.user_color
      ctx.fillText(s.emoji, s.points[0].x, s.points[0].y)
    }
    ctx.restore()
  }, [])

  const redrawCanvas = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    const { data } = await supabase.from('strokes').select('*').eq('room_id', roomId).order('id')
    if (data) data.forEach(s => drawStroke(s as Stroke))
  }, [roomId, drawStroke])

  /* ── Init ── */
  useEffect(() => {
    if (!roomId || !myId) return
    loadRoom()
    loadStrokes()
    loadComments()
    loadUsers()
    loadChat()
    subscribeAll()
    return () => { supabase.removeAllChannels() }
  }, [roomId, myId])

  /* ── Auto-remove user when tab/window closes ── */
  useEffect(() => {
    if (!myId || !roomId) return
    const handleBeforeUnload = () => {
      fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/room_users?id=eq.${myId}&room_id=eq.${roomId}`, {
        method: 'DELETE',
        headers: {
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
        },
        keepalive: true,
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [myId, roomId])

  /* ── Keyboard shortcuts: Undo / Redo ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /* ── Image paste ── */
  useEffect(() => {
    if (!roomId || !myId) return
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      for (const item of Array.from(e.clipboardData.items)) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = async (ev) => {
          const img = new Image()
          img.onload = async () => {
            const maxW = 800, maxH = 600
            const scale = Math.min(1, maxW / img.width, maxH / img.height)
            const w = Math.round(img.width * scale)
            const h = Math.round(img.height * scale)
            const x = Math.round((CANVAS_WIDTH - w) / 2)
            const y = Math.round((CANVAS_HEIGHT - h) / 2)
            getCtx()?.drawImage(img, x, y, w, h)
            const tmp = document.createElement('canvas')
            tmp.width = w; tmp.height = h
            tmp.getContext('2d')!.drawImage(img, 0, 0, w, h)
            const dataUrl = tmp.toDataURL('image/jpeg', 0.5)
            const stroke: Stroke = {
              room_id: roomId, user_id: myId, user_color: myColor,
              tool: 'image' as Tool, points: [{ x, y }, { x: x + w, y: y + h }], size: 1, emoji: dataUrl,
            }
            const { data: ins } = await supabase.from('strokes').insert(stroke).select('id').single()
            if (ins?.id) strokeHistory.current.push(ins.id as number)
          }
          img.src = ev.target?.result as string
        }
        reader.readAsDataURL(file)
        break
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [roomId, myId, myColor])

  const loadRoom = async () => {
    const { data } = await supabase.from('rooms').select('*').eq('id', roomId).single()
    if (!data) { router.push('/'); return }
    if (data.is_ended) { alert('This room has already ended'); router.push('/'); return }
    setRoom(data)
    setIsHost(data.host_id === myId)
    if (data.host_id === myId) setShowTimerModal(true)
    if (data.timer_seconds > 0 && data.timer_started_at && !data.timer_paused) {
      const elapsed = Math.floor((Date.now() - new Date(data.timer_started_at).getTime()) / 1000)
      const left = data.timer_seconds - elapsed
      if (left > 0) { setTimerLeft(left); setTimerActive(true) }
    }
  }

  const loadStrokes = async () => {
    const { data } = await supabase.from('strokes').select('*').eq('room_id', roomId).order('id')
    if (data) data.forEach(s => drawStroke(s))
  }

  const loadComments = async () => {
    const { data } = await supabase.from('comments').select('*').eq('room_id', roomId)
    if (data) setComments(data)
  }

  const loadUsers = async () => {
    const { data } = await supabase.from('room_users').select('*').eq('room_id', roomId)
    if (data) setUsers(data)
  }

  const loadChat = async () => {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', roomId).order('id').limit(100)
    if (data) setChatMessages(data)
  }

  const subscribeAll = () => {
    const ch = supabase.channel('room_' + roomId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) drawStroke(payload.new as Stroke) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_users', filter: `room_id=eq.${roomId}` },
        () => loadUsers())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) setChatMessages(prev => [...prev.slice(-99), payload.new as ChatMessage]) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `room_id=eq.${roomId}` },
        payload => { if (payload.new.user_id !== myId) setComments(prev => [...prev, payload.new as Comment]) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        payload => {
          const r = payload.new as Room
          setRoom(r)
          if (r.is_ended && r.host_id !== myId) { setShowStatsModal(true) }
          if (r.timer_seconds > 0 && r.timer_started_at && !r.timer_paused && !timerActive) {
            const elapsed = Math.floor((Date.now() - new Date(r.timer_started_at).getTime()) / 1000)
            const left = r.timer_seconds - elapsed
            if (left > 0) { setTimerLeft(left); setTimerActive(true) }
          }
          if (r.timer_paused) { setTimerActive(false) }
        })
      .on('broadcast', { event: 'cursor' }, ({ payload }: { payload: RemoteCursor }) => {
        if (payload.userId !== myId) {
          setRemoteCursors(prev => ({ ...prev, [payload.userId]: payload }))
        }
      })
      .on('broadcast', { event: 'cursor_leave' }, ({ payload }: { payload: { userId: string } }) => {
        setRemoteCursors(prev => { const n = { ...prev }; delete n[payload.userId]; return n })
      })
      .subscribe()
    channelRef.current = ch
  }

  const broadcastCursor = (pos: { x: number; y: number }) => {
    const now = Date.now()
    if (now - lastCursorBroadcast.current < 50) return
    lastCursorBroadcast.current = now
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: myId, name: myName, color: myColor, x: pos.x, y: pos.y },
    })
  }

  /* ── Timer ── */
  useEffect(() => {
    if (timerActive && timerLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimerLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!)
            setTimerActive(false)
            setShowStatsModal(true)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else if (!timerActive && timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timerActive])

  const handleTimerSet = async (minutes: number) => {
    setShowTimerModal(false)
    if (minutes <= 0) return
    const seconds = minutes * 60
    await supabase.from('rooms').update({
      timer_seconds: seconds,
      timer_started_at: new Date().toISOString(),
      timer_paused: false,
    }).eq('id', roomId)
    setTimerLeft(seconds)
    setTimerActive(true)
  }

  const handleTimerStop = async () => {
    if (!room || room.timer_pause_used) return
    await supabase.from('rooms').update({ timer_paused: true, timer_pause_used: true }).eq('id', roomId)
    setTimerActive(false)
    setTimeout(async () => {
      const { data } = await supabase.from('rooms').select('timer_started_at,timer_seconds').eq('id', roomId).single()
      if (data) {
        const elapsed = Math.floor((Date.now() - new Date(data.timer_started_at!).getTime()) / 1000)
        const left = data.timer_seconds - elapsed
        await supabase.from('rooms').update({
          timer_paused: false,
          timer_started_at: new Date(Date.now() - (data.timer_seconds - left) * 1000).toISOString(),
        }).eq('id', roomId)
        setTimerLeft(left)
        setTimerActive(true)
      }
    }, 30000)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    if (overlayRef.current) { overlayRef.current.width = CANVAS_WIDTH; overlayRef.current.height = CANVAS_HEIGHT }
  }, [])

  /* ── Transform ── */
  const canvasStyle = {
    position: 'absolute' as const,
    left: `calc(50% + ${pan.x}px)`,
    top: `calc(50% + ${pan.y}px)`,
    transform: `translate(-50%, -50%) scale(${zoom})`,
    transformOrigin: 'center',
    cursor: commentMode ? 'cell' : 'crosshair',
    touchAction: 'none' as const,
  }

  const getCanvasPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
  }

  const getTouchPos = (touch: React.Touch) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (touch.clientX - rect.left) / zoom, y: (touch.clientY - rect.top) / zoom }
  }

  /* ── Shared draw move ── */
  const applyDrawMove = (pos: { x: number; y: number }) => {
    const ctx = getCtx()!
    const octx = getOctx()!
    if (tool === 'pen' || tool === 'eraser') {
      if (tool === 'eraser') {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = size * 3; ctx.lineCap = 'round'
        ctx.lineTo(pos.x, pos.y); ctx.stroke(); ctx.restore()
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.lineTo(pos.x, pos.y); ctx.stroke()
        if (penEmoji && currentStroke.current.length % 8 === 0) {
          ctx.font = `${size + 10}px serif`; ctx.fillText(penEmoji, pos.x, pos.y)
        }
      }
      const dx = pos.x - lastPos.current.x, dy = pos.y - lastPos.current.y
      pixelArea.current += Math.sqrt(dx * dx + dy * dy) * size
    } else {
      const start = currentStroke.current[0]
      octx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      octx.strokeStyle = color; octx.lineWidth = size; octx.lineCap = 'round'
      if (tool === 'line') { octx.beginPath(); octx.moveTo(start.x, start.y); octx.lineTo(pos.x, pos.y); octx.stroke() }
      else if (tool === 'rect') { octx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y) }
      else if (tool === 'circle') {
        const rx = (pos.x - start.x) / 2, ry = (pos.y - start.y) / 2
        octx.beginPath(); octx.ellipse(start.x + rx, start.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); octx.stroke()
      }
    }
    currentStroke.current.push(pos)
    lastPos.current = pos
  }

  const finishStroke = async (endPos?: { x: number; y: number }) => {
    isDrawing.current = false
    getOctx()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    const points = currentStroke.current
    if (points.length < 1) return

    if (tool !== 'pen' && tool !== 'eraser' && endPos) {
      points.push(endPos)
      drawStroke({ room_id: roomId, user_id: myId, user_color: color, tool, points, size, emoji: penEmoji || undefined })
    }
    if (points.length < 2) return

    const stroke: Stroke = { room_id: roomId, user_id: myId, user_color: color, tool, points, size, emoji: penEmoji || undefined }
    const { data: ins } = await supabase.from('strokes').insert(stroke).select('id').single()
    if (ins?.id) strokeHistory.current.push(ins.id as number)
    await updatePixelArea()
    currentStroke.current = []
  }

  /* ── Mouse events ── */
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      return
    }
    if (e.button !== 0) return
    const pos = getCanvasPos(e)
    if (commentMode) { setPendingCommentPos(pos); setShowCommentModal(true); return }
    if (tool === 'fill') { floodFill(pos); return }
    if (tool === 'text') { addText(pos); return }
    isDrawing.current = true
    lastPos.current = pos
    currentStroke.current = [pos]
    const ctx = getCtx()!
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (isPanning.current) {
      setPan({ x: panStart.current.px + e.clientX - panStart.current.x, y: panStart.current.py + e.clientY - panStart.current.y })
      return
    }
    const pos = getCanvasPos(e)
    broadcastCursor(pos)
    if (emojiFollowerRef.current && penEmoji) {
      const rect = canvasRef.current!.getBoundingClientRect()
      emojiFollowerRef.current.style.left = (e.clientX - rect.left + 12) + 'px'
      emojiFollowerRef.current.style.top = (e.clientY - rect.top - 12) + 'px'
      emojiFollowerRef.current.style.display = 'block'
    } else if (emojiFollowerRef.current) {
      emojiFollowerRef.current.style.display = 'none'
    }
    if (!isDrawing.current) return
    applyDrawMove(pos)
  }

  const onMouseUp = (e: React.MouseEvent) => {
    if (isPanning.current) { isPanning.current = false; return }
    if (!isDrawing.current) return
    finishStroke(getCanvasPos(e))
  }

  /* ── Touch events ── */
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastTouchDistance.current = Math.sqrt(dx * dx + dy * dy)
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
      isPanning.current = true
      panStart.current = { x: cx, y: cy, px: pan.x, py: pan.y }
      return
    }
    const touch = e.touches[0]
    const pos = getTouchPos(touch)
    if (commentMode) { setPendingCommentPos(pos); setShowCommentModal(true); return }
    if (tool === 'fill') { floodFill(pos); return }
    if (tool === 'text') { addText(pos); return }
    isDrawing.current = true
    lastPos.current = pos
    currentStroke.current = [pos]
    const ctx = getCtx()!
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (lastTouchDistance.current) {
        setZoom(z => Math.max(0.1, Math.min(4, z * (dist / lastTouchDistance.current!))))
      }
      lastTouchDistance.current = dist
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
      setPan({ x: panStart.current.px + cx - panStart.current.x, y: panStart.current.py + cy - panStart.current.y })
      return
    }
    if (!isDrawing.current) return
    const pos = getTouchPos(e.touches[0])
    broadcastCursor(pos)
    applyDrawMove(pos)
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length < 2) lastTouchDistance.current = null
    if (isPanning.current && e.touches.length < 2) { isPanning.current = false; return }
    if (!isDrawing.current) return
    const endPos = e.changedTouches.length > 0 ? getTouchPos(e.changedTouches[0]) : undefined
    finishStroke(endPos)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.1, Math.min(4, z + (e.deltaY > 0 ? -0.05 : 0.05))))
  }

  /* ── Undo / Redo ── */
  const undo = useCallback(async () => {
    const id = strokeHistory.current.pop()
    if (id === undefined) return
    const { data } = await supabase.from('strokes').select('*').eq('id', id).single()
    if (data) undoStack.current.push(data as Stroke)
    await supabase.from('strokes').delete().eq('id', id).eq('user_id', myId)
    await redrawCanvas()
  }, [myId, redrawCanvas])

  const redo = useCallback(async () => {
    const stroke = undoStack.current.pop()
    if (!stroke) return
    const { id: _id, ...strokeData } = stroke as Stroke & { id?: number }
    const { data: ins } = await supabase.from('strokes').insert(strokeData).select('id').single()
    if (ins?.id) strokeHistory.current.push(ins.id as number)
    drawStroke(stroke)
  }, [drawStroke])

  /* ── Tools ── */
  const floodFill = (pos: { x: number; y: number }) => {
    const ctx = getCtx()!
    const imgData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    const data = imgData.data
    const x = Math.round(pos.x), y = Math.round(pos.y)
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return
    const idx = (y * CANVAS_WIDTH + x) * 4
    const [tr, tg, tb] = [data[idx], data[idx + 1], data[idx + 2]]
    const fc = hexToRgb(color)
    if (!fc || (tr === fc.r && tg === fc.g && tb === fc.b)) return
    const stack = [[x, y]]
    while (stack.length) {
      const [cx, cy] = stack.pop()!
      const ci = (cy * CANVAS_WIDTH + cx) * 4
      if (cx < 0 || cx >= CANVAS_WIDTH || cy < 0 || cy >= CANVAS_HEIGHT) continue
      if (data[ci] !== tr || data[ci + 1] !== tg || data[ci + 2] !== tb) continue
      data[ci] = fc.r; data[ci + 1] = fc.g; data[ci + 2] = fc.b; data[ci + 3] = 255
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    ctx.putImageData(imgData, 0, 0)
    pixelArea.current += 5000
    updatePixelArea()
  }

  const addText = async (pos: { x: number; y: number }) => {
    const text = prompt('Enter text:')
    if (!text) return
    const ctx = getCtx()!
    ctx.font = `${size * 4 + 12}px sans-serif`
    ctx.fillStyle = color
    ctx.fillText(text, pos.x, pos.y)
    const stroke: Stroke = { room_id: roomId, user_id: myId, user_color: color, tool: 'text', points: [pos], size, emoji: text }
    const { data: ins } = await supabase.from('strokes').insert(stroke).select('id').single()
    if (ins?.id) strokeHistory.current.push(ins.id as number)
    pixelArea.current += text.length * size * 10
    await updatePixelArea()
  }

  const updatePixelArea = async () => {
    await supabase.from('room_users').update({ pixel_area: Math.round(pixelArea.current) }).eq('id', myId).eq('room_id', roomId)
  }

  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
    return { r, g, b }
  }

  /* ── Timelapse ── */
  const playTimelapse = async () => {
    timelapseRunning.current = true
    setShowTimelapse(true)
    setTimelapseProgress(0)
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    const { data } = await supabase.from('strokes').select('*').eq('room_id', roomId).order('id')
    if (!data) { setShowTimelapse(false); return }
    for (let i = 0; i < data.length; i++) {
      if (!timelapseRunning.current) break
      drawStroke(data[i] as Stroke)
      setTimelapseProgress(Math.round(((i + 1) / data.length) * 100))
      await new Promise(r => setTimeout(r, 35))
    }
    timelapseRunning.current = false
    setShowTimelapse(false)
    setTimelapseProgress(0)
    if (timelapseRunning.current === false) redrawCanvas()
  }

  const stopTimelapse = () => {
    timelapseRunning.current = false
    setShowTimelapse(false)
    setTimelapseProgress(0)
    redrawCanvas()
  }

  /* ── Comment ── */
  const submitComment = async (content: string) => {
    if (!pendingCommentPos) return
    const comment: Comment = {
      room_id: roomId, user_id: myId, user_name: myName,
      user_color: color, x: pendingCommentPos.x, y: pendingCommentPos.y, content,
    }
    await supabase.from('comments').insert(comment)
    setComments(prev => [...prev, comment])
    setPendingCommentPos(null)
    setShowCommentModal(false)
    setCommentMode(false)
  }

  /* ── Chat ── */
  const sendChatEmoji = async (emoji: string) => {
    const msg: ChatMessage = { room_id: roomId, user_id: myId, user_name: myName, user_color: color, emoji }
    setChatMessages(prev => [...prev.slice(-99), { ...msg, id: Date.now() }])
    await supabase.from('chat_messages').insert(msg)
  }

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  /* ── Kick / End ── */
  const kickUser = async (userId: string, userName: string) => {
    if (!confirm(`Remove "${userName}" from the room?`)) return
    await supabase.from('room_users').delete().eq('id', userId).eq('room_id', roomId)
  }

  const endRoom = async () => {
    if (!confirm('End this room? All users will see the final stats.')) return
    await supabase.from('rooms').update({ is_ended: true }).eq('id', roomId)
    setShowStatsModal(true)
  }

  const leaveRoom = async () => {
    channelRef.current?.send({ type: 'broadcast', event: 'cursor_leave', payload: { userId: myId } })
    await supabase.from('room_users').delete().eq('id', myId).eq('room_id', roomId)
    router.push('/')
  }

  const downloadCanvas = () => {
    const canvas = canvasRef.current!
    const link = document.createElement('a')
    link.download = `collabdraw_${room?.name || 'drawing'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const timerDisplay = timerLeft > 0
    ? `${Math.floor(timerLeft / 60)}:${(timerLeft % 60).toString().padStart(2, '0')}`
    : null

  const TOOL_ICONS: Record<Tool, string> = {
    pen: '✏️', line: '📏', rect: '⬜', circle: '⭕', eraser: '🧽', fill: '🪣', text: 'T'
  }
  const TOOL_LABELS: Record<Tool, string> = {
    pen: 'Pen', line: 'Line', rect: 'Rectangle', circle: 'Circle', eraser: 'Eraser', fill: 'Fill', text: 'Text'
  }

  const closeMobilePanels = () => { setShowMobileTools(false); setShowMobileChat(false) }

  return (
    <div className={styles.app}>
      {/* TOPBAR */}
      <div className={styles.topbar}>
        <span className={styles.roomName}>{room?.name || '...'}</span>
        <div className={styles.userChips}>
          {users.map(u => (
            <span key={u.id} className={styles.chip} style={{ background: u.color + '22', color: u.color, border: `1px solid ${u.color}44` }}>
              {u.name}{u.id === room?.host_id ? ' 👑' : ''}{u.id === myId ? ' (me)' : ''}
            </span>
          ))}
        </div>
        {timerDisplay && (
          <span className={`${styles.timer} ${timerLeft < 60 ? styles.timerRed : ''}`}>⏱ {timerDisplay}</span>
        )}
        <div className={styles.topbarActions}>
          <button className={styles.tbBtn} onClick={undo} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button className={styles.tbBtn} onClick={redo} title="Redo (Ctrl+Y)">↪ Redo</button>
          <button className={`${styles.tbBtn} ${commentMode ? styles.tbBtnActive : ''}`} onClick={() => setCommentMode(!commentMode)}>💬 Comment</button>
          <button className={styles.tbBtn} onClick={playTimelapse}>🎬 Replay</button>
          <button className={styles.tbBtn} onClick={() => setZoom(z => Math.min(4, z + 0.1))}>🔍+</button>
          <button className={styles.tbBtn} onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}>🔍−</button>
          <button className={styles.tbBtn} onClick={() => { setZoom(0.4); setPan({ x: 0, y: 0 }) }}>Reset</button>
          <button className={styles.tbBtn} onClick={downloadCanvas}>💾 Save</button>
          {isHost && room && !room.timer_pause_used && timerActive && (
            <button className={styles.tbBtn} onClick={handleTimerStop}>⏸ Pause</button>
          )}
          <button className={`${styles.tbBtn} ${styles.tbBtnGreen}`} onClick={() => setShowStatsModal(true)}>📊 Finish</button>
          {isHost && <button className={`${styles.tbBtn} ${styles.tbBtnRed}`} onClick={endRoom}>🔚 End Room</button>}
          <button className={styles.tbBtn} onClick={leaveRoom}>← Leave</button>
        </div>
      </div>

      <div className={styles.main}>
        {/* LEFT SIDEBAR */}
        <div className={`${styles.sidebar} ${showMobileTools ? styles.sidebarOpen : ''}`}>
          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Tools</div>
            <div className={styles.toolGrid}>
              {(Object.keys(TOOL_ICONS) as Tool[]).map(t => (
                <button
                  key={t}
                  className={`${styles.toolBtn} ${tool === t ? styles.toolBtnActive : ''}`}
                  onClick={() => { setTool(t); closeMobilePanels() }}
                  title={TOOL_LABELS[t]}
                >
                  {TOOL_ICONS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Size — {size}px</div>
            <input type="range" min="1" max="60" step="1" value={size} onChange={e => setSize(+e.target.value)} className={styles.slider} />
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Colors (100)</div>
            <div className={styles.palette}>
              {COLORS_100.map(c => (
                <button
                  key={c}
                  className={`${styles.swatch} ${color === c ? styles.swatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className={styles.customColorRow}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className={styles.colorPicker} title="Custom color" />
              <div className={styles.currentColor} style={{ background: color }} />
            </div>
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Pen Emoji</div>
            <div className={styles.emojiGrid}>
              {PEN_EMOJIS.map(em => (
                <button
                  key={em}
                  className={`${styles.emojiBtn} ${penEmoji === em ? styles.emojiBtnActive : ''}`}
                  onClick={() => setPenEmoji(penEmoji === em ? null : em)}
                  title={em}
                >
                  {em}
                </button>
              ))}
            </div>
            {penEmoji && <div className={styles.emojiHint}>Selected: {penEmoji} (click again to remove)</div>}
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Zoom — {Math.round(zoom * 100)}%</div>
            <input type="range" min="10" max="400" step="5" value={Math.round(zoom * 100)} onChange={e => setZoom(+e.target.value / 100)} className={styles.slider} />
          </div>

          <div className={styles.sideSection}>
            <div className={styles.sideLabel}>Actions</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={styles.toolBtn} style={{ flex: 1, fontSize: 11 }} onClick={undo} title="Ctrl+Z">↩ Undo</button>
              <button className={styles.toolBtn} style={{ flex: 1, fontSize: 11 }} onClick={redo} title="Ctrl+Y">↪ Redo</button>
            </div>
          </div>
        </div>

        {/* CANVAS */}
        <div className={styles.canvasWrap} ref={wrapRef} onWheel={onWheel}>
          <canvas
            ref={canvasRef}
            style={canvasStyle}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={() => {
              isDrawing.current = false
              getOctx()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
              if (emojiFollowerRef.current) emojiFollowerRef.current.style.display = 'none'
              channelRef.current?.send({ type: 'broadcast', event: 'cursor_leave', payload: { userId: myId } })
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
          <canvas ref={overlayRef} style={{ ...canvasStyle, pointerEvents: 'none', opacity: 0.9 }} />

          {/* Remote cursors */}
          {Object.values(remoteCursors).map(cursor => (
            <div
              key={cursor.userId}
              className={styles.remoteCursor}
              style={{
                left: `calc(50% + ${pan.x}px + ${(cursor.x - CANVAS_WIDTH / 2) * zoom}px)`,
                top: `calc(50% + ${pan.y}px + ${(cursor.y - CANVAS_HEIGHT / 2) * zoom}px)`,
              }}
            >
              <svg width="14" height="18" viewBox="0 0 14 18" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                <path d="M0 0 L0 13 L3.5 9.5 L7 17 L9 16 L5.5 8.5 L10 8.5 Z" fill={cursor.color} stroke="#fff" strokeWidth="0.8" />
              </svg>
              <span className={styles.cursorLabel} style={{ background: cursor.color }}>{cursor.name}</span>
            </div>
          ))}

          {/* Comment pins */}
          {comments.map((c, i) => (
            <div
              key={i}
              className={styles.commentPin}
              style={{
                left: `calc(50% + ${pan.x}px + ${(c.x - CANVAS_WIDTH / 2) * zoom}px)`,
                top: `calc(50% + ${pan.y}px + ${(c.y - CANVAS_HEIGHT / 2) * zoom}px)`,
              }}
            >
              <div className={styles.commentDot} style={{ background: c.user_color }}>💬</div>
              <div className={styles.commentBubble}>
                <strong style={{ color: c.user_color }}>{c.user_name}</strong>
                <br />{c.content}
              </div>
            </div>
          ))}

          {/* Emoji follower */}
          {penEmoji && (
            <div ref={emojiFollowerRef} className={styles.emojiFollower} style={{ display: 'none', fontSize: size + 14 }}>
              {penEmoji}
            </div>
          )}

          <div className={styles.zoomBadge}>{Math.round(zoom * 100)}%</div>

          {/* Timelapse overlay */}
          {showTimelapse && (
            <div className={styles.timelapseOverlay}>
              <div className={styles.timelapseIcon}>🎬</div>
              <div className={styles.timelapseTitle}>Replaying drawing history...</div>
              <div className={styles.timelapseBar}>
                <div className={styles.timelapseBarFill} style={{ width: `${timelapseProgress}%` }} />
              </div>
              <div className={styles.timelapsePercent}>{timelapseProgress}%</div>
              <button className={styles.timelapseStop} onClick={stopTimelapse}>■ Stop</button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div className={`${styles.rightPanel} ${showMobileChat ? styles.rightPanelOpen : ''}`}>
          <div className={styles.usersSection}>
            <div className={styles.panelTitle}>👥 Participants</div>
            {users.map(u => (
              <div key={u.id} className={styles.userRow}>
                <div className={styles.userDot} style={{ background: u.color }} />
                <span className={styles.userName}>{u.name}{u.id === room?.host_id ? ' 👑' : ''}</span>
                {isHost && u.id !== myId && (
                  <button className={styles.kickBtn} onClick={() => kickUser(u.id, u.name)}>Kick</button>
                )}
              </div>
            ))}
          </div>

          <div className={styles.chatSection}>
            <div className={styles.panelTitle}>💬 Emoji Chat</div>
            <div className={styles.chatMessages}>
              {chatMessages.map((m, i) => (
                <div key={i} className={styles.chatLine}>
                  <span className={styles.chatUser} style={{ color: m.user_color }}>{m.user_name}</span>
                  <span className={styles.chatEmoji}>{m.emoji}</span>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
            <div className={styles.chatEmojiGrid}>
              {CHAT_EMOJIS.map(em => (
                <button key={em} className={styles.chatEmojiBtn} onClick={() => sendChatEmoji(em)}>{em}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile overlay backdrop */}
      {(showMobileTools || showMobileChat) && (
        <div className={styles.mobileOverlay} onClick={closeMobilePanels} />
      )}

      {/* Mobile bottom bar */}
      <div className={styles.mobileBar}>
        <button
          className={`${styles.mobileBarBtn} ${showMobileTools ? styles.mobileBarBtnActive : ''}`}
          onClick={() => { setShowMobileTools(v => !v); setShowMobileChat(false) }}
        >
          <span>{TOOL_ICONS[tool]}</span>
          <span className={styles.mobileBarLabel}>Tools</span>
        </button>
        <button className={styles.mobileBarBtn} onClick={undo}>
          <span>↩</span>
          <span className={styles.mobileBarLabel}>Undo</span>
        </button>
        <button className={styles.mobileBarBtn} onClick={playTimelapse}>
          <span>🎬</span>
          <span className={styles.mobileBarLabel}>Replay</span>
        </button>
        <button className={styles.mobileBarBtn} onClick={downloadCanvas}>
          <span>💾</span>
          <span className={styles.mobileBarLabel}>Save</span>
        </button>
        <button
          className={`${styles.mobileBarBtn} ${showMobileChat ? styles.mobileBarBtnActive : ''}`}
          onClick={() => { setShowMobileChat(v => !v); setShowMobileTools(false) }}
        >
          <span>👥</span>
          <span className={styles.mobileBarLabel}>Chat</span>
        </button>
      </div>

      {/* MODALS */}
      {showTimerModal && isHost && (
        <TimerModal onSet={handleTimerSet} onSkip={() => setShowTimerModal(false)} />
      )}
      {showStatsModal && (
        <StatsModal
          users={users}
          roomName={room?.name || ''}
          canvas={canvasRef.current}
          onClose={() => setShowStatsModal(false)}
          onLeave={() => router.push('/')}
        />
      )}
      {showCommentModal && (
        <CommentModal
          onSubmit={submitComment}
          onCancel={() => { setShowCommentModal(false); setPendingCommentPos(null) }}
        />
      )}
    </div>
  )
}
