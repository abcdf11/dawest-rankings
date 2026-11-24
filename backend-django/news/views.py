"""News: anyone reads published articles; news accounts (permission news.publish_article) write them."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from accounts.models import AuditEntry
from .models import Article


def can_post_news(user):
    return bool(user and user.is_authenticated and user.is_active and user.has_perm("news.publish_article"))


class NewsWriteThrottle(UserRateThrottle):
    scope = "news_write"
    rate = "60/hour"


class ArticleInput(serializers.Serializer):
    title = serializers.CharField(min_length=3, max_length=140)
    summary = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    body = serializers.CharField(min_length=1, max_length=20000)
    is_published = serializers.BooleanField(required=False, default=False)


def author_name(article):
    user = article.author
    if user is None:
        return "DaWest News"
    player = getattr(user, "player_profile", None)
    return getattr(player, "display_name", None) or user.username


def article_payload(article, full=True):
    data = {"slug": article.slug, "title": article.title, "summary": article.summary,
            "author": author_name(article), "is_published": article.is_published,
            "published_at": article.published_at, "updated_at": article.updated_at,
            "url": f"/news/{article.slug}"}
    if full:
        data["body"] = article.body
    return data


def unique_slug(title, exclude_pk=None):
    base = slugify(title)[:80] or "article"
    if base == "new":
        base = "new-article"  # /news/new is the editor
    slug, n = base, 2
    while Article.objects.filter(slug=slug).exclude(pk=exclude_pk).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def require_writer(request):
    if not can_post_news(request.user):
        raise PermissionDenied("Only news accounts can write articles.")


def visible(request):
    return Article.objects.select_related("author") if can_post_news(request.user) else Article.objects.select_related("author").filter(is_published=True)


@api_view(["GET", "POST"])
@throttle_classes([NewsWriteThrottle])
def articles(request):
    if request.method == "GET":
        rows = visible(request)[:100]
        return Response({"articles": [article_payload(a, full=False) for a in rows], "can_post": can_post_news(request.user)})
    require_writer(request)
    form = ArticleInput(data=request.data)
    form.is_valid(raise_exception=True)
    d = form.validated_data
    with transaction.atomic():
        article = Article.objects.create(slug=unique_slug(d["title"]), title=d["title"], summary=d["summary"], body=d["body"],
                                         author=request.user, is_published=d["is_published"],
                                         published_at=timezone.now() if d["is_published"] else None)
        AuditEntry.objects.create(actor=request.user, action="news.created", target_type="article", target_id=str(article.pk), details={"title": article.title, "published": article.is_published})
    return Response(article_payload(article), status=201)


@api_view(["GET", "PATCH", "DELETE"])
@throttle_classes([NewsWriteThrottle])
def article(request, slug):
    row = get_object_or_404(visible(request), slug=slug)
    if request.method == "GET":
        return Response({**article_payload(row), "can_edit": can_post_news(request.user)})
    require_writer(request)
    with transaction.atomic():
        if request.method == "DELETE":
            AuditEntry.objects.create(actor=request.user, action="news.deleted", target_type="article", target_id=str(row.pk), details={"title": row.title})
            row.delete()
            return Response(status=204)
        form = ArticleInput(data={**article_payload(row), **request.data})
        form.is_valid(raise_exception=True)
        d = form.validated_data
        if d["title"] != row.title:
            row.slug = unique_slug(d["title"], exclude_pk=row.pk)
        if d["is_published"] and not row.is_published:
            row.published_at = timezone.now()
        row.title, row.summary, row.body, row.is_published = d["title"], d["summary"], d["body"], d["is_published"]
        row.save()
        AuditEntry.objects.create(actor=request.user, action="news.updated", target_type="article", target_id=str(row.pk), details={"title": row.title, "published": row.is_published})
    return Response(article_payload(row))
