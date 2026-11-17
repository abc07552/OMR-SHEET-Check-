import { useEffect, useId, useRef } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type { Exam, Result } from "./data";
import { formatNumber, gradeResult, initials } from "./data";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-symbol">
        <svg width="25" height="25" viewBox="0 0 32 32" fill="none">
          <path
            d="M5 24V9h6l5 8 5-8h6v15h-5v-8l-6 9-6-9v8H5Z"
            fill="currentColor"
          />
        </svg>
      </span>
      {!small && (
        <span>
          markly<span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
export function Select({
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`select-wrap ${className}`}>
      <select {...props}>{children}</select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector<HTMLElement>(
      'input, button, select, textarea, [tabindex="0"]',
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ) || [],
        ).filter((el) => el.offsetParent !== null);
        const firstNode = nodes[0],
          lastNode = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstNode) {
          e.preventDefault();
          lastNode?.focus();
        }
        if (!e.shiftKey && document.activeElement === lastNode) {
          e.preventDefault();
          firstNode?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
      >
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
export function Avatar({
  name,
  index = 0,
  large = false,
}: {
  name: string;
  index?: number;
  large?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${index % 6} ${large ? "avatar-large" : ""}`}
    >
      {initials(name)}
    </span>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span />
      {status === "Review" ? "Needs review" : status}
    </span>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search students...",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function ResultsTable({
  results,
  exam,
  onOpen,
  compact = false,
  selected,
  onSelect,
  onSelectAll,
  sort,
  onSort,
}: {
  results: Result[];
  exam: Exam;
  onOpen: (r: Result) => void;
  compact?: boolean;
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  onSelectAll?: () => void;
  sort?: string;
  onSort?: () => void;
}) {
  return (
    <div className="table-scroll">
      <table className={`results-table ${compact ? "compact-table" : ""}`}>
        <thead>
          <tr>
            {selected && (
              <th className="checkbox-cell">
                <input
                  type="checkbox"
                  aria-label="Select all visible students"
                  checked={
                    results.length > 0 &&
                    results.every((r) => selected.has(r.id))
                  }
                  onChange={onSelectAll}
                />
              </th>
            )}
            <th>Student name</th>
            <th>Class</th>
            <th>
              <button
                className="table-sort"
                onClick={onSort}
                disabled={!onSort}
              >
                Score{" "}
                {sort && (
                  <ArrowDown
                    size={12}
                    className={sort === "score-asc" ? "rotate-180" : ""}
                  />
                )}
              </button>
            </th>
            {!compact && <th>Accuracy</th>}
            <th>Status</th>
            <th className="row-action-cell">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const g = gradeResult(r, exam);
            return (
              <tr
                key={r.id}
                onClick={() => onOpen(r)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === "Enter")
                    onOpen(r);
                }}
              >
                {selected && (
                  <td
                    className="checkbox-cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.has(r.id)}
                      onChange={() => onSelect?.(r.id)}
                    />
                  </td>
                )}
                <td>
                  <div className="student-cell">
                    <Avatar name={r.name} index={i} />
                    <span>
                      <strong>{r.name}</strong>
                      <small>Roll no. {r.roll}</small>
                    </span>
                  </div>
                </td>
                <td>
                  <span className="class-text">{r.section}</span>
                </td>
                <td>
                  <span className="score-value">
                    {formatNumber(g.score)}
                    <span> / {formatNumber(g.maximum)}</span>
                  </span>
                </td>
                {!compact && (
                  <td>
                    <div className="accuracy-cell">
                      <span>{g.accuracy.toFixed(0)}%</span>
                      <span className="mini-track">
                        <span
                          style={{
                            width: `${g.accuracy}%`,
                            backgroundColor:
                              g.accuracy < 40 ? "#d59279" : "#80a571",
                          }}
                        />
                      </span>
                    </div>
                  </td>
                )}
                <td>
                  <StatusBadge status={g.status} />
                </td>
                <td>
                  <button
                    className="icon-button row-detail"
                    aria-label={`View ${r.name}'s result`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(r);
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function ExportButton({
  onClick,
  label = "Export report",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button className="button button-secondary" onClick={onClick}>
      <Download size={16} />
      {label}
    </button>
  );
}
export function SectionLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function SavedIndicator({ dirty }: { dirty: boolean }) {
  return (
    <span className={`saved-indicator ${dirty ? "unsaved" : ""}`}>
      {dirty ? <span className="dot" /> : <Check size={13} />}{" "}
      {dirty ? "Unsaved changes" : "All changes saved"}
    </span>
  );
}
