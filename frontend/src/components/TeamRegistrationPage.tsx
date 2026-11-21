import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  CircleCheck,
  Copy,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { FormEvent } from "react";
import { Brand } from "./Shared";
import { TypewriterText } from "./TypewriterText";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import { AccountMenu } from "./AccountMenu";
import type { Region } from "../types/rankings";
import "../registration.css";

interface Receipt {
  id: string;
  reference: string;
  team_name: string;
  tag: string;
  region: Region;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  reviewed_at: string | null;
  review_note: string;
  team_username: string | null;
}
interface Member {
  key: string;
  username: string;
  display_name: string;
}
const initialMember = (): Member => ({
  key: crypto.randomUUID(),
  username: "",
  display_name: "",
});

export default function TeamRegistrationPage() {
  const session = useSession();
  const profile = session.data?.user?.player;
  const captain = profile?.username ?? "";
  const receiptId = new URLSearchParams(window.location.search).get("receipt");
  const [draft, setDraft] = useState({
    team_name: "",
    tag: "",
    region: "NA" as Region,
    description: "",
    contact_discord: "",
  });
  const [members, setMembers] = useState<Member[]>(() => [initialMember()]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    queryKey: ["registration", receiptId],
    queryFn: () =>
      request<Receipt>(
        `/teams/registrations/${encodeURIComponent(receiptId!)}/`,
      ),
    enabled: Boolean(receiptId) && Boolean(session.data?.authenticated),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: () =>
      request<Receipt>("/teams/register/", {
        method: "POST",
        body: JSON.stringify({
          request_key: requestKey,
          team_name: draft.team_name,
          tag: draft.tag,
          region: draft.region,
          description: draft.description,
          captain_username: captain,
          contact_discord: draft.contact_discord,
          members: [
            {
              username: captain,
              display_name: profile?.display_name || captain,
            },
            ...members.map((m) => ({
              username: m.username,
              display_name: m.display_name.trim() || m.username,
            })),
          ],
        }),
      }),
    onSuccess: (receipt) => {
      const url = new URL(window.location.href);
      url.searchParams.set("receipt", receipt.id);
      window.history.replaceState(null, "", url);
    },
  });
  const receipt = status.data ?? mutation.data;
  function field(key: keyof typeof draft, value: string) {
    setDraft((old) => ({ ...old, [key]: value }));
    mutation.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }
  async function copyReceipt() {
    if (!receipt) return;
    const url = new URL("/register", window.location.origin);
    url.searchParams.set("receipt", receipt.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="registration-site">
      <header className="registration-header">
        <a href="/" aria-label="DaWest rankings home">
          <Brand />
        </a>
        <span className="registration-header-label">FACTION REGISTRATION</span>
        <AccountMenu />
        <a className="registration-back" href="/?ranking=teams">
          Power rankings
        </a>
      </header>
      <main className="registration-layout">
        <aside className="registration-intro">
          <span className="registration-eyebrow">
            THE FACTION CIRCUIT / SEASON 04
          </span>
          <h1>
            <TypewriterText text="MAKE YOUR NAME." speed={45} />
          </h1>
          <p>
            A name. A crew. A place on the frontier.
            <br />
            Register your faction and enter the DaWest competitive circuit.
          </p>
          <div className="registration-process">
            <div>
              <span>01</span>
              <section>
                <h2>Build your identity</h2>
                <p>Choose a faction name, tag, and home region.</p>
              </section>
            </div>
            <div>
              <span>02</span>
              <section>
                <h2>Bring your crew</h2>
                <p>Add your captain and a roster of 2–10 players.</p>
              </section>
            </div>
            <div>
              <span>03</span>
              <section>
                <h2>Enter the circuit</h2>
                <p>
                  After review, your faction starts at 1,500 PR. Match results
                  decide what comes next.
                </p>
              </section>
            </div>
          </div>
          <div className="registration-note">
            <ShieldCheck size={19} />
            <p>
              One faction per player. Independent faction and solo ratings.
              Every result verified.
            </p>
          </div>
          <span className="registration-aside-footer">
            REPUTATION IS EVERYTHING.
          </span>
        </aside>
        <section className="registration-card">
          {session.isPending ? (
            <div className="auth-gate">
              <LoaderCircle size={28} className="registration-spin" />
              <h2>CHECKING YOUR SESSION.</h2>
            </div>
          ) : profile?.is_restricted ? (
            <div className="auth-gate">
              <ShieldCheck size={32} />
              <h2>ACCOUNT RESTRICTED.</h2>
              <p>
                You can still view your profile, but faction registration is
                unavailable while your account is restricted.
              </p>
              <a href="/profile" className="button secondary">
                View your profile
              </a>
            </div>
          ) : !session.data?.authenticated || !profile?.is_active ? (
            <div className="auth-gate">
              <ShieldCheck size={32} />
              <h2>REGISTERED PLAYERS ONLY.</h2>
              <p>
                Sign in as your faction’s leader. Each roster member must create
                a player account before you submit your faction.
              </p>
              <div className="auth-gate-links">
                <a className="button primary" href="/login?next=/register">
                  Log in
                </a>
                <a className="button secondary" href="/signup?next=/register">
                  Create player account
                </a>
              </div>
            </div>
          ) : receipt ? (
            <div className="registration-receipt" aria-live="polite">
              <span className="receipt-icon">
                <CircleCheck size={34} />
              </span>
              <span className="registration-eyebrow">
                {receipt.status === "PENDING"
                  ? "YOUR CREW IS ON THE LIST"
                  : "REGISTRATION UPDATE"}
              </span>
              <h2>
                {receipt.status === "APPROVED"
                  ? "WELCOME TO THE CIRCUIT."
                  : receipt.status === "REJECTED"
                    ? "REGISTRATION REVIEWED."
                    : "REGISTRATION RECEIVED."}
              </h2>
              <p>
                {receipt.status === "APPROVED"
                  ? "Your faction has been approved and added to the official ladder."
                  : receipt.status === "REJECTED"
                    ? "Your application was not approved. Review the moderator's note below."
                    : "Your faction details and roster have been saved. A moderator will review your application before your faction joins the official ladder."}
              </p>
              <dl className="receipt-details">
                <div>
                  <dt>FACTION</dt>
                  <dd>
                    {receipt.team_name} <span>[{receipt.tag}]</span>
                  </dd>
                </div>
                <div>
                  <dt>REFERENCE</dt>
                  <dd className="mono">{receipt.reference}</dd>
                </div>
                <div>
                  <dt>REGION</dt>
                  <dd>{receipt.region}</dd>
                </div>
                <div>
                  <dt>STATUS</dt>
                  <dd className="receipt-status">
                    {receipt.status.replace("_", " ")}
                  </dd>
                </div>
              </dl>
              {receipt.review_note && (
                <p className="review-note">{receipt.review_note}</p>
              )}
              <div className="receipt-actions">
                <button
                  className="button primary"
                  onClick={() => void copyReceipt()}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
                  {copied ? "Status link copied" : "Copy status link"}
                </button>
                <button
                  className="button secondary"
                  onClick={() => void status.refetch()}
                  disabled={status.isFetching}
                >
                  {status.isFetching ? (
                    <LoaderCircle size={15} className="registration-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Check status
                </button>
              </div>
              {status.isError && (
                <p className="registration-error" role="alert">
                  Could not refresh the registration status. Try again.
                </p>
              )}
              <a
                className="registration-return"
                href={
                  receipt.team_username
                    ? `/factions/${encodeURIComponent(receipt.team_username)}`
                    : "/?ranking=teams&source=official"
                }
              >
                {receipt.team_username
                  ? "View faction profile"
                  : "Return to team rankings"}
              </a>
            </div>
          ) : receiptId ? (
            <div className="registration-receipt">
              {status.isPending ? (
                <>
                  <LoaderCircle size={28} className="registration-spin" />
                  <h2>LOADING YOUR REGISTRATION.</h2>
                </>
              ) : (
                <>
                  <h2>REGISTRATION NOT FOUND.</h2>
                  <p>Check your status link, or try again in a moment.</p>
                  <button
                    className="button secondary"
                    onClick={() => void status.refetch()}
                  >
                    Try again
                  </button>
                  <a href="/register" className="registration-return">
                    Start a registration
                  </a>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="registration-form">
              <div className="registration-form-heading">
                <span className="registration-form-icon">
                  <UsersRound size={23} />
                </span>
                <div>
                  <h2>REGISTER A FACTION</h2>
                  <p>Your next chapter starts here.</p>
                </div>
              </div>
              <fieldset disabled={mutation.isPending}>
                <legend>FACTION IDENTITY</legend>
                <label className="registration-field">
                  Faction name
                  <input
                    required
                    minLength={2}
                    maxLength={64}
                    value={draft.team_name}
                    onChange={(e) => field("team_name", e.target.value)}
                    placeholder="Your faction name"
                    autoComplete="organization"
                  />
                </label>
                <div className="registration-two-columns">
                  <label className="registration-field">
                    Faction tag
                    <input
                      required
                      minLength={2}
                      maxLength={5}
                      pattern="[A-Z0-9]{2,5}"
                      value={draft.tag}
                      onChange={(e) =>
                        field("tag", e.target.value.toUpperCase())
                      }
                      placeholder="2–5 characters"
                      autoComplete="off"
                    />
                  </label>
                  <label className="registration-field">
                    Home region
                    <select
                      value={draft.region}
                      onChange={(e) => field("region", e.target.value)}
                    >
                      <option value="NA">North America</option>
                      <option value="EU">Europe</option>
                      <option value="ASIA">Asia</option>
                      <option value="SA">South America</option>
                      <option value="OCE">Oceania</option>
                    </select>
                  </label>
                </div>
                <label className="registration-field">
                  About your faction <span>Optional</span>
                  <textarea
                    maxLength={500}
                    value={draft.description}
                    onChange={(e) => field("description", e.target.value)}
                    placeholder="Tell us a little about your crew."
                    rows={3}
                  />
                </label>
              </fieldset>
              <fieldset disabled={mutation.isPending}>
                <legend>CAPTAIN & CONTACT</legend>
                <div className="registration-two-columns">
                  <label className="registration-field">
                    Captain username
                    <input
                      required
                      maxLength={40}
                      pattern="[a-zA-Z0-9_-]+"
                      value={captain}
                      readOnly
                      placeholder="In-game username"
                      autoComplete="username"
                    />
                  </label>
                  <label className="registration-field">
                    Display name <span>Optional</span>
                    <input
                      maxLength={64}
                      value={profile.display_name}
                      readOnly
                      placeholder="Captain's display name"
                    />
                  </label>
                </div>
                <label className="registration-field">
                  Discord username <span>Optional</span>
                  <input
                    maxLength={80}
                    value={draft.contact_discord}
                    onChange={(e) => field("contact_discord", e.target.value)}
                    placeholder="Your Discord username"
                  />
                </label>
                <p className="registration-help">
                  Contact details are visible only to the registration
                  reviewers.
                </p>
              </fieldset>
              <fieldset disabled={mutation.isPending}>
                <legend>
                  STARTING ROSTER <span>{members.length + 1}/10 PLAYERS</span>
                </legend>
                <div className="registration-captain-row">
                  <ShieldCheck size={16} />
                  <span>{captain || "Your captain"}</span>
                  <small>CAPTAIN · INCLUDED</small>
                </div>
                {members.map((member, index) => (
                  <div className="registration-roster-row" key={member.key}>
                    <label className="registration-field">
                      Player {index + 2} username
                      <input
                        required
                        maxLength={40}
                        pattern="[a-zA-Z0-9_-]+"
                        value={member.username}
                        onChange={(e) => {
                          setMembers((old) =>
                            old.map((m) =>
                              m.key === member.key
                                ? {
                                    ...m,
                                    username: e.target.value.toLowerCase(),
                                  }
                                : m,
                            ),
                          );
                          mutation.reset();
                        }}
                        placeholder="In-game username"
                        aria-label={`Player ${index + 2} username`}
                      />
                    </label>
                    <label className="registration-field">
                      Display name <span>Optional</span>
                      <input
                        maxLength={64}
                        value={member.display_name}
                        onChange={(e) =>
                          setMembers((old) =>
                            old.map((m) =>
                              m.key === member.key
                                ? { ...m, display_name: e.target.value }
                                : m,
                            ),
                          )
                        }
                        placeholder="Display name"
                        aria-label={`Player ${index + 2} display name`}
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={members.length === 1}
                      onClick={() =>
                        setMembers((old) =>
                          old.filter((m) => m.key !== member.key),
                        )
                      }
                      aria-label={`Remove player ${index + 2}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="registration-add"
                  disabled={members.length >= 9}
                  onClick={() => setMembers((old) => [...old, initialMember()])}
                >
                  <Plus size={15} />
                  Add a player
                </button>
                <p className="registration-help">
                  Each player must register an account first. Include at least
                  one player in addition to your captain. Players may belong to
                  one faction at a time.
                </p>
              </fieldset>
              {mutation.isError && (
                <div role="alert" className="registration-error">
                  {mutation.error.message}
                </div>
              )}
              <button
                className="button primary registration-submit"
                type="submit"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? (
                  <LoaderCircle size={17} className="registration-spin" />
                ) : (
                  <CheckCheck size={17} />
                )}{" "}
                {mutation.isPending
                  ? "Submitting registration…"
                  : "Submit faction registration"}
              </button>
              <p className="registration-submit-note">
                You’ll receive a private status link after submitting. Your
                faction joins the official ladder after review.
              </p>
            </form>
          )}
        </section>
      </main>
      <footer className="registration-footer">
        <span>DAWEST / FACTION REGISTRATION</span>
        <span>
          <Globe2 size={12} />
          ONE FRONTIER. EVERY REGION.
        </span>
      </footer>
    </div>
  );
}
