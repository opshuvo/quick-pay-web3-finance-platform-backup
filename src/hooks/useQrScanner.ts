import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import jsQR from 'jsqr'

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error'

/**
 * Rear-camera QR scanning. It only reports the decoded text; deciding what the text
 * means (and never paying automatically) is the caller's job.
 */
export function useQrScanner(videoRef: RefObject<HTMLVideoElement | null>, onCode: (text: string) => void) {
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number>(0)
  const onCodeRef = useRef(onCode)
  const [state, setState] = useState<ScannerState>('idle')
  useEffect(() => {
    onCodeRef.current = onCode
  }, [onCode])

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState('idle')
  }, [videoRef])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      return
    }
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      await video.play()
      setState('scanning')
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      let last = 0
      const tick = (time: number) => {
        frameRef.current = requestAnimationFrame(tick)
        if (time - last < 100 || !ctx || video.readyState < 2 || !video.videoWidth) return
        last = time
        const scale = Math.min(1, 640 / video.videoWidth)
        canvas.width = Math.floor(video.videoWidth * scale)
        canvas.height = Math.floor(video.videoHeight * scale)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
        if (result?.data) {
          cancelAnimationFrame(frameRef.current)
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          setState('idle')
          onCodeRef.current(result.data)
        }
      }
      frameRef.current = requestAnimationFrame(tick)
    } catch (error) {
      const name = (error as DOMException)?.name
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'error')
    }
  }, [videoRef])

  useEffect(() => stop, [stop])

  return { state, start, stop }
}
