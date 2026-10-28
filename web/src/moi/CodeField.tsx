// The sign-in's code field: six cells drawn over ONE real input, so the phone's own help keeps working (iOS and Android
// offer the code from the SMS above the keyboard, WebOTP fills it, a paste lands in it). The input covers the cells and is
// transparent: a tap anywhere on them types, the cell that waits is underlined.
import { forwardRef, useState, type ClipboardEvent } from 'react';
import { codeOf } from './phone';

export type CodeState = 'idle' | 'busy' | 'bad' | 'ok';

type Props = {
  value: string;
  onChange: (v: string) => void;
  state?: CodeState;
  /** the id of the line(s) that describe it, read after its label */
  describedBy?: string;
};

export const CodeField = forwardRef<HTMLInputElement, Props>(function CodeField({ value, onChange, state = 'idle', describedBy }, ref) {
  const [focus, setFocus] = useState(false);
  // pasted text is read whole (« 123 456 », « Ton code : 123456 (10 min) »), whatever was typed before it
  const paste = (e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); onChange(codeOf(e.clipboardData.getData('text'))); };
  const at = Math.min(value.length, 5);
  return (
    <div className="ms-otp" data-state={state}>
      <div className="ms-cells" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={'ms-cell' + (focus && i === at && state !== 'ok' ? ' on' : '') + (value[i] ? ' full' : '')}>{value[i] || ''}</span>
        ))}
      </div>
      <input
        id="m-code" ref={ref} className="ms-otp-in" name="code" type="text" inputMode="numeric" pattern="[0-9]*"
        autoComplete="one-time-code" enterKeyHint="done" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        value={value} aria-invalid={state === 'bad'} aria-describedby={describedBy}
        onChange={(e) => onChange(codeOf(e.target.value))} onPaste={paste}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        // a tap in the middle puts the caret after the last digit (no hole in the code); a selection (select all, then type or paste) is left alone
        onSelect={(e) => { const el = e.currentTarget; if (el.selectionStart === el.selectionEnd && el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length); }}
      />
    </div>
  );
});
