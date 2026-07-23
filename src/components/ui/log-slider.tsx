"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

interface LogSliderProps {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  className?: string
  snapPoints?: number[]
}

export function LogSlider({ min, max, step, value, onChange, className, snapPoints }: LogSliderProps) {
  const SNAP_THRESHOLD = 4

  const defaultSnapPoints = snapPoints || [min, max]

  const valueToPosition = (v: number): number => {
    const logMin = Math.log(min)
    const logMax = Math.log(max)
    return ((Math.log(Math.max(min, Math.min(max, v))) - logMin) / (logMax - logMin)) * 100
  }

  const positionToValue = (pos: number): number => {
    const logMin = Math.log(min)
    const logMax = Math.log(max)
    const logV = logMin + (pos / 100) * (logMax - logMin)
    return Math.round(Math.exp(logV) / step) * step
  }

  const findSnapPosition = (pos: number): number | null => {
    const currentValue = positionToValue(pos)
    for (const snap of defaultSnapPoints) {
      const snapPos = valueToPosition(snap)
      if (Math.abs(pos - snapPos) <= SNAP_THRESHOLD) {
        return snapPos
      }
    }
    return null
  }

  const [sliderPos, setSliderPos] = React.useState(() => valueToPosition(value))

  React.useEffect(() => {
    setSliderPos(valueToPosition(value))
  }, [value, min, max])

  const handleValueChange = (linearValues: number[]) => {
    const rawPos = linearValues[0]
    const snappedPos = findSnapPosition(rawPos)

    if (snappedPos !== null) {
      setSliderPos(snappedPos)
      onChange(positionToValue(snappedPos))
    } else {
      setSliderPos(rawPos)
      onChange(positionToValue(rawPos))
    }
  }

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={[sliderPos]}
      onValueChange={handleValueChange}
      max={100}
      step={0.5}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative grow overflow-hidden rounded-full h-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  )
}
