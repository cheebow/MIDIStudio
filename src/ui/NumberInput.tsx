// A number field that lets you type (ADR-087). Parsing and clamping every keystroke made "-" (an
// empty value while typing a negative number) become 0 and a cleared field jump to its minimum, so
// "-20" was entered as 20. The text being typed is kept as a draft; a value inside the range is
// applied as soon as it is typed, and leaving the field puts an out-of-range value into the range.
import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number;
  onValue: (n: number) => void;
  min: number;
  max: number;
  /** whole numbers only (default); false allows decimals (step) */
  integer?: boolean;
};

export function NumberInput({ value, onValue, min, max, integer = true, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (text: string): number | null => {
    if (text.trim() === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return integer ? Math.round(n) : n;
  };
  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parse(text);
        if (n !== null && n >= min && n <= max && n !== value) onValue(n);
      }}
      onBlur={(e) => {
        if (draft !== null) {
          const n = parse(draft);
          if (n !== null) {
            const v = Math.max(min, Math.min(max, n));
            if (v !== value) onValue(v);
          }
          setDraft(null);
        }
        onBlur?.(e);
      }}
    />
  );
}
