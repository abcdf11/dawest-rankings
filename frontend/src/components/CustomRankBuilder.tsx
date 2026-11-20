import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Link,
  ListOrdered,
  RotateCcw,
} from "lucide-react";
import type { Player } from "../types/rankings";
import { decodeRanking, movePlayer } from "../lib/builder";
import { Sigil, TierBadge } from "./Shared";
import { formatRating } from "../lib/rating";
export function CustomRankBuilder({ players }: { players: Player[] }) {
  const [ids, setIds] = useState<number[]>(
    () =>
      decodeRanking(
        window.location.hash,
        players.map((p) => p.id),
      ) ?? players.slice(0, 10).map((p) => p.id),
  );
  const [copied, setCopied] = useState(false),
    [message, setMessage] = useState("");
  const dragIndex = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  function move(from: number, to: number) {
    setIds((old) => movePlayer(old, from, to));
    setCopied(false);
    setMessage("Ranking updated.");
  }
  async function share() {
    const url = new URL(window.location.href);
    url.hash = new URLSearchParams({ list: ids.join(".") }).toString();
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setMessage("Share link copied to clipboard.");
    } catch {
      setMessage(`Your share link: ${url.toString()}`);
    }
  }
  if (!players.length)
    return (
      <div className="empty-state">
        <ListOrdered size={30} />
        <h3>A new frontier</h3>
        <p>
          Your community list will be available when players join the ladder.
        </p>
      </div>
    );
  return (
    <section className="mode-panel builder">
      <div className="mode-header">
        <span className="icon-square">
          <ListOrdered size={22} />
        </span>
        <div>
          <span className="eyebrow gold">YOUR FRONTIER. YOUR RULES.</span>
          <h2>BUILD YOUR POWER LIST</h2>
          <p>
            Drag players into your order, then share your picks with the
            community.
          </p>
        </div>
      </div>
      <div className="builder-toolbar">
        <label>
          LIST SIZE
          <select
            aria-label="List size"
            value={ids.length}
            onChange={(e) => {
              const size = Number(e.target.value);
              setIds((current) =>
                [
                  ...current,
                  ...players
                    .map((p) => p.id)
                    .filter((id) => !current.includes(id)),
                ].slice(0, size),
              );
              setCopied(false);
            }}
          >
            <option value="10">Top 10 players</option>
            <option value="20">Top 20 players</option>
          </select>
        </label>
        <span className="muted">
          Use drag handles or move buttons to reorder.
        </span>
        <button
          className="button secondary"
          onClick={() => {
            setIds(players.slice(0, ids.length).map((p) => p.id));
            setCopied(false);
            setMessage("Restored official order.");
          }}
        >
          <RotateCcw size={15} />
          Reset
        </button>
        <button className="button primary" onClick={() => void share()}>
          {copied ? <Check size={16} /> : <Link size={16} />}{" "}
          {copied ? "Link copied" : "Share my ranking"}
        </button>
      </div>
      <ol className="builder-list">
        {ids.map((id, i) => {
          const p = players.find((x) => x.id === id)!;
          return (
            <li
              key={id}
              className={over === i ? "drag-over" : ""}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current !== null) move(dragIndex.current, i);
                dragIndex.current = null;
                setOver(null);
              }}
            >
              <span
                className="drag-handle"
                draggable
                onDragStart={(e) => {
                  dragIndex.current = i;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(id));
                }}
                onDragEnd={() => {
                  dragIndex.current = null;
                  setOver(null);
                }}
                title={`Drag ${p.display_name}`}
              >
                <GripVertical size={18} />
              </span>
              <span className="builder-rank mono">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Sigil player={p} />
              <strong>{p.display_name}</strong>
              <TierBadge tier={p.tier} />
              <span className="builder-pr mono">
                {formatRating(p.rating)} <small>PR</small>
              </span>
              <button
                className="icon-button"
                disabled={i === 0}
                aria-label={`Move ${p.display_name} up`}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon-button"
                disabled={i === ids.length - 1}
                aria-label={`Move ${p.display_name} down`}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown size={16} />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="builder-message" role="status">
        {message || "Your personal list is independent of the official ladder."}
      </p>
    </section>
  );
}
