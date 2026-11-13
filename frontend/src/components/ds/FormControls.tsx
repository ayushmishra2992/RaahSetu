"use client";

import { Search, X } from "lucide-react";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

const controlBase =
  "w-full rounded-md border border-line-strong bg-surface text-sm text-ink shadow-xs transition-colors placeholder:text-subtle " +
  "hover:border-navy-300 focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-500/20 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-subtle " +
  "aria-[invalid=true]:border-danger-600 aria-[invalid=true]:focus:ring-danger-600/15";

interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldCtx | null>(null);

type AriaProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"] };

/** Merge the enclosing <Field>'s id / aria-describedby / aria-invalid into a control's props. */
function useFieldProps<P extends AriaProps>(props: P): P {
  const f = useContext(FieldContext);
  if (!f) return props;
  return {
    ...props,
    id: props.id ?? f.id,
    "aria-describedby": [props["aria-describedby"], f.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? (f.invalid || undefined),
  };
}

export function Input({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const p = useFieldProps(props);
  return (
    <input
      ref={ref}
      {...p}
      className={cx(
        controlBase,
        p.type === "file" ? "py-1.5 pl-1.5 pr-3 file:mr-3 file:rounded file:border-0 file:bg-navy-50 file:px-2.5 file:py-1 file:text-[13px] file:font-medium file:text-navy-700" : "h-9 px-3",
        p.className,
      )}
    />
  );
}
Input.__rsFormControl = true;

export function Select({ ref, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  const p = useFieldProps(props);
  return (
    <select ref={ref} {...p} className={cx(controlBase, "rs-select h-9 appearance-none pl-3 pr-8", p.className)}>
      {children}
    </select>
  );
}
Select.__rsFormControl = true;

export function Textarea({ ref, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const p = useFieldProps(props);
  return <textarea ref={ref} rows={3} {...p} className={cx(controlBase, "px-3 py-2", p.className)} />;
}
Textarea.__rsFormControl = true;

/** Checkbox with an inline label and optional description. */
export function Checkbox({ label, description, className, id, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className={cx("flex cursor-pointer items-start gap-2.5 text-sm", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input id={cid} type="checkbox" {...props} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-600" />
      <span className="min-w-0">
        <span className="text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** On/off switch (role="switch"). */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand-600" : "bg-navy-200")}
      >
        <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/**
 * Form field: label, optional hint and error message.
 * When the only child is a design-system control (Input/Select/Textarea/DateTimeInput)
 * it is linked to the label by id, the hint or error is announced via
 * aria-describedby, and aria-invalid is set while there is an error.
 * Composite children (e.g. input + button) fall back to implicit labelling.
 */
export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const wired = !!only && typeof only.type === "function" && !!(only.type as { __rsFormControl?: boolean }).__rsFormControl;
  const controlId = (wired && only.props.id) || id;

  const labelText = (
    <span className="mb-1.5 block text-[13px] font-medium text-ink">
      {label}
      {required && <span className="ml-0.5 text-danger-600" aria-hidden>*</span>}
    </span>
  );
  const messages = (
    <>
      {hint && !error && <span id={hintId} className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span id={errorId} className="mt-1 block text-xs font-medium text-danger-600">{error}</span>}
    </>
  );

  if (!wired) {
    return (
      <label className={cx("block min-w-0 text-sm", className)}>
        {labelText}
        {children}
        {messages}
      </label>
    );
  }
  return (
    <div className={cx("block min-w-0 text-sm", className)}>
      {/* The decorative asterisk stays outside <label> so the label text is exactly the field name. */}
      <span className="mb-1.5 flex items-baseline gap-0.5">
        <label htmlFor={controlId} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {required && <span className="text-danger-600" aria-hidden>*</span>}
      </span>
      <FieldContext.Provider value={{ id: controlId, describedBy: errorId ?? hintId, invalid: !!error }}>{cloneElement(only, { id: controlId })}</FieldContext.Provider>
      {messages}
    </div>
  );
}

/** Search box with icon, clear button, Escape-to-clear and optional debounce. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 0,
  label = "Search",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  debounceMs?: number;
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  if (value !== synced) {
    // External reset (e.g. "clear filters") — adopt the new value.
    setSynced(value);
    setDraft(value);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const emit = (v: string) => {
    setDraft(v);
    window.clearTimeout(timer.current);
    if (debounceMs > 0) timer.current = window.setTimeout(() => onChange(v), debounceMs);
    else onChange(v);
  };
  return (
    <div className={cx("relative w-full sm:max-w-xs", className)}>
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => emit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.stopPropagation();
            emit("");
          }
        }}
        className={cx(controlBase, "h-9 pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden")}
      />
      {draft && (
        <button type="button" aria-label="Clear search" onClick={() => emit("")} className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-subtle hover:bg-navy-50 hover:text-ink">
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Toolbar for search + filters above a list. Stacks on narrow screens. */
export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
