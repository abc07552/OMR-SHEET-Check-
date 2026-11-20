import { useEffect, useState } from "react";
import { normaliseInteger } from "./answers";
import type { IntegerAnswer } from "./answers";

/** Keeps the user's short input while editing; persists canonical 000–999 only. */
export default function IntegerAnswerInput({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: IntegerAnswer | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value || "");
  useEffect(() => {
    setText((previous) =>
      normaliseInteger(previous) === value ? previous : value || "",
    );
  }, [value]);
  return (
    <input
      className="integer-answer-input"
      aria-label={label}
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      pattern="[0-9]{1,3}"
      placeholder="000–999"
      disabled={disabled}
      value={text}
      onChange={(e) => {
        if (!/^[0-9]{0,3}$/.test(e.target.value)) return;
        setText(e.target.value);
        onChange(normaliseInteger(e.target.value));
      }}
      onBlur={() => setText(value || "")}
    />
  );
}

export function IntegerResponseEditor({
  value,
  question,
  disabled,
  onConfirm,
}: {
  value: string | null;
  question: number;
  disabled: boolean;
  onConfirm: (value: IntegerAnswer) => void;
}) {
  const [text, setText] = useState(value || "");
  useEffect(() => {
    setText(value || "");
  }, [value, question]);
  const parsed = normaliseInteger(text);
  return (
    <div className="integer-response-edit">
      <label>
        Three-digit response · hundreds, tens, units
        <input
          aria-label={`Question ${question + 1} integer response`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          placeholder="000–999"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            if (/^[0-9]{0,3}$/.test(e.target.value)) setText(e.target.value);
          }}
        />
      </label>
      <button
        className="button button-secondary"
        disabled={disabled || parsed === null}
        onClick={() => {
          if (parsed) onConfirm(parsed);
        }}
      >
        Confirm integer{parsed ? ` ${parsed}` : ""}
      </button>
      <small className="muted">
        Enter 0–999; leading zeros are retained. Confirm only after inspecting
        the original, not the answer key. A partial/multiple column never
        becomes a guessed number.
      </small>
    </div>
  );
}
