import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, TerminalSquare, TrendingUp } from "lucide-react";
import { request } from "../lib/api";

interface RatingTarget {
  id: number;
  username: string;
  display_name: string;
  rating: number;
}
interface Result {
  message: string;
  operation_id?: string;
  before?: number;
  after?: number;
}

export function EloControls({
  players,
  factions,
  onSaved,
}: {
  players: RatingTarget[];
  factions: RatingTarget[];
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"player" | "faction">("player");
  const [targetId, setTargetId] = useState("");
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const targets = kind === "player" ? players : factions;
  const target = targets.find((target) => String(target.id) === targetId);
  const next = target
    ? Math.round((target.rating + Number(amount)) * 100) / 100
    : null;
  const mutation = useMutation({
    mutationFn: () =>
      request<Result>(
        "/dev/ratings/",
        {
          method: "POST",
          body: JSON.stringify({
            request_key: key,
            kind,
            target_id: Number(targetId),
            amount,
            reason,
          }),
        },
        15000,
      ),
    onSuccess: () => {
      setKey(crypto.randomUUID());
      setReason("");
      onSaved();
    },
  });
  const changed = () => {
    setKey(crypto.randomUUID());
    mutation.reset();
  };
  return (
    <section className="dev-elo-panel">
      <div className="dev-tools-heading">
        <TrendingUp size={23} />
        <div>
          <h2>Elo controls</h2>
          <p>
            Adjust a player's solo Elo or a faction's team Elo. Include a reason
            for the audit record.
          </p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (target && Number(amount) !== 0) mutation.mutate();
        }}
      >
        <fieldset disabled={mutation.isPending}>
          <div className="dev-elo-fields">
            <label className="registration-field">
              Ladder
              <select
                aria-label="Ladder"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as typeof kind);
                  setTargetId("");
                  changed();
                }}
              >
                <option value="player">Player Elo</option>
                <option value="faction">Faction Elo</option>
              </select>
            </label>
            <label className="registration-field">
              {kind === "player" ? "Player" : "Faction"}
              <select
                aria-label={kind === "player" ? "Player" : "Faction"}
                required
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  changed();
                }}
              >
                <option value="">Choose a {kind}</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.display_name} (@{target.username}) · {target.rating}{" "}
                    Elo
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="registration-field">
            Elo change
            <input
              aria-label="Elo change"
              aria-describedby="elo-change-help"
              type="number"
              required
              step="0.01"
              min={-100000}
              max={100000}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                changed();
              }}
            />
            <span id="elo-change-help" className="dev-field-help">
              Use a positive amount to add Elo or a negative amount to subtract
              it.
            </span>
          </label>
          <label className="registration-field">
            Reason
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              placeholder="Explain this rating adjustment."
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                changed();
              }}
            />
          </label>
        </fieldset>
        {target && (
          <div className="dev-elo-preview">
            <span>
              Current Elo <strong>{target.rating.toLocaleString()}</strong>
            </span>
            <span>
              After adjustment <strong>{next?.toLocaleString()}</strong>
            </span>
          </div>
        )}
        {mutation.error && (
          <p role="alert" className="registration-error">
            {mutation.error.message}
          </p>
        )}
        {mutation.data && (
          <p role="status" className="dev-notice">
            {mutation.data.message}
          </p>
        )}
        <button
          className="button primary"
          disabled={
            mutation.isPending ||
            !target ||
            !Number.isFinite(next) ||
            next! < 0 ||
            next! > 1000000 ||
            !Number(amount) ||
            reason.trim().length < 3
          }
        >
          {mutation.isPending ? (
            <>
              <LoaderCircle size={16} className="registration-spin" /> Applying…
            </>
          ) : (
            "Apply Elo change"
          )}
        </button>
      </form>
    </section>
  );
}

interface Line {
  command: string;
  output: string;
  error?: boolean;
}
export function AdminTerminal({ onSaved }: { onSaved: () => void }) {
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<Line[]>([
    {
      command: "",
      output:
        "DAWEST ADMIN CONSOLE\nType help for commands. Moderation and Elo changes require a reason.",
    },
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [position, setPosition] = useState(-1);
  const lastRequest = useRef<{ command: string; key: string } | null>(null);
  const output = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: ({ command, key }: { command: string; key: string }) =>
      request<Result>(
        "/dev/commands/",
        { method: "POST", body: JSON.stringify({ command, request_key: key }) },
        15000,
      ),
    onSuccess: (result, sent) => {
      setLines((lines) =>
        [...lines, { command: sent.command, output: result.message }].slice(
          -100,
        ),
      );
      setCommand("");
      lastRequest.current = null;
      if (result.operation_id) onSaved();
    },
    onError: (error, sent) =>
      setLines((lines) =>
        [
          ...lines,
          { command: sent.command, output: error.message, error: true },
        ].slice(-100),
      ),
    onSettled: () => requestAnimationFrame(() => input.current?.focus()),
  });
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight });
  }, [lines]);
  function submit() {
    const text = command.trim();
    if (!text || mutation.isPending) return;
    if (lastRequest.current?.command !== text)
      lastRequest.current = { command: text, key: crypto.randomUUID() };
    setHistory((history) => [text, ...history].slice(0, 50));
    setPosition(-1);
    mutation.mutate(lastRequest.current!);
  }
  return (
    <section className="dev-terminal-panel">
      <div className="dev-tools-heading">
        <TerminalSquare size={23} />
        <div>
          <h2>Admin terminal</h2>
          <p>
            Ban players, restrict competitive access, restore accounts, and
            adjust Elo.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={mutation.isPending}
          onClick={() => setLines([])}
        >
          Clear output
        </button>
      </div>
      <div
        className="dev-terminal-output"
        role="log"
        aria-label="Admin command output"
        aria-live="polite"
        ref={output}
        tabIndex={0}
      >
        {lines.map((line, index) => (
          <div key={index} className={line.error ? "command-error" : ""}>
            {line.command && (
              <p className="dev-terminal-command">
                <span>admin &gt;</span> {line.command}
              </p>
            )}
            <pre>{line.output}</pre>
          </div>
        ))}
        {mutation.isPending && <p role="status">Running command…</p>}
      </div>
      <form
        className="dev-terminal-input"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <span aria-hidden="true">admin &gt;</span>
        <input
          ref={input}
          aria-label="Admin command"
          value={command}
          maxLength={1000}
          placeholder="help"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={mutation.isPending}
          onChange={(event) => {
            setCommand(event.target.value);
            setPosition(-1);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const next =
              event.key === "ArrowUp"
                ? Math.min(position + 1, history.length - 1)
                : Math.max(-1, position - 1);
            setPosition(next);
            setCommand(next < 0 ? "" : (history[next] ?? ""));
          }}
        />
        <button
          className="button primary"
          disabled={mutation.isPending || !command.trim()}
        >
          {mutation.isPending ? "Running…" : "Run command"}
        </button>
      </form>
      <div className="dev-terminal-help">
        <p>
          <code>ban username reason</code> disables login and removes the player
          from rankings. <code>unban</code> restores login.
        </p>
        <p>
          <code>restrict username reason</code> keeps login and profile access,
          hides solo rankings, and blocks ranked play, joining factions, and
          leader management. <code>unrestrict</code> restores participation.
        </p>
        <p>
          <code>elo player username +25 reason</code> ·{" "}
          <code>elo faction faction-slug +50 reason</code>
        </p>
      </div>
    </section>
  );
}
