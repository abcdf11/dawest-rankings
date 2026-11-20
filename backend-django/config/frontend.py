from django.conf import settings
from django.http import FileResponse, Http404
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


@require_safe
@never_cache
def frontend(request):
    try:
        index = (settings.FRONTEND_DIST / "index.html").open("rb")
    except FileNotFoundError:
        raise Http404 from None
    return FileResponse(index, content_type="text/html; charset=utf-8")
