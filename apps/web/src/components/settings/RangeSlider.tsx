"use client";

interface RangeSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

export function RangeSlider({ min, max, step, value, onChange }: RangeSliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-48 accent-[var(--accent)]"
    />
  );
}
