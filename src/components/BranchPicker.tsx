import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Cloud, GitBranch, GitMerge, Plus, Trash } from "lucide-react";
import { api, type GitBranch as Branch } from "../lib/api";

interface BranchPickerProps {
  onClose: () => void;
  onCheckout: (branch: Branch) => void;
  onCreate: (name: string) => void;
  onMerge: (branch: Branch) => void;
  onDelete: (branch: Branch) => void;
}

type Item = { kind: "create"; name: string } | { kind: "branch"; branch: Branch };

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string): string {
  const days = (new Date(iso).getTime() - Date.now()) / 86400000;
  if (Math.abs(days) >= 365) return relativeTime.format(Math.round(days / 365), "year");
  if (Math.abs(days) >= 30) return relativeTime.format(Math.round(days / 30), "month");
  if (Math.abs(days) >= 1) return relativeTime.format(Math.round(days), "day");
  const hours = days * 24;
  return Math.abs(hours) >= 1 ? relativeTime.format(Math.round(hours), "hour") : "just now";
}

/** VS Code's branch quick pick: type to filter, or to name a new branch. */
export default function BranchPicker(props: BranchPickerProps) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    api.gitBranches().then(setBranches, (e) => setError(String(e)));
  }, []);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const matching = (branches ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
    const exists = (branches ?? []).some((b) => !b.remote && b.name === q);
    const create: Item[] = q && !exists ? [{ kind: "create", name: q.replace(/\s+/g, "-") }] : [];
    return [...create, ...matching.map((branch): Item => ({ kind: "branch", branch }))];
  }, [branches, query]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".picker-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "create") props.onCreate(item.name);
    else if (!item.branch.current) props.onCheckout(item.branch);
    props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[selected]);
    }
  };

  let lastGroup = "";
  const rows: ReactNode[] = [];
  items.forEach((item, i) => {
    const group = item.kind === "create" ? "" : item.branch.remote ? "Remote branches" : "Branches";
    if (group && group !== lastGroup) rows.push(<div key={`h:${group}`} className="picker-group">{group}</div>);
    lastGroup = group;
    rows.push(
      <div
        key={item.kind === "create" ? "create" : item.branch.name + item.branch.remote}
        className={`picker-item ${i === selected ? "selected" : ""}`}
        onMouseMove={() => setSelected(i)}
        onClick={() => choose(item)}
      >
        {item.kind === "create" ? (
          <>
            <Plus size={15} className="picker-icon" />
            <span className="picker-label">
              Create new branch <strong>{item.name}</strong>
            </span>
            <span className="picker-detail">from the current commit</span>
          </>
        ) : (
          <>
            {item.branch.remote ? <Cloud size={15} className="picker-icon" /> : <GitBranch size={15} className="picker-icon" />}
            <span className="picker-label">{item.branch.name}</span>
            {item.branch.current && <Check size={14} className="picker-current" aria-label="Current branch" />}
            <span className="picker-detail">
              {item.branch.subject} · {ago(item.branch.date)}
            </span>
            {!item.branch.current && (
              <span className="picker-actions">
                <button
                  title={`Merge ${item.branch.name} into the current branch`}
                  aria-label="Merge into current branch"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onMerge(item.branch);
                    props.onClose();
                  }}
                >
                  <GitMerge size={14} />
                </button>
                {!item.branch.remote && (
                  <button
                    title={`Delete ${item.branch.name}`}
                    aria-label="Delete branch"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete(item.branch);
                      props.onClose();
                    }}
                  >
                    <Trash size={14} />
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </div>,
    );
  });

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="picker" role="dialog" aria-label="Branches" onKeyDown={onKey}>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Select a branch to switch to, or type a name to create one"
          spellCheck={false}
        />
        <div className="picker-list" ref={list}>
          {error && <p className="picker-empty">{error}</p>}
          {!error && branches === null && <p className="picker-empty">Loading branches…</p>}
          {!error && branches !== null && items.length === 0 && <p className="picker-empty">No branches match.</p>}
          {rows}
        </div>
        <div className="picker-footer">
          ↵ switch · <GitMerge size={11} /> merge into current · <Trash size={11} /> delete
        </div>
      </div>
    </div>
  );
}
