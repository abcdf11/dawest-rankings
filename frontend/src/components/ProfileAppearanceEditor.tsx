import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import type { PlayerDetail } from "../types/rankings";
import { request } from "../lib/api";
import { Modal } from "./Modal";
import { ProfileMediaImage } from "./ProfileMediaImage";
import "../appearance.css";

export interface AppearanceResult {
  avatar_url: string;
  banner_url: string;
}
const LIMIT = 8 * 1024 * 1024;
const accepted = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function usePreview(file: File | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function ProfileAppearanceEditor({
  player,
  onClose,
  onSaved,
  faction = false,
}: {
  player: Pick<
    PlayerDetail,
    "username" | "display_name" | "avatar_url" | "banner_url"
  >;
  onClose: () => void;
  onSaved: (result: AppearanceResult) => void;
  faction?: boolean;
}) {
  const client = useQueryClient();
  const [avatar, setAvatar] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [error, setError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarPreview = usePreview(avatar);
  const bannerPreview = usePreview(banner);
  const picture = avatarPreview || (removeAvatar ? "" : player.avatar_url);
  const cover = bannerPreview || (removeBanner ? "" : player.banner_url);
  const changed = Boolean(avatar || banner || removeAvatar || removeBanner);
  const mutation = useMutation({
    mutationFn: () => {
      const body = new FormData();
      if (avatar) body.append("avatar", avatar);
      if (banner) body.append("banner", banner);
      if (removeAvatar) body.append("remove_avatar", "true");
      if (removeBanner) body.append("remove_banner", "true");
      return request<AppearanceResult>(
        faction
          ? `/factions/${encodeURIComponent(player.username)}/appearance/`
          : "/auth/profile/appearance/",
        { method: "POST", body },
        60_000,
      );
    },
    onSuccess: (result) => {
      if (!faction)
        client.setQueriesData<PlayerDetail>(
          { queryKey: ["player-profile"] },
          (current) =>
            current?.username === player.username
              ? { ...current, ...result }
              : current,
        );
      void client.invalidateQueries({ queryKey: ["rankings"] });
      void client.invalidateQueries({ queryKey: ["team"] });
      void client.invalidateQueries({ queryKey: ["player"] });
      if (faction) {
        void client.invalidateQueries({ queryKey: ["faction"] });
        void client.invalidateQueries({ queryKey: ["factions"] });
        void client.invalidateQueries({ queryKey: ["my-factions"] });
      }
      onSaved(result);
    },
  });
  function choose(kind: "avatar" | "banner", file?: File) {
    if (!file) return;
    mutation.reset();
    if (file.size > LIMIT) {
      setError("Choose an image up to 8 MB.");
      return;
    }
    if (file.type && !accepted.has(file.type)) {
      setError("Use a PNG, JPG, WebP, or GIF image.");
      return;
    }
    setError("");
    if (kind === "avatar") {
      setAvatar(file);
      setRemoveAvatar(false);
    } else {
      setBanner(file);
      setRemoveBanner(false);
    }
  }
  return (
    <Modal
      title={faction ? "CUSTOMIZE FACTION" : "CUSTOMIZE PROFILE"}
      onClose={onClose}
      dismissible={!mutation.isPending}
    >
      <form
        className="appearance-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !error) mutation.mutate();
        }}
      >
        <div className="appearance-heading">
          <span>
            <Camera size={21} />
          </span>
          <div>
            <h2>Make it yours.</h2>
            <p>
              {faction
                ? "Your faction's identity, on and off the ladder."
                : "Your picture. Your banner. Your place on the frontier."}
            </p>
          </div>
        </div>
        <div
          className="appearance-preview"
          aria-label={
            faction
              ? "Faction appearance preview"
              : "Profile appearance preview"
          }
        >
          <div className="appearance-preview-cover">
            {cover ? (
              <ProfileMediaImage src={cover} alt="Banner preview" />
            ) : (
              <span>DAWEST</span>
            )}
          </div>
          <div className="appearance-preview-person">
            <span className="appearance-preview-avatar">
              {picture ? (
                <ProfileMediaImage
                  src={picture}
                  alt={
                    faction ? "Faction logo preview" : "Profile picture preview"
                  }
                />
              ) : (
                player.display_name.slice(0, 2).toUpperCase()
              )}
            </span>
            <span>
              <strong>{player.display_name}</strong>
              <small>@{player.username}</small>
            </span>
          </div>
        </div>
        <fieldset disabled={mutation.isPending}>
          <div className="appearance-upload-card">
            <div>
              <Camera size={19} />
              <span>
                <strong>{faction ? "Faction logo" : "Profile picture"}</strong>
                <small>Automatically fitted to 256 × 256</small>
              </span>
            </div>
            <input
              ref={avatarInput}
              tabIndex={-1}
              type="file"
              className="sr-only"
              aria-label={
                faction ? "Faction logo file" : "Profile picture file"
              }
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => {
                choose("avatar", event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="appearance-file-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => avatarInput.current?.click()}
              >
                <Upload size={14} />
                {faction ? "Choose logo" : "Choose picture"}
              </button>
              {(picture || removeAvatar) && (
                <button
                  type="button"
                  className="appearance-remove"
                  onClick={() => {
                    setAvatar(null);
                    setRemoveAvatar(!removeAvatar);
                    setError("");
                    mutation.reset();
                  }}
                >
                  {removeAvatar ? (
                    <>
                      <RotateCcw size={13} />
                      Undo removal
                    </>
                  ) : (
                    "Remove"
                  )}
                </button>
              )}
            </div>
            {avatar && <p className="appearance-filename">{avatar.name}</p>}
            {removeAvatar && (
              <p className="appearance-filename">
                {faction
                  ? "The default faction logo will be restored."
                  : "The default avatar will be restored."}
              </p>
            )}
          </div>
          <div className="appearance-upload-card">
            <div>
              <ImagePlus size={19} />
              <span>
                <strong>{faction ? "Faction banner" : "Profile banner"}</strong>
                <small>Automatically fitted to 1280 × 240</small>
              </span>
            </div>
            <input
              ref={bannerInput}
              tabIndex={-1}
              type="file"
              className="sr-only"
              aria-label={
                faction ? "Faction banner file" : "Profile banner file"
              }
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => {
                choose("banner", event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="appearance-file-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => bannerInput.current?.click()}
              >
                <Upload size={14} />
                Choose banner
              </button>
              {(cover || removeBanner) && (
                <button
                  type="button"
                  className="appearance-remove"
                  onClick={() => {
                    setBanner(null);
                    setRemoveBanner(!removeBanner);
                    setError("");
                    mutation.reset();
                  }}
                >
                  {removeBanner ? (
                    <>
                      <RotateCcw size={13} />
                      Undo removal
                    </>
                  ) : (
                    "Remove"
                  )}
                </button>
              )}
            </div>
            {banner && <p className="appearance-filename">{banner.name}</p>}
            {removeBanner && (
              <p className="appearance-filename">
                The DAWEST cover will be restored.
              </p>
            )}
          </div>
        </fieldset>
        <p className="appearance-help">
          PNG, JPG, WebP or GIF · Up to 8 MB each.
          <br />
          Images are cropped to fit. GIF animation is preserved (up to 120
          frames).
        </p>
        {(error || mutation.isError) && (
          <p className="registration-error" role="alert">
            {error || mutation.error?.message}
          </p>
        )}
        <div className="appearance-footer">
          <button
            type="button"
            className="button secondary"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!changed || Boolean(error) || mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <LoaderCircle className="profile-spinner" size={16} />
                Saving images…
              </>
            ) : (
              "Save images"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
