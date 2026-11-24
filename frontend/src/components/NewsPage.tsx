import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Newspaper, PenLine, Plus, Trash2 } from "lucide-react";
import { ApiError, request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import { AccountMenu } from "./AccountMenu";
import { MainNavigation } from "./MainNavigation";
import { Brand } from "./Shared";
import "../profile.css";
import "../factions.css";
import "../news.css";

interface ArticleSummary {
  slug: string;
  title: string;
  summary: string;
  author: string;
  is_published: boolean;
  published_at: string | null;
  updated_at: string;
  url: string;
}
interface Article extends ArticleSummary {
  body: string;
  can_edit?: boolean;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="profile-site faction-site news-site">
      <header className="profile-site-header">
        <div>
          <a href="/" aria-label="DaWest rankings home">
            <Brand />
          </a>
          <MainNavigation />
          <AccountMenu />
        </div>
      </header>
      <main className="profile-page faction-page news-page">{children}</main>
      <footer className="profile-site-footer">
        <span>DAWEST / NEWS</span>
      </footer>
    </div>
  );
}

function State({ error }: { error?: Error | null }) {
  return (
    <Frame>
      <div className="profile-state" role={error ? "alert" : "status"}>
        {error ? (
          <>
            <Newspaper size={32} />
            <h1>
              {error instanceof ApiError && error.status === 404
                ? "Article not found"
                : "Could not load the news"}
            </h1>
            <p>{error.message}</p>
            <a className="button secondary" href="/news">
              All news
            </a>
          </>
        ) : (
          <>
            <LoaderCircle size={28} className="profile-spinner" />
            <p>Loading the news…</p>
          </>
        )}
      </div>
    </Frame>
  );
}

function when(article: ArticleSummary) {
  const date = article.published_at ?? article.updated_at;
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Plain text: blank lines split paragraphs; single line breaks are kept. Never rendered as HTML. */
function Body({ text }: { text: string }) {
  return (
    <div className="news-body">
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i}>{p.trim()}</p>
        ))}
    </div>
  );
}

function NewsList() {
  const list = useQuery({
    queryKey: ["news"],
    queryFn: () =>
      request<{ articles: ArticleSummary[]; can_post: boolean }>("/news/"),
  });
  if (list.isPending) return <State />;
  if (list.error) return <State error={list.error} />;
  const { articles, can_post } = list.data;
  return (
    <Frame>
      <div className="faction-directory-heading">
        <div>
          <h1>News</h1>
          <p>Announcements, patch notes and results from the DaWest frontier.</p>
        </div>
        {can_post && (
          <a className="button primary" href="/news/new">
            <Plus size={16} /> New article
          </a>
        )}
      </div>
      {articles.length === 0 ? (
        <p className="news-empty muted">No articles yet.</p>
      ) : (
        <div className="news-list">
          {articles.map((article) => (
            <a key={article.slug} className="news-card" href={article.url}>
              <span className="eyebrow">
                {article.is_published ? when(article) : "DRAFT"} ·{" "}
                {article.author}
              </span>
              <h2>{article.title}</h2>
              {article.summary && <p>{article.summary}</p>}
            </a>
          ))}
        </div>
      )}
    </Frame>
  );
}

function ArticleView({ slug }: { slug: string }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const article = useQuery({
    queryKey: ["news", slug],
    queryFn: () => request<Article>(`/news/${encodeURIComponent(slug)}/`),
    retry: false,
  });
  const remove = useMutation({
    mutationFn: () =>
      request(`/news/${encodeURIComponent(slug)}/`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["news"] });
      window.location.assign("/news");
    },
  });
  if (article.isPending) return <State />;
  if (article.error) return <State error={article.error} />;
  const a = article.data;
  return (
    <Frame>
      <article className="news-article">
        <a className="news-back" href="/news">
          ← All news
        </a>
        <span className="eyebrow">
          {a.is_published ? when(a) : "DRAFT — only news accounts can see this"}{" "}
          · {a.author}
        </span>
        <h1>{a.title}</h1>
        {a.summary && <p className="news-summary">{a.summary}</p>}
        <Body text={a.body} />
        {a.can_edit && (
          <div className="news-actions">
            <a className="button secondary" href={`/news/${a.slug}/edit`}>
              <PenLine size={16} /> Edit
            </a>
            {confirming ? (
              <>
                <button
                  className="button primary"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Deleting…" : "Yes, delete it"}
                </button>
                <button
                  className="button secondary"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="button secondary"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            {remove.error && (
              <p className="registration-error" role="alert">
                {remove.error.message}
              </p>
            )}
          </div>
        )}
      </article>
    </Frame>
  );
}

function Editor({ slug }: { slug?: string }) {
  const session = useSession();
  const existing = useQuery({
    queryKey: ["news", slug],
    queryFn: () => request<Article>(`/news/${encodeURIComponent(slug!)}/`),
    enabled: Boolean(slug),
    retry: false,
  });
  if (session.isPending || (slug && existing.isPending)) return <State />;
  if (existing.error) return <State error={existing.error} />;
  if (!session.data?.user?.can_post_news)
    return (
      <Frame>
        <div className="profile-state" role="alert">
          <Newspaper size={32} />
          <h1>News accounts only</h1>
          <p>Sign in with a news account to write articles.</p>
          <a className="button secondary" href="/login?next=/news">
            Log in
          </a>
        </div>
      </Frame>
    );
  return <EditorForm slug={slug} article={existing.data} />;
}

function EditorForm({ slug, article }: { slug?: string; article?: Article }) {
  const client = useQueryClient();
  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const save = useMutation({
    mutationFn: (publish: boolean) =>
      request<Article>(
        slug ? `/news/${encodeURIComponent(slug)}/` : "/news/",
        {
          method: slug ? "PATCH" : "POST",
          body: JSON.stringify({ title, summary, body, is_published: publish }),
        },
      ),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["news"] });
      window.location.assign(saved.url);
    },
  });
  const submit = (publish: boolean) => (event?: FormEvent) => {
    event?.preventDefault();
    save.mutate(publish);
  };
  return (
    <Frame>
      <form className="news-editor faction-section" onSubmit={submit(true)}>
        <span className="eyebrow">NEWS DESK</span>
        <h1>{slug ? "Edit article" : "New article"}</h1>
        <label htmlFor="news-title">Title</label>
        <input
          id="news-title"
          required
          minLength={3}
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="news-summary">
          Summary <small>(optional, shown in the list)</small>
        </label>
        <input
          id="news-summary"
          maxLength={300}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <label htmlFor="news-body">
          Article <small>(leave a blank line between paragraphs)</small>
        </label>
        <textarea
          id="news-body"
          required
          rows={16}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="news-actions">
          <button className="button primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Publish"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={save.isPending}
            onClick={() => submit(false)()}
          >
            Save as draft
          </button>
          <a className="button secondary" href={slug ? `/news/${slug}` : "/news"}>
            Cancel
          </a>
        </div>
        {save.error && (
          <p className="registration-error" role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </Frame>
  );
}

export default function NewsPage({
  slug,
  editing = false,
}: {
  slug?: string;
  editing?: boolean;
}) {
  if (slug === "new") return <Editor />;
  if (slug && editing) return <Editor slug={slug} />;
  if (slug) return <ArticleView slug={slug} />;
  return <NewsList />;
}
