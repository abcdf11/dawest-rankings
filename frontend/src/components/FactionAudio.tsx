import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Music, Pause, Play, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import { request } from "../lib/api";

const AUTOPLAY_KEY = "dawest.factionThemeAutoplay";
const MAX_BYTES = 8 * 1024 * 1024;

function autoplayAllowed() {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Plays the faction's theme when a visitor opens the profile. Browsers block
 *  sound until the visitor interacts, so it falls back to their first click/key. */
export function FactionThemePlayer({
  src,
  title,
  factionName,
}: {
  src: string;
  title: string;
  factionName: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [autoplay, setAutoplay] = useState(autoplayAllowed);
  const stopped = useRef(false);

  useEffect(() => {
    const element = audio.current;
    if (!element || !autoplay) return;
    element.volume = 0.6;
    stopped.current = false;
    let cleanup = () => {};
    element.play().catch(() => {
      setWaiting(true);
      const start = (event: Event) => {
        // Clicks on the player's own buttons are handled there.
        if (player.current?.contains(event.target as Node)) return;
        cleanup();
        setWaiting(false);
        if (!stopped.current) void element.play().catch(() => undefined);
      };
      document.addEventListener("pointerdown", start, true);
      document.addEventListener("keydown", start, true);
      cleanup = () => {
        document.removeEventListener("pointerdown", start, true);
        document.removeEventListener("keydown", start, true);
      };
    });
    return () => cleanup();
  }, [src, autoplay]);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    setWaiting(false);
    if (element.paused) {
      stopped.current = false;
      void element.play().catch(() => undefined);
    } else {
      stopped.current = true;
      element.pause();
    }
  }

  function toggleAutoplay() {
    const next = !autoplay;
    try {
      localStorage.setItem(AUTOPLAY_KEY, next ? "on" : "off");
    } catch {
      /* preference just won't persist */
    }
    if (!next) {
      stopped.current = true;
      audio.current?.pause();
      setWaiting(false);
    }
    setAutoplay(next);
  }

  return (
    <div className="faction-theme" ref={player}>
      <audio
        ref={audio}
        src={src}
        loop
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className="faction-theme-play"
        onClick={toggle}
        aria-label={playing ? "Pause faction theme" : "Play faction theme"}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="faction-theme-text">
        <span>
          <Music size={12} /> {factionName} theme
        </span>
        <strong>{title || "Faction theme"}</strong>
        {waiting && <small>Click anywhere to start the music</small>}
      </div>
      <button
        type="button"
        className="faction-text-button faction-theme-auto"
        onClick={toggleAutoplay}
        aria-pressed={!autoplay}
        title={autoplay ? "Stop faction themes from playing automatically" : "Let faction themes play automatically"}
      >
        {autoplay ? <Volume2 size={14} /> : <VolumeX size={14} />}
        {autoplay ? "Autoplay on" : "Autoplay off"}
      </button>
    </div>
  );
}

export function FactionAudioEditor({
  username,
  audioUrl,
  audioTitle,
}: {
  username: string;
  audioUrl: string;
  audioTitle: string;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(audioTitle);
  const [localError, setLocalError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(audioTitle), [audioTitle]);
  const save = useMutation({
    mutationFn: (remove: boolean) => {
      const body = new FormData();
      if (remove) body.append("remove", "true");
      else {
        if (file) body.append("audio", file);
        body.append("title", title);
      }
      return request<{ audio_url: string; audio_title: string }>(
        `/factions/${encodeURIComponent(username)}/audio/`,
        { method: "POST", body },
        120_000,
      );
    },
    onSuccess: () => {
      setFile(null);
      if (input.current) input.current.value = "";
      void client.invalidateQueries({ queryKey: ["faction", username] });
    },
  });
  const choose = (picked: File | null) => {
    save.reset();
    setLocalError("");
    if (picked && picked.size > MAX_BYTES) {
      setLocalError("Audio files can be up to 8 MB.");
      if (input.current) input.current.value = "";
      setFile(null);
      return;
    }
    setFile(picked);
  };
  const changed = Boolean(file) || (audioUrl && title.trim() !== audioTitle);
  return (
    <section className="faction-section faction-audio-editor" aria-labelledby="faction-audio-title">
      <div className="faction-section-heading">
        <div>
          <span className="eyebrow">LEADER DASHBOARD</span>
          <h2 id="faction-audio-title">Theme audio</h2>
        </div>
      </div>
      <p className="faction-audio-help">
        Plays when someone opens your faction profile. MP3, M4A, OGG, WAV, FLAC,
        or WebM, up to 8 MB. Visitors can pause it or turn autoplay off.
      </p>
      {audioUrl ? (
        <audio className="faction-audio-preview" controls preload="none" src={audioUrl} />
      ) : (
        <p className="faction-audio-help">No theme uploaded yet.</p>
      )}
      <form
        className="faction-audio-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(false);
        }}
      >
        <fieldset disabled={save.isPending}>
          <label>
            Audio file
            <input
              ref={input}
              type="file"
              accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.webm"
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Track title <small>(optional)</small>
            <input
              maxLength={80}
              value={title}
              placeholder="e.g. War Drums"
              onChange={(event) => {
                save.reset();
                setTitle(event.target.value);
              }}
            />
          </label>
        </fieldset>
        {(localError || save.error) && (
          <p className="registration-error" role="alert">
            {localError || save.error?.message}
          </p>
        )}
        {save.isSuccess && !changed && (
          <p className="faction-audio-help" role="status">
            Saved.
          </p>
        )}
        <div className="faction-audio-actions">
          {audioUrl && (
            <button
              type="button"
              className="button secondary"
              disabled={save.isPending}
              onClick={() => {
                if (window.confirm("Remove your faction's theme audio?")) save.mutate(true);
              }}
            >
              <Trash2 size={15} /> Remove
            </button>
          )}
          <button className="button primary" disabled={save.isPending || !changed}>
            <Upload size={15} />{" "}
            {save.isPending ? "Uploading…" : file ? "Upload audio" : "Save title"}
          </button>
        </div>
      </form>
    </section>
  );
}
