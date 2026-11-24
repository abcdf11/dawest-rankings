from django.conf import settings
from django.db import models


class Article(models.Model):
    """A news post written by a news account (permission news.publish_article). Plain text body."""
    slug = models.SlugField(max_length=90, unique=True)
    title = models.CharField(max_length=140)
    summary = models.CharField(max_length=300, blank=True)
    body = models.TextField(max_length=20000)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="news_articles")
    is_published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-published_at", "-created_at"]
        permissions = [("publish_article", "Can write and publish news articles")]

    def __str__(self):
        return self.title
